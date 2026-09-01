export type PaymentMode = "manual" | "auto";

export const MANUAL_PAYMENT_METHODS = [
  "cash",
  "check",
  "ach",
  "bank_transfer",
  "other",
  // Used by the existing one-click "Mark Paid" invoice action.
  "manual",
] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export type PaymentInvoiceRow = {
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

export type PaymentRow = {
  id: number;
  customerId: number;
  amount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  paymentDate: string;
  method: string;
  reference: string | null;
  note: string | null;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type PaymentAllocationRow = {
  id: number;
  paymentId: number;
  invoiceId: number;
  amount: string;
  createdAt: Date | string;
  createdBy: string | null;
};

export type PaymentAllocationInput = {
  invoiceId: number;
  amount: string | number;
};

export type PaymentRequest = {
  customerId: number;
  amount: string | number;
  paymentDate: string;
  method: string;
  reference?: string | null;
  note?: string | null;
  mode: PaymentMode;
  allocations?: PaymentAllocationInput[];
  createdBy?: string | null;
};

export type AllocationRequest = {
  mode: PaymentMode;
  allocations?: PaymentAllocationInput[];
  createdBy?: string | null;
};

export type PaymentInsertValues = {
  customerId: number;
  amount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  paymentDate: string;
  method: string;
  reference: string | null;
  note: string | null;
  status: string;
};

export type AllocationInsertValues = {
  paymentId: number;
  invoiceId: number;
  amount: string;
  createdBy: string | null;
};

export type InvoicePaymentUpdate = {
  status: string;
  amountPaid: string;
  balanceDue: string;
  paidAt: string | null;
};

export interface PaymentAdapter {
  acquireInvoiceLocks(invoiceIds: number[]): Promise<void>;
  acquireCustomerOpenInvoiceLocks(customerId: number): Promise<void>;
  acquirePaymentLock(paymentId: number): Promise<void>;
  findInvoicesByIds(invoiceIds: number[]): Promise<PaymentInvoiceRow[]>;
  findOpenInvoicesByCustomer(customerId: number): Promise<PaymentInvoiceRow[]>;
  insertPayment(values: PaymentInsertValues): Promise<PaymentRow>;
  findPaymentById(paymentId: number): Promise<PaymentRow | null>;
  insertAllocation(values: AllocationInsertValues): Promise<PaymentAllocationRow>;
  updatePayment(paymentId: number, values: Pick<PaymentInsertValues, "allocatedAmount" | "unappliedAmount">): Promise<PaymentRow>;
  syncUnappliedCreditSource?(payment: PaymentRow): Promise<void>;
  updateInvoice(invoiceId: number, values: InvoicePaymentUpdate): Promise<PaymentInvoiceRow>;
}

export type PaymentEffect = {
  payment: PaymentRow;
  allocations: Array<{ invoiceId: number; amount: string }>;
  invoices: PaymentInvoiceRow[];
};

export class PaymentValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentValidationError";
    this.code = code;
  }
}

function isValidPaymentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function parseMoneyCents(value: string | number): bigint {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new PaymentValidationError("invalid_amount", "Money amounts must be non-negative decimals with at most two decimal places");
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function parsePositiveMoneyCents(value: string | number): bigint {
  const cents = parseMoneyCents(value);
  if (cents <= 0n) {
    throw new PaymentValidationError("amount_must_be_positive", "Payment amounts must be greater than zero");
  }
  return cents;
}

export function formatMoneyCents(cents: bigint): string {
  if (cents < 0n) throw new PaymentValidationError("negative_amount", "Money amounts cannot be negative");
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

function dateSortKey(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "9999-12-31";
}

export function sortOldestOpenInvoices<T extends Pick<PaymentInvoiceRow, "dueDate" | "serviceDate" | "id">>(
  invoices: T[],
): T[] {
  return [...invoices].sort((a, b) =>
    dateSortKey(a.dueDate).localeCompare(dateSortKey(b.dueDate)) ||
    dateSortKey(a.serviceDate).localeCompare(dateSortKey(b.serviceDate)) ||
    a.id - b.id,
  );
}

function validateMode(mode: string): asserts mode is PaymentMode {
  if (mode !== "manual" && mode !== "auto") {
    throw new PaymentValidationError("invalid_mode", "Payment mode must be manual or auto");
  }
}

function normalizeManualAllocations(
  allocations: PaymentAllocationInput[] | undefined,
): Array<{ invoiceId: number; cents: bigint }> {
  const entries = allocations ?? [];
  const seen = new Set<number>();
  return entries.map((entry) => {
    if (!Number.isInteger(entry.invoiceId) || entry.invoiceId <= 0) {
      throw new PaymentValidationError("invalid_invoice_id", "Each allocation must reference a valid invoice");
    }
    if (seen.has(entry.invoiceId)) {
      throw new PaymentValidationError("duplicate_invoice", "An invoice may appear only once per payment");
    }
    seen.add(entry.invoiceId);
    return { invoiceId: entry.invoiceId, cents: parsePositiveMoneyCents(entry.amount) };
  });
}

function allocationPlan(
  paymentCents: bigint,
  invoices: PaymentInvoiceRow[],
  mode: PaymentMode,
  manual: Array<{ invoiceId: number; cents: bigint }>,
  customerId: number,
): Array<{ invoice: PaymentInvoiceRow; cents: bigint }> {
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  if (mode === "manual") {
    const plan = manual.map(({ invoiceId, cents }) => {
      const invoice = byId.get(invoiceId);
      if (!invoice) throw new PaymentValidationError("invoice_not_found", `Invoice #${invoiceId} was not found`);
      if (invoice.customerId !== customerId) {
        throw new PaymentValidationError("customer_mismatch", "Payments can only be allocated to invoices for the same customer");
      }
      if (invoice.status === "voided" || invoice.status === "credited") {
        throw new PaymentValidationError("invoice_not_payable", "Voided and fully credited invoices cannot receive payments");
      }
      const total = parseMoneyCents(invoice.totalAmount);
      const paid = parseMoneyCents(invoice.amountPaid);
      const statedBalance = parseMoneyCents(invoice.balanceDue);
      const calculatedBalance = total > paid ? total - paid : 0n;
      const available = statedBalance < calculatedBalance ? statedBalance : calculatedBalance;
      if (cents > available) {
        throw new PaymentValidationError("invoice_over_allocation", `Allocation exceeds invoice #${invoice.id}'s current balance`);
      }
      return { invoice, cents };
    });
    if (plan.reduce((sum, item) => sum + item.cents, 0n) > paymentCents) {
      throw new PaymentValidationError("over_payment_allocation", "Allocation total cannot exceed the payment amount");
    }
    return plan;
  }

  let remaining = paymentCents;
  const plan: Array<{ invoice: PaymentInvoiceRow; cents: bigint }> = [];
  for (const invoice of sortOldestOpenInvoices(invoices)) {
    if (remaining <= 0n) break;
    const total = parseMoneyCents(invoice.totalAmount);
    const paid = parseMoneyCents(invoice.amountPaid);
    const statedBalance = parseMoneyCents(invoice.balanceDue);
    const calculatedBalance = total > paid ? total - paid : 0n;
    const balance = statedBalance < calculatedBalance ? statedBalance : calculatedBalance;
    if (balance <= 0n) continue;
    const cents = remaining < balance ? remaining : balance;
    plan.push({ invoice, cents });
    remaining -= cents;
  }
  return plan;
}

async function applyPlan(
  payment: PaymentRow,
  paymentCents: bigint,
  adapter: PaymentAdapter,
  plan: Array<{ invoice: PaymentInvoiceRow; cents: bigint }>,
  createdBy: string | null | undefined,
  now: Date,
): Promise<PaymentEffect> {
  let allocatedCents = parseMoneyCents(payment.allocatedAmount);
  let unappliedCents = parseMoneyCents(payment.unappliedAmount);
  const updatedInvoices: PaymentInvoiceRow[] = [];
  const allocations: Array<{ invoiceId: number; amount: string }> = [];

  const additional = plan.reduce((sum, item) => sum + item.cents, 0n);
  if (additional > unappliedCents) {
    throw new PaymentValidationError("over_payment_allocation", "Allocation total cannot exceed the payment's unapplied amount");
  }

  for (const item of plan) {
    if (item.invoice.status === "voided" || item.invoice.status === "credited") {
      throw new PaymentValidationError("invoice_not_payable", "Voided and fully credited invoices cannot receive payments");
    }
    const total = parseMoneyCents(item.invoice.totalAmount);
    const paid = parseMoneyCents(item.invoice.amountPaid);
    const statedBalance = parseMoneyCents(item.invoice.balanceDue);
    const calculatedBalance = total > paid ? total - paid : 0n;
    const available = statedBalance < calculatedBalance ? statedBalance : calculatedBalance;
    if (item.cents > available) {
      throw new PaymentValidationError("invoice_over_allocation", `Allocation exceeds invoice #${item.invoice.id}'s current balance`);
    }
    const newPaid = paid + item.cents;
    // Credits reduce the collectible balance without changing amountPaid.
    // Decrement the current locked balance rather than rebuilding it from the
    // original total, otherwise a payment after a partial credit would
    // accidentally restore the credited amount.
    const newBalance = available > item.cents ? available - item.cents : 0n;
    const updated = await adapter.updateInvoice(item.invoice.id, {
      status: newBalance === 0n ? "paid" : "partial",
      amountPaid: formatMoneyCents(newPaid),
      balanceDue: formatMoneyCents(newBalance),
      paidAt: newBalance === 0n ? now.toISOString() : item.invoice.paidAt,
    });
    await adapter.insertAllocation({
      paymentId: payment.id,
      invoiceId: item.invoice.id,
      amount: formatMoneyCents(item.cents),
      createdBy: createdBy ?? null,
    });
    allocatedCents += item.cents;
    unappliedCents -= item.cents;
    allocations.push({ invoiceId: item.invoice.id, amount: formatMoneyCents(item.cents) });
    updatedInvoices.push(updated);
  }

  if (allocatedCents + unappliedCents !== paymentCents) {
    throw new PaymentValidationError("payment_balance_mismatch", "Payment allocation totals do not balance");
  }
  const updatedPayment = await adapter.updatePayment(payment.id, {
    allocatedAmount: formatMoneyCents(allocatedCents),
    unappliedAmount: formatMoneyCents(unappliedCents),
  });
  await adapter.syncUnappliedCreditSource?.(updatedPayment);
  return { payment: updatedPayment, allocations, invoices: updatedInvoices };
}

async function preparePlan(
  customerId: number,
  paymentCents: bigint,
  input: AllocationRequest,
  adapter: PaymentAdapter,
): Promise<Array<{ invoice: PaymentInvoiceRow; cents: bigint }>> {
  validateMode(input.mode);
  const manual = input.mode === "manual" ? normalizeManualAllocations(input.allocations) : [];
  if (input.mode === "manual") {
    await adapter.acquireInvoiceLocks([...manual.map((entry) => entry.invoiceId)].sort((a, b) => a - b));
  } else {
    await adapter.acquireCustomerOpenInvoiceLocks(customerId);
  }
  const invoices = input.mode === "manual"
    ? await adapter.findInvoicesByIds(manual.map((entry) => entry.invoiceId))
    : await adapter.findOpenInvoicesByCustomer(customerId);
  return allocationPlan(paymentCents, invoices, input.mode, manual, customerId);
}

export async function createPaymentCore(
  input: PaymentRequest,
  adapter: PaymentAdapter,
  now: Date = new Date(),
): Promise<PaymentEffect> {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) {
    throw new PaymentValidationError("invalid_customer_id", "A valid customer is required");
  }
  const paymentCents = parsePositiveMoneyCents(input.amount);
  if (!isValidPaymentDate(input.paymentDate)) {
    throw new PaymentValidationError("invalid_payment_date", "Payment date must be a valid YYYY-MM-DD date");
  }
  const method = input.method?.trim() ?? "";
  if (!MANUAL_PAYMENT_METHODS.includes(method as ManualPaymentMethod)) {
    throw new PaymentValidationError("invalid_method", "Payment method is not supported");
  }

  const plan = await preparePlan(input.customerId, paymentCents, input, adapter);
  const additional = plan.reduce((sum, item) => sum + item.cents, 0n);
  if (input.mode === "manual" && additional !== paymentCents) {
    throw new PaymentValidationError(
      "manual_allocation_mismatch",
      "A manual payment must be fully allocated to the selected invoice balance",
    );
  }
  const payment = await adapter.insertPayment({
    customerId: input.customerId,
    amount: formatMoneyCents(paymentCents),
    allocatedAmount: "0.00",
    unappliedAmount: formatMoneyCents(paymentCents),
    paymentDate: input.paymentDate,
    method,
    reference: input.reference?.trim() || null,
    note: input.note?.trim() || null,
    status: "posted",
  });
  if (additional === 0n) {
    return applyPlan(payment, paymentCents, adapter, [], input.createdBy, now);
  }
  return applyPlan(payment, paymentCents, adapter, plan, input.createdBy, now);
}

export async function allocateExistingPaymentCore(
  paymentId: number,
  input: AllocationRequest,
  adapter: PaymentAdapter,
  now: Date = new Date(),
): Promise<PaymentEffect> {
  await adapter.acquirePaymentLock(paymentId);
  const payment = await adapter.findPaymentById(paymentId);
  if (!payment) throw new PaymentValidationError("payment_not_found", "Payment not found");
  const paymentCents = parseMoneyCents(payment.amount);
  const unappliedCents = parseMoneyCents(payment.unappliedAmount);
  if (unappliedCents <= 0n) {
    throw new PaymentValidationError("no_unapplied_credit", "This payment has no unapplied credit remaining");
  }
  const plan = await preparePlan(payment.customerId, unappliedCents, input, adapter);
  return applyPlan(payment, paymentCents, adapter, plan, input.createdBy, now);
}