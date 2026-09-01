export type CustomerCreditSourceType = "credit_note" | "payment";

export type CustomerCreditSourceRow = {
  sourceKey: string;
  sourceType: CustomerCreditSourceType;
  sourceId: number;
  customerId: number;
  originalAmount: string;
  availableAmount: string;
  createdAt: Date | string;
};

export type CustomerCreditInvoiceRow = {
  id: number;
  customerId: number;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  status: string;
  dueDate: string | null;
  serviceDate: string | null;
  paidAt: string | null;
};

export type CustomerCreditPaymentRow = {
  id: number;
  customerId: number;
  amount: string;
  allocatedAmount: string;
  unappliedAmount: string;
};

export type CustomerCreditApplicationInput = {
  sourceKey: string;
  invoiceId: number;
  amount: string | number;
};

export type CustomerCreditApplyRequest = {
  customerId: number;
  mode: "manual" | "oldest";
  amount?: string | number;
  allocations?: CustomerCreditApplicationInput[];
  createdBy?: string | null;
};

export type CustomerCreditRefundAllocationInput = {
  sourceKey: string;
  amount: string | number;
};

export type CustomerCreditRefundRequest = {
  customerId: number;
  amount: string | number;
  refundDate: string;
  method: string;
  reason: string;
  reference?: string | null;
  note?: string | null;
  mode?: "manual" | "oldest";
  allocations?: CustomerCreditRefundAllocationInput[];
  createdBy?: string | null;
};

export type CustomerCreditApplicationInsertValues = {
  sourceKey: string;
  customerId: number;
  invoiceId: number;
  amount: string;
  origin: CustomerCreditSourceType;
  createdBy: string | null;
};

export type CustomerCreditRefundInsertValues = {
  refundNumber: string;
  customerId: number;
  amount: string;
  refundDate: string;
  method: string;
  reason: string;
  reference: string | null;
  note: string | null;
  createdBy: string | null;
};

export type CustomerCreditRefundAllocationInsertValues = {
  refundId: number;
  sourceKey: string;
  amount: string;
};

export interface CustomerCreditAdapter {
  acquireCustomerLock(customerId: number): Promise<void>;
  acquireSourceLocks(sourceKeys: string[]): Promise<void>;
  acquireInvoiceLocks(invoiceIds: number[]): Promise<void>;
  findSources(customerId: number): Promise<CustomerCreditSourceRow[]>;
  findInvoicesByIds(invoiceIds: number[]): Promise<CustomerCreditInvoiceRow[]>;
  findOpenInvoicesByCustomer(customerId: number): Promise<CustomerCreditInvoiceRow[]>;
  findPaymentById(paymentId: number): Promise<CustomerCreditPaymentRow | null>;
  insertApplication(values: CustomerCreditApplicationInsertValues): Promise<{ id: number }>;
  updateInvoice(invoiceId: number, values: {
    status: string;
    amountPaid: string;
    balanceDue: string;
    paidAt: string | null;
  }): Promise<CustomerCreditInvoiceRow>;
  updatePayment(paymentId: number, values: {
    allocatedAmount: string;
    unappliedAmount: string;
  }): Promise<CustomerCreditPaymentRow>;
  insertPaymentAllocation(values: {
    paymentId: number;
    invoiceId: number;
    amount: string;
    createdBy: string | null;
  }): Promise<{ id: number }>;
  insertRefund(values: CustomerCreditRefundInsertValues): Promise<{ id: number }>;
  insertRefundAllocation(values: CustomerCreditRefundAllocationInsertValues): Promise<{ id: number }>;
}

export class CustomerCreditValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CustomerCreditValidationError";
    this.code = code;
  }
}

function parseMoney(value: string | number): bigint {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new CustomerCreditValidationError("invalid_amount", "Money amounts must be non-negative decimals with at most two decimal places");
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function positiveMoney(value: string | number): bigint {
  const cents = parseMoney(value);
  if (cents <= 0n) throw new CustomerCreditValidationError("amount_must_be_positive", "Credit amounts must be greater than zero");
  return cents;
}

function formatMoney(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function dateSortKey(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "9999-12-31";
}

function sourceDateKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function sortSources(sources: CustomerCreditSourceRow[]): CustomerCreditSourceRow[] {
  return [...sources].sort((a, b) =>
    sourceDateKey(a.createdAt).localeCompare(sourceDateKey(b.createdAt)) ||
    a.sourceKey.localeCompare(b.sourceKey),
  );
}

function sortInvoices(invoices: CustomerCreditInvoiceRow[]): CustomerCreditInvoiceRow[] {
  return [...invoices].sort((a, b) =>
    dateSortKey(a.dueDate).localeCompare(dateSortKey(b.dueDate)) ||
    dateSortKey(a.serviceDate).localeCompare(dateSortKey(b.serviceDate)) ||
    a.id - b.id,
  );
}

function isClosedInvoice(invoice: CustomerCreditInvoiceRow): boolean {
  return invoice.status === "voided" || invoice.status === "credited";
}

function invoiceAvailableBalance(invoice: CustomerCreditInvoiceRow): bigint {
  const stated = parseMoney(invoice.balanceDue);
  const total = parseMoney(invoice.totalAmount);
  const paid = parseMoney(invoice.amountPaid);
  const calculated = total > paid ? total - paid : 0n;
  return stated < calculated ? stated : calculated;
}

function requiredReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) throw new CustomerCreditValidationError("reason_required", "A reason is required");
  return reason;
}

function validateCustomerId(customerId: number): void {
  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new CustomerCreditValidationError("invalid_customer_id", "A valid customer is required");
  }
}

function buildManualApplicationPlan(
  request: CustomerCreditApplyRequest,
  sources: CustomerCreditSourceRow[],
  invoices: CustomerCreditInvoiceRow[],
): Array<{ source: CustomerCreditSourceRow; invoice: CustomerCreditInvoiceRow; cents: bigint }> {
  if (!request.allocations?.length) {
    throw new CustomerCreditValidationError("allocations_required", "Manual credit application requires allocations");
  }
  const sourcesByKey = new Map(sources.map((source) => [source.sourceKey, source]));
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const sourceTotals = new Map<string, bigint>();
  const invoiceTotals = new Map<number, bigint>();
  const seen = new Set<string>();
  return request.allocations.map((input) => {
    const source = sourcesByKey.get(input.sourceKey);
    if (!source) throw new CustomerCreditValidationError("credit_source_not_found", "Customer credit source was not found");
    const invoice = invoicesById.get(input.invoiceId);
    if (!invoice) throw new CustomerCreditValidationError("invoice_not_found", `Invoice #${input.invoiceId} was not found`);
    const cents = positiveMoney(input.amount);
    const pair = `${source.sourceKey}:${invoice.id}`;
    if (seen.has(pair)) throw new CustomerCreditValidationError("duplicate_application", "A source and invoice pair may appear only once per application");
    seen.add(pair);
    sourceTotals.set(source.sourceKey, (sourceTotals.get(source.sourceKey) ?? 0n) + cents);
    invoiceTotals.set(invoice.id, (invoiceTotals.get(invoice.id) ?? 0n) + cents);
    return { source, invoice, cents };
  }).map((plan) => {
    const sourceTotal = sourceTotals.get(plan.source.sourceKey)!;
    if (sourceTotal > parseMoney(plan.source.availableAmount)) {
      throw new CustomerCreditValidationError("credit_over_application", `Application exceeds available credit from ${plan.source.sourceKey}`);
    }
    if (invoiceTotals.get(plan.invoice.id)! > invoiceAvailableBalance(plan.invoice)) {
      throw new CustomerCreditValidationError("invoice_over_application", `Application exceeds invoice #${plan.invoice.id}'s current balance`);
    }
    return plan;
  });
}

function buildOldestApplicationPlan(
  request: CustomerCreditApplyRequest,
  sources: CustomerCreditSourceRow[],
  invoices: CustomerCreditInvoiceRow[],
): Array<{ source: CustomerCreditSourceRow; invoice: CustomerCreditInvoiceRow; cents: bigint }> {
  const remainingInput = request.amount == null ? 0n : positiveMoney(request.amount);
  if (remainingInput <= 0n) throw new CustomerCreditValidationError("amount_must_be_positive", "The amount to apply must be greater than zero");
  let remaining = remainingInput;
  const invoiceBalances = new Map(invoices.map((invoice) => [invoice.id, invoiceAvailableBalance(invoice)]));
  const plan: Array<{ source: CustomerCreditSourceRow; invoice: CustomerCreditInvoiceRow; cents: bigint }> = [];
  for (const source of sortSources(sources)) {
    let sourceRemaining = parseMoney(source.availableAmount);
    for (const invoice of sortInvoices(invoices)) {
      if (remaining <= 0n || sourceRemaining <= 0n) break;
      const invoiceRemaining = invoiceBalances.get(invoice.id) ?? 0n;
      if (invoiceRemaining <= 0n) continue;
      const cents = [remaining, sourceRemaining, invoiceRemaining].reduce((min, value) => value < min ? value : min);
      plan.push({ source, invoice, cents });
      remaining -= cents;
      sourceRemaining -= cents;
      invoiceBalances.set(invoice.id, invoiceRemaining - cents);
    }
    if (remaining <= 0n) break;
  }
  if (remaining > 0n) throw new CustomerCreditValidationError("credit_over_application", "The requested credit exceeds available customer credit or open invoice balance");
  return plan;
}

export type CustomerCreditApplicationEffect = {
  applications: Array<{ sourceKey: string; invoiceId: number; amount: string; origin: CustomerCreditSourceType }>;
  invoices: CustomerCreditInvoiceRow[];
};

export async function applyCustomerCreditCore(
  request: CustomerCreditApplyRequest,
  adapter: CustomerCreditAdapter,
  now: Date = new Date(),
): Promise<CustomerCreditApplicationEffect> {
  validateCustomerId(request.customerId);
  if (request.mode !== "manual" && request.mode !== "oldest") {
    throw new CustomerCreditValidationError("invalid_mode", "Credit application mode must be manual or oldest");
  }
  await adapter.acquireCustomerLock(request.customerId);
  const requestedKeys = request.allocations?.map((allocation) => allocation.sourceKey) ?? [];
  const initialSources = await adapter.findSources(request.customerId);
  await adapter.acquireSourceLocks(
    [...new Set(requestedKeys.length ? requestedKeys : initialSources.map((source) => source.sourceKey))].sort(),
  );
  let invoices = request.mode === "manual"
    ? await adapter.findInvoicesByIds((request.allocations ?? []).map((allocation) => allocation.invoiceId))
    : await adapter.findOpenInvoicesByCustomer(request.customerId);
  await adapter.acquireInvoiceLocks([...new Set(invoices.map((invoice) => invoice.id))].sort((a, b) => a - b));
  invoices = request.mode === "manual"
    ? await adapter.findInvoicesByIds((request.allocations ?? []).map((allocation) => allocation.invoiceId))
    : await adapter.findOpenInvoicesByCustomer(request.customerId);
  const sources = await adapter.findSources(request.customerId);
  for (const invoice of invoices) {
    if (invoice.customerId !== request.customerId) {
      throw new CustomerCreditValidationError("customer_mismatch", "Customer credit can only be applied to invoices for the same customer");
    }
    if (isClosedInvoice(invoice)) {
      throw new CustomerCreditValidationError("invoice_not_creditable", "Voided and fully credited invoices cannot receive customer credit");
    }
  }
  const plan = request.mode === "manual"
    ? buildManualApplicationPlan(request, sources, invoices)
    : buildOldestApplicationPlan(request, sources, invoices);

  const sourceRemaining = new Map(sources.map((source) => [source.sourceKey, parseMoney(source.availableAmount)]));
  const paymentState = new Map<number, CustomerCreditPaymentRow>();
  const updatedInvoices = new Map<number, CustomerCreditInvoiceRow>();
  const applications: CustomerCreditApplicationEffect["applications"] = [];
  for (const item of plan) {
    const sourceLeft = sourceRemaining.get(item.source.sourceKey) ?? 0n;
    if (item.cents > sourceLeft) {
      throw new CustomerCreditValidationError("credit_over_application", "Available customer credit changed during application");
    }
    const currentInvoice = updatedInvoices.get(item.invoice.id) ?? item.invoice;
    const currentBalance = invoiceAvailableBalance(currentInvoice);
    if (item.cents > currentBalance) {
      throw new CustomerCreditValidationError("invoice_over_application", `Invoice #${item.invoice.id} no longer has enough collectible balance`);
    }
    let updated: CustomerCreditInvoiceRow;
    if (item.source.sourceType === "payment") {
      const payment = paymentState.get(item.source.sourceId) ?? await adapter.findPaymentById(item.source.sourceId);
      if (!payment || payment.customerId !== request.customerId) {
        throw new CustomerCreditValidationError("credit_source_not_found", "The payment credit source no longer exists");
      }
      const unapplied = parseMoney(payment.unappliedAmount);
      if (item.cents > unapplied) {
        throw new CustomerCreditValidationError("credit_over_application", "Payment credit is no longer available");
      }
      const newPaid = parseMoney(currentInvoice.amountPaid) + item.cents;
      const newBalance = currentBalance - item.cents;
      updated = await adapter.updateInvoice(item.invoice.id, {
        status: newBalance === 0n ? "paid" : "partial",
        amountPaid: formatMoney(newPaid),
        balanceDue: formatMoney(newBalance),
        paidAt: newBalance === 0n ? now.toISOString() : currentInvoice.paidAt,
      });
      await adapter.insertPaymentAllocation({
        paymentId: payment.id,
        invoiceId: item.invoice.id,
        amount: formatMoney(item.cents),
        createdBy: request.createdBy ?? null,
      });
      const updatedPayment = await adapter.updatePayment(payment.id, {
        allocatedAmount: formatMoney(parseMoney(payment.allocatedAmount) + item.cents),
        unappliedAmount: formatMoney(unapplied - item.cents),
      });
      paymentState.set(payment.id, updatedPayment);
    } else {
      const newBalance = currentBalance - item.cents;
      updated = await adapter.updateInvoice(item.invoice.id, {
        status: newBalance === 0n ? "credited" : "partially_credited",
        amountPaid: currentInvoice.amountPaid,
        balanceDue: formatMoney(newBalance),
        paidAt: currentInvoice.paidAt,
      });
    }
    sourceRemaining.set(item.source.sourceKey, sourceLeft - item.cents);
    updatedInvoices.set(item.invoice.id, updated);
    await adapter.insertApplication({
      sourceKey: item.source.sourceKey,
      customerId: request.customerId,
      invoiceId: item.invoice.id,
      amount: formatMoney(item.cents),
      origin: item.source.sourceType,
      createdBy: request.createdBy ?? null,
    });
    applications.push({
      sourceKey: item.source.sourceKey,
      invoiceId: item.invoice.id,
      amount: formatMoney(item.cents),
      origin: item.source.sourceType,
    });
  }
  return { applications, invoices: [...updatedInvoices.values()] };
}

function buildManualRefundPlan(
  request: CustomerCreditRefundRequest,
  sources: CustomerCreditSourceRow[],
): Array<{ source: CustomerCreditSourceRow; cents: bigint }> {
  if (!request.allocations?.length) {
    throw new CustomerCreditValidationError("allocations_required", "Manual refund requires source allocations");
  }
  const sourcesByKey = new Map(sources.map((source) => [source.sourceKey, source]));
  const seen = new Set<string>();
  const totals = new Map<string, bigint>();
  const plan = request.allocations.map((input) => {
    const source = sourcesByKey.get(input.sourceKey);
    if (!source) throw new CustomerCreditValidationError("credit_source_not_found", "Customer credit source was not found");
    if (seen.has(source.sourceKey)) throw new CustomerCreditValidationError("duplicate_source", "A refund source may appear only once");
    seen.add(source.sourceKey);
    const cents = positiveMoney(input.amount);
    totals.set(source.sourceKey, cents);
    return { source, cents };
  });
  const requested = positiveMoney(request.amount);
  const total = plan.reduce((sum, item) => sum + item.cents, 0n);
  if (total !== requested) throw new CustomerCreditValidationError("refund_amount_mismatch", "Refund allocations must equal the refund amount");
  for (const item of plan) {
    if (item.cents > parseMoney(item.source.availableAmount)) {
      throw new CustomerCreditValidationError("credit_over_refund", `Refund exceeds available credit from ${item.source.sourceKey}`);
    }
  }
  return plan;
}

function buildOldestRefundPlan(
  request: CustomerCreditRefundRequest,
  sources: CustomerCreditSourceRow[],
): Array<{ source: CustomerCreditSourceRow; cents: bigint }> {
  let remaining = positiveMoney(request.amount);
  const plan: Array<{ source: CustomerCreditSourceRow; cents: bigint }> = [];
  for (const source of sortSources(sources)) {
    if (remaining <= 0n) break;
    const available = parseMoney(source.availableAmount);
    if (available <= 0n) continue;
    const cents = remaining < available ? remaining : available;
    plan.push({ source, cents });
    remaining -= cents;
  }
  if (remaining > 0n) throw new CustomerCreditValidationError("credit_over_refund", "Refund exceeds available customer credit");
  return plan;
}

export type CustomerCreditRefundEffect = {
  refundId: number;
  refundNumber: string;
  amount: string;
  allocations: Array<{ sourceKey: string; amount: string; origin: CustomerCreditSourceType }>;
};

export async function createCustomerCreditRefundCore(
  request: CustomerCreditRefundRequest,
  refundNumber: string,
  adapter: CustomerCreditAdapter,
): Promise<CustomerCreditRefundEffect> {
  validateCustomerId(request.customerId);
  const amount = positiveMoney(request.amount);
  if (!request.refundDate || !/^\d{4}-\d{2}-\d{2}$/.test(request.refundDate)) {
    throw new CustomerCreditValidationError("invalid_refund_date", "Refund date must be YYYY-MM-DD");
  }
  if (!request.method?.trim()) throw new CustomerCreditValidationError("invalid_method", "Refund method is required");
  const reason = requiredReason(request.reason);
  const mode = request.mode ?? "oldest";
  if (mode !== "manual" && mode !== "oldest") {
    throw new CustomerCreditValidationError("invalid_mode", "Refund mode must be manual or oldest");
  }
  await adapter.acquireCustomerLock(request.customerId);
  const requestedKeys = request.allocations?.map((allocation) => allocation.sourceKey) ?? [];
  const initialSources = await adapter.findSources(request.customerId);
  await adapter.acquireSourceLocks(
    [...new Set(requestedKeys.length ? requestedKeys : initialSources.map((source) => source.sourceKey))].sort(),
  );
  const sources = await adapter.findSources(request.customerId);
  const plan = mode === "manual" ? buildManualRefundPlan(request, sources) : buildOldestRefundPlan(request, sources);
  const paymentState = new Map<number, CustomerCreditPaymentRow>();
  for (const item of plan) {
    if (item.source.sourceType !== "payment") continue;
    const payment = paymentState.get(item.source.sourceId) ?? await adapter.findPaymentById(item.source.sourceId);
    if (!payment || payment.customerId !== request.customerId || item.cents > parseMoney(payment.unappliedAmount)) {
      throw new CustomerCreditValidationError("credit_over_refund", "Payment credit is no longer available for refund");
    }
    const updated = await adapter.updatePayment(payment.id, {
      allocatedAmount: payment.allocatedAmount,
      unappliedAmount: formatMoney(parseMoney(payment.unappliedAmount) - item.cents),
    });
    paymentState.set(payment.id, updated);
  }
  const refund = await adapter.insertRefund({
    refundNumber,
    customerId: request.customerId,
    amount: formatMoney(amount),
    refundDate: request.refundDate,
    method: request.method.trim(),
    reason,
    reference: request.reference?.trim() || null,
    note: request.note?.trim() || null,
    createdBy: request.createdBy ?? null,
  });
  const allocations = [];
  for (const item of plan) {
    await adapter.insertRefundAllocation({
      refundId: refund.id,
      sourceKey: item.source.sourceKey,
      amount: formatMoney(item.cents),
    });
    allocations.push({ sourceKey: item.source.sourceKey, amount: formatMoney(item.cents), origin: item.source.sourceType });
  }
  return { refundId: refund.id, refundNumber, amount: formatMoney(amount), allocations };
}