export type ReconciliationSourceOrigin = "payment" | "credit_note";
export type ReconciliationTransactionKind =
  | "payment"
  | "refund"
  | "invoice_credit"
  | "customer_credit_application";

export type FinancialReconciliationRange = {
  startDate: string;
  endDate: string;
  timezone: string;
};

export type ReconciliationPayment = {
  id: number;
  customerId: number;
  amount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  paymentDate: string;
  method: string;
  reference?: string | null;
  createdAt: Date | string;
};

export type ReconciliationPaymentAllocation = {
  id: number;
  paymentId: number;
  invoiceId: number;
  amount: string;
  createdAt: Date | string;
};

export type ReconciliationSource = {
  sourceKey: string;
  sourceType: ReconciliationSourceOrigin;
  sourceId: number;
  customerId: number;
  originalAmount: string;
  availableAmount: string;
  createdAt: Date | string;
};

export type ReconciliationApplication = {
  id: number;
  sourceKey: string;
  customerId: number;
  invoiceId: number;
  amount: string;
  origin: ReconciliationSourceOrigin;
  createdAt: Date | string;
};

export type ReconciliationRefund = {
  id: number;
  refundNumber: string;
  customerId: number;
  amount: string;
  refundDate: string;
  method: string;
  reason: string;
  createdAt: Date | string;
};

export type ReconciliationRefundAllocation = {
  id: number;
  refundId: number;
  sourceKey: string;
  amount: string;
};

export type ReconciliationCreditNote = {
  id: number;
  invoiceId: number;
  creditNumber: string;
  totalAmount: string;
  balanceReductionAmount: string;
  customerCreditAmount: string;
  createdAt: Date | string;
};

export type ReconciliationInvoice = {
  id: number;
  invoiceNumber: string;
  customerId: number;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  status: string;
  createdAt: Date | string;
};

export type ReconciliationSnapshot = {
  payments: ReconciliationPayment[];
  paymentAllocations: ReconciliationPaymentAllocation[];
  sources: ReconciliationSource[];
  applications: ReconciliationApplication[];
  refunds: ReconciliationRefund[];
  refundAllocations: ReconciliationRefundAllocation[];
  creditNotes: ReconciliationCreditNote[];
  invoices: ReconciliationInvoice[];
};

export type ReconciliationCustomer = {
  id: number;
  name: string;
};

export type ReconciliationTransaction = {
  id: string;
  recordType: ReconciliationTransactionKind;
  recordId: number;
  date: string;
  amountCents: number;
  cashClass: "cash_received" | "recorded_refund" | "non_cash_adjustment";
  method: string | null;
  sourceOrigin: ReconciliationSourceOrigin | "mixed" | null;
  customerId: number | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  label: string;
};

export type ReconciliationFilters = {
  kind?: ReconciliationTransactionKind;
  method?: string;
  source?: ReconciliationSourceOrigin;
};

export type ReconciliationDiscrepancy = {
  id: string;
  recordType: "payment" | "customer_credit_source" | "refund" | "invoice";
  recordId: number;
  reason: string;
  expectedCents: number;
  actualCents: number;
  differenceCents: number;
};

export type ReconciliationSummary = {
  range: FinancialReconciliationRange;
  cashReceivedCents: number;
  recordedRefundsCents: number;
  netRecordedCashActivityCents: number;
  invoiceCreditsCents: number;
  customerCreditApplicationsCents: number;
  customerCreditRefundsCents: number;
  daily: Array<{
    date: string;
    cashReceivedCents: number;
    recordedRefundsCents: number;
    netRecordedCashActivityCents: number;
    invoiceCreditsCents: number;
    customerCreditApplicationsCents: number;
  }>;
  methods: Array<{
    method: string;
    cashReceivedCents: number;
    recordedRefundsCents: number;
    netRecordedCashActivityCents: number;
  }>;
  origins: Array<{
    origin: ReconciliationSourceOrigin;
    applicationsCents: number;
    refundsCents: number;
  }>;
  currentPosition: {
    unappliedPaymentCents: number;
    availableCustomerCreditCents: number;
    outstandingArCents: number;
  };
};

export class FinancialReconciliationValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinancialReconciliationValidationError";
    this.code = code;
  }
}

export function moneyToCents(value: string | number): bigint {
  const raw = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new FinancialReconciliationValidationError("invalid_money", "Financial amounts must be signed decimals with at most two decimal places");
  }
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function centsNumber(value: string | number): number {
  return Number(moneyToCents(value));
}

function toNumber(cents: bigint): number {
  const result = Number(cents);
  if (!Number.isSafeInteger(result)) {
    throw new FinancialReconciliationValidationError("amount_out_of_range", "Financial amount is outside the supported integer-cent range");
  }
  return result;
}

export function centsToMoney(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function dateOnly(value: Date | string, timezone: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "9999-12-31";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function localDateFromInstant(value: Date | string, timezone: string): string {
  return dateOnly(value, timezone);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === value;
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function resolveFinancialReconciliationRange(input: {
  startDate?: unknown;
  endDate?: unknown;
  timezone?: unknown;
  now?: Date;
} = {}): FinancialReconciliationRange {
  const timezone = typeof input.timezone === "string" && input.timezone.trim()
    ? input.timezone.trim()
    : "America/Chicago";
  if (!validTimezone(timezone)) {
    throw new FinancialReconciliationValidationError("invalid_timezone", "Timezone must be a valid IANA timezone");
  }

  const today = dateOnly(input.now ?? new Date(), timezone);
  const defaultStart = `${today.slice(0, 7)}-01`;
  const startDate = input.startDate == null || input.startDate === "" ? defaultStart : String(input.startDate);
  const endDate = input.endDate == null || input.endDate === "" ? today : String(input.endDate);
  if (!validDate(startDate) || !validDate(endDate)) {
    throw new FinancialReconciliationValidationError("invalid_date", "Dates must use YYYY-MM-DD format");
  }
  if (startDate > endDate) {
    throw new FinancialReconciliationValidationError("invalid_date_range", "Start date must be on or before end date");
  }
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 366) {
    throw new FinancialReconciliationValidationError("range_too_large", "Date range cannot exceed 366 days");
  }
  return { startDate, endDate, timezone };
}

function inRange(date: string, range: FinancialReconciliationRange): boolean {
  return date >= range.startDate && date <= range.endDate;
}

function originForRefund(
  refundId: number,
  allocations: ReconciliationRefundAllocation[],
  sourceByKey: Map<string, ReconciliationSource>,
): ReconciliationSourceOrigin | "mixed" | null {
  const origins = new Set(
    allocations
      .filter((allocation) => allocation.refundId === refundId)
      .map((allocation) => sourceByKey.get(allocation.sourceKey)?.sourceType
        ?? (allocation.sourceKey.startsWith("payment:") ? "payment" : "credit_note")),
  );
  if (origins.size === 1) return [...origins][0] as ReconciliationSourceOrigin;
  return origins.size > 1 ? "mixed" : null;
}

function buildTransactions(
  snapshot: ReconciliationSnapshot,
  range: FinancialReconciliationRange,
  customers: Map<number, string>,
  filters: ReconciliationFilters = {},
): ReconciliationTransaction[] {
  const sourceByKey = new Map(snapshot.sources.map((source) => [source.sourceKey, source]));
  const invoiceById = new Map(snapshot.invoices.map((invoice) => [invoice.id, invoice]));
  const transactions: ReconciliationTransaction[] = [];

  for (const payment of snapshot.payments) {
    if (!inRange(payment.paymentDate, range)) continue;
    transactions.push({
      id: `payment:${payment.id}`,
      recordType: "payment",
      recordId: payment.id,
      date: payment.paymentDate,
      amountCents: centsNumber(payment.amount),
      cashClass: "cash_received",
      method: payment.method,
      sourceOrigin: "payment",
      customerId: payment.customerId,
      invoiceId: null,
      invoiceNumber: null,
      label: `Payment #${payment.id}${customers.get(payment.customerId) ? ` · ${customers.get(payment.customerId)}` : ""}`,
    });
  }
  for (const refund of snapshot.refunds) {
    if (!inRange(refund.refundDate, range)) continue;
    transactions.push({
      id: `refund:${refund.id}`,
      recordType: "refund",
      recordId: refund.id,
      date: refund.refundDate,
      amountCents: centsNumber(refund.amount),
      cashClass: "recorded_refund",
      method: refund.method,
      sourceOrigin: originForRefund(refund.id, snapshot.refundAllocations, sourceByKey),
      customerId: refund.customerId,
      invoiceId: null,
      invoiceNumber: null,
      label: `Refund ${refund.refundNumber}`,
    });
  }
  for (const note of snapshot.creditNotes) {
    const date = localDateFromInstant(note.createdAt, range.timezone);
    if (!inRange(date, range)) continue;
    const invoice = invoiceById.get(note.invoiceId);
    transactions.push({
      id: `invoice-credit:${note.id}`,
      recordType: "invoice_credit",
      recordId: note.id,
      date,
      amountCents: centsNumber(note.totalAmount),
      cashClass: "non_cash_adjustment",
      method: null,
      sourceOrigin: "credit_note",
      customerId: invoice?.customerId ?? null,
      invoiceId: note.invoiceId,
      invoiceNumber: invoice?.invoiceNumber ?? null,
      label: `Credit note ${note.creditNumber}`,
    });
  }
  for (const application of snapshot.applications) {
    const date = localDateFromInstant(application.createdAt, range.timezone);
    if (!inRange(date, range)) continue;
    const invoice = invoiceById.get(application.invoiceId);
    transactions.push({
      id: `customer-credit-application:${application.id}`,
      recordType: "customer_credit_application",
      recordId: application.id,
      date,
      amountCents: centsNumber(application.amount),
      cashClass: "non_cash_adjustment",
      method: null,
      sourceOrigin: application.origin,
      customerId: application.customerId,
      invoiceId: application.invoiceId,
      invoiceNumber: invoice?.invoiceNumber ?? null,
      label: `Customer credit applied to ${invoice?.invoiceNumber ?? `Invoice #${application.invoiceId}`}`,
    });
  }

  return transactions
    .filter((transaction) =>
      (!filters.kind || transaction.recordType === filters.kind) &&
      (!filters.method || transaction.method === filters.method) &&
      (!filters.source || transaction.sourceOrigin === filters.source),
    )
    .sort((a, b) =>
    b.date.localeCompare(a.date) ||
    a.recordType.localeCompare(b.recordType) ||
    b.recordId - a.recordId,
  );
}

function addAmount(map: Map<string, bigint>, key: string, amount: string | number): void {
  map.set(key, (map.get(key) ?? 0n) + moneyToCents(amount));
}

function buildDiscrepancies(snapshot: ReconciliationSnapshot): ReconciliationDiscrepancy[] {
  const discrepancies: ReconciliationDiscrepancy[] = [];
  const allocationsByPayment = new Map<string, bigint>();
  for (const allocation of snapshot.paymentAllocations) {
    addAmount(allocationsByPayment, String(allocation.paymentId), allocation.amount);
  }
  const refundsByPaymentSource = new Map<string, bigint>();
  for (const allocation of snapshot.refundAllocations) {
    if (!allocation.sourceKey.startsWith("payment:")) continue;
    const paymentId = Number(allocation.sourceKey.slice("payment:".length));
    if (Number.isInteger(paymentId)) addAmount(refundsByPaymentSource, String(paymentId), allocation.amount);
  }
  for (const payment of snapshot.payments) {
    const expected = moneyToCents(payment.allocatedAmount) + moneyToCents(payment.unappliedAmount) + (refundsByPaymentSource.get(String(payment.id)) ?? 0n);
    const actual = moneyToCents(payment.amount);
  if (actual !== expected) {
      discrepancies.push({
        id: `payment:${payment.id}`,
        recordType: "payment",
        recordId: payment.id,
        reason: "Payment amount does not equal direct allocations plus available unapplied amount and recorded payment-origin refunds.",
        expectedCents: toNumber(expected),
        actualCents: toNumber(actual),
        differenceCents: toNumber(actual - expected),
      });
    }
  }

  const applicationsBySource = new Map<string, bigint>();
  for (const application of snapshot.applications) addAmount(applicationsBySource, application.sourceKey, application.amount);
  const directPaymentAllocationsBySource = new Map<string, bigint>();
  for (const allocation of snapshot.paymentAllocations) {
    addAmount(directPaymentAllocationsBySource, `payment:${allocation.paymentId}`, allocation.amount);
  }
  const refundsBySource = new Map<string, bigint>();
  for (const allocation of snapshot.refundAllocations) addAmount(refundsBySource, allocation.sourceKey, allocation.amount);
  for (const source of snapshot.sources) {
    const expected = (directPaymentAllocationsBySource.get(source.sourceKey) ?? 0n) +
      (applicationsBySource.get(source.sourceKey) ?? 0n) +
      (refundsBySource.get(source.sourceKey) ?? 0n) +
      moneyToCents(source.availableAmount);
    const actual = moneyToCents(source.originalAmount);
    if (actual !== expected) {
      discrepancies.push({
        id: `customer-credit-source:${source.sourceKey}`,
        recordType: "customer_credit_source",
        recordId: source.sourceId,
        reason: "Customer-credit source issued value does not equal applications plus refunds plus currently available value.",
        expectedCents: toNumber(expected),
        actualCents: toNumber(actual),
        differenceCents: toNumber(actual - expected),
      });
    }
  }

  const allocationsByRefund = new Map<string, bigint>();
  for (const allocation of snapshot.refundAllocations) addAmount(allocationsByRefund, String(allocation.refundId), allocation.amount);
  for (const refund of snapshot.refunds) {
    const expected = allocationsByRefund.get(String(refund.id)) ?? 0n;
    const actual = moneyToCents(refund.amount);
    if (actual !== expected) {
      discrepancies.push({
        id: `refund:${refund.id}`,
        recordType: "refund",
        recordId: refund.id,
        reason: "Recorded refund header amount does not equal its source allocations.",
        expectedCents: toNumber(expected),
        actualCents: toNumber(actual),
        differenceCents: toNumber(actual - expected),
      });
    }
  }

  const notesByInvoice = new Map<string, bigint>();
  for (const note of snapshot.creditNotes) addAmount(notesByInvoice, String(note.invoiceId), note.balanceReductionAmount);
  const creditNoteApplicationsByInvoice = new Map<string, bigint>();
  for (const application of snapshot.applications) {
    if (application.origin === "credit_note") addAmount(creditNoteApplicationsByInvoice, String(application.invoiceId), application.amount);
  }
  for (const invoice of snapshot.invoices) {
    if (invoice.status === "voided") continue;
    const total = moneyToCents(invoice.totalAmount);
    const balanceReduction = notesByInvoice.get(String(invoice.id)) ?? 0n;
    const creditApplications = creditNoteApplicationsByInvoice.get(String(invoice.id)) ?? 0n;
    const cashPaid = moneyToCents(invoice.amountPaid);
    const remaining = moneyToCents(invoice.balanceDue);
    const expectedAdjusted = cashPaid + creditApplications + remaining;
    const adjusted = total - balanceReduction;
    const overpaid = invoice.status === "paid" && cashPaid > adjusted;
    if (!overpaid && adjusted !== expectedAdjusted) {
      discrepancies.push({
        id: `invoice:${invoice.id}`,
        recordType: "invoice",
        recordId: invoice.id,
        reason: "Adjusted invoice amount does not equal cash paid plus credit-note-origin customer-credit applications plus remaining balance.",
        expectedCents: toNumber(expectedAdjusted),
        actualCents: toNumber(adjusted),
        differenceCents: toNumber(adjusted - expectedAdjusted),
      });
    }
  }
  return discrepancies.sort((a, b) =>
    a.recordType.localeCompare(b.recordType) || a.recordId - b.recordId || a.id.localeCompare(b.id),
  );
}

export function buildFinancialReconciliation(
  snapshot: ReconciliationSnapshot,
  range: FinancialReconciliationRange,
  customers: ReconciliationCustomer[] = [],
  filters: ReconciliationFilters = {},
) {
  const customerMap = new Map(customers.map((customer) => [customer.id, customer.name]));
  const transactions = buildTransactions(snapshot, range, customerMap, filters);
  const daily = new Map<string, ReconciliationSummary["daily"][number]>();
  for (let cursor = range.startDate; cursor <= range.endDate;) {
    daily.set(cursor, {
      date: cursor,
      cashReceivedCents: 0,
      recordedRefundsCents: 0,
      netRecordedCashActivityCents: 0,
      invoiceCreditsCents: 0,
      customerCreditApplicationsCents: 0,
    });
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }

  const methods = new Map<string, { cashReceivedCents: bigint; recordedRefundsCents: bigint }>();
  const origins = new Map<ReconciliationSourceOrigin, { applicationsCents: bigint; refundsCents: bigint }>([
    ["payment", { applicationsCents: 0n, refundsCents: 0n }],
    ["credit_note", { applicationsCents: 0n, refundsCents: 0n }],
  ]);
  let cashReceived = 0n;
  let recordedRefunds = 0n;
  let invoiceCredits = 0n;
  let customerCreditApplications = 0n;
  let customerCreditRefunds = 0n;
  for (const transaction of transactions) {
    const day = daily.get(transaction.date);
    const amount = BigInt(transaction.amountCents);
    if (transaction.recordType === "payment") {
      cashReceived += amount;
      if (day) day.cashReceivedCents += transaction.amountCents;
      const method = transaction.method ?? "unknown";
      const bucket = methods.get(method) ?? { cashReceivedCents: 0n, recordedRefundsCents: 0n };
      bucket.cashReceivedCents += amount;
      methods.set(method, bucket);
    } else if (transaction.recordType === "refund") {
      recordedRefunds += amount;
      customerCreditRefunds += amount;
      if (day) day.recordedRefundsCents += transaction.amountCents;
      const method = transaction.method ?? "unknown";
      const bucket = methods.get(method) ?? { cashReceivedCents: 0n, recordedRefundsCents: 0n };
      bucket.recordedRefundsCents += amount;
      methods.set(method, bucket);
      if (transaction.sourceOrigin && transaction.sourceOrigin !== "mixed") {
        origins.get(transaction.sourceOrigin)!.refundsCents += amount;
      }
    } else if (transaction.recordType === "invoice_credit") {
      invoiceCredits += amount;
      if (day) day.invoiceCreditsCents += transaction.amountCents;
    } else {
      customerCreditApplications += amount;
      if (day) day.customerCreditApplicationsCents += transaction.amountCents;
      if (transaction.sourceOrigin && transaction.sourceOrigin !== "mixed") {
        origins.get(transaction.sourceOrigin)!.applicationsCents += amount;
      }
    }
  }

  const unappliedPayments = snapshot.payments.reduce((sum, payment) => sum + moneyToCents(payment.unappliedAmount), 0n);
  const availableCustomerCredit = snapshot.sources
    .filter((source) => source.sourceType === "credit_note")
    .reduce((sum, source) => sum + moneyToCents(source.availableAmount), 0n);
  const outstandingAr = snapshot.invoices
    .filter((invoice) => invoice.status !== "voided")
    .reduce((sum, invoice) => sum + moneyToCents(invoice.balanceDue), 0n);

  return {
    summary: {
      range,
      cashReceivedCents: toNumber(cashReceived),
      recordedRefundsCents: toNumber(recordedRefunds),
      netRecordedCashActivityCents: toNumber(cashReceived - recordedRefunds),
      invoiceCreditsCents: toNumber(invoiceCredits),
      customerCreditApplicationsCents: toNumber(customerCreditApplications),
      customerCreditRefundsCents: toNumber(customerCreditRefunds),
      daily: [...daily.values()].map((item) => ({
        ...item,
        netRecordedCashActivityCents: item.cashReceivedCents - item.recordedRefundsCents,
      })),
      methods: [...methods.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([method, values]) => ({
          method,
          cashReceivedCents: toNumber(values.cashReceivedCents),
          recordedRefundsCents: toNumber(values.recordedRefundsCents),
          netRecordedCashActivityCents: toNumber(values.cashReceivedCents - values.recordedRefundsCents),
        })),
      origins: [...origins.entries()].map(([origin, values]) => ({
        origin,
        applicationsCents: toNumber(values.applicationsCents),
        refundsCents: toNumber(values.refundsCents),
      })),
      currentPosition: {
        unappliedPaymentCents: toNumber(unappliedPayments),
        availableCustomerCreditCents: toNumber(availableCustomerCredit),
        outstandingArCents: toNumber(outstandingAr),
      },
    },
    transactions,
    discrepancies: buildDiscrepancies(snapshot),
  };
}