import { addDaysToDateOnly, businessDateStr } from "./date.ts";

export interface BillingJobRow {
  id: number;
  customerId: number;
  propertyId: number | null;
  quoteId: number | null;
  jobNumber: string;
  status: string;
  totalAmount: string;
  lineItems?: string | null;
}

export interface BillingQuoteRow {
  id: number;
  totalAmount: string;
}

export interface BillingInvoiceRow {
  id: number;
  customerId: number;
  jobId: number | null;
  propertyId: number | null;
  invoiceNumber: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface InvoiceInsertValues {
  customerId: number;
  jobId: number;
  propertyId: number | null;
  invoiceNumber: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  dueDate: string;
  notes: string | null;
  lineItems: string | null;
}

export interface GenerateInvoiceAdapter {
  /** Must serialize all invoice-generation attempts for this job. */
  acquireAdvisoryLock(jobId: number): Promise<void>;
  findJobById(jobId: number): Promise<BillingJobRow | null>;
  findInvoiceByJobId(jobId: number): Promise<BillingInvoiceRow | null>;
  findQuoteById(quoteId: number): Promise<BillingQuoteRow | null>;
  insertInvoice(values: InvoiceInsertValues): Promise<BillingInvoiceRow>;
}

export type GenerateInvoiceOutcome =
  | { kind: "notFound" }
  | { kind: "notCompleted"; status: string }
  | { kind: "existing"; invoice: BillingInvoiceRow }
  | { kind: "created"; invoice: BillingInvoiceRow; job: BillingJobRow; total: string };

export interface GenerateInvoiceOptions {
  now?: Date;
  invoiceNumber?: string;
}

function parseBillingMoneyCents(value: string): bigint {
  const raw = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("Invalid billing amount");
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function formatBillingMoneyCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/**
 * Generates the invoice represented by a completed job.
 *
 * The route owns activity logging and response serialization; this core owns
 * the domain invariants and amount calculation.
 */
export async function generateInvoiceCore(
  jobId: number,
  adapter: GenerateInvoiceAdapter,
  options: GenerateInvoiceOptions = {},
): Promise<GenerateInvoiceOutcome> {
  await adapter.acquireAdvisoryLock(jobId);

  const job = await adapter.findJobById(jobId);
  if (!job) return { kind: "notFound" };
  if (job.status !== "completed") return { kind: "notCompleted", status: job.status };

  const existing = await adapter.findInvoiceByJobId(jobId);
  if (existing) return { kind: "existing", invoice: existing };

  let totalCents = parseBillingMoneyCents(job.totalAmount);
  if (job.quoteId) {
    const quote = await adapter.findQuoteById(job.quoteId);
    if (quote) totalCents = parseBillingMoneyCents(quote.totalAmount);
  }

  const now = options.now ?? new Date();
  const dueDate = addDaysToDateOnly(businessDateStr(now), 30);
  const invoiceNumber = options.invoiceNumber ?? `INV-${now.getTime()}`;
  // Keep the legacy core's integer-looking string shape while calculating the
  // amount with exact cents internally.
  const totalString = formatBillingMoneyCents(totalCents).replace(/\.00$/, "");

  const invoice = await adapter.insertInvoice({
    customerId: job.customerId,
    jobId,
    propertyId: job.propertyId,
    invoiceNumber,
    status: "draft",
    subtotal: totalString,
    taxAmount: "0",
    totalAmount: totalString,
    amountPaid: "0",
    balanceDue: totalString,
    dueDate,
    notes: null,
    lineItems: null,
  });

  return { kind: "created", invoice, job, total: totalString };
}

export interface ManualPaymentAdapter {
  /** Must serialize all payment attempts for this invoice. */
  acquireAdvisoryLock(invoiceId: number): Promise<void>;
  findInvoiceById(invoiceId: number): Promise<BillingInvoiceRow | null>;
  markInvoicePaid(
    invoiceId: number,
    values: Pick<BillingInvoiceRow, "status" | "amountPaid" | "balanceDue" | "paidAt">,
  ): Promise<BillingInvoiceRow>;
}

export type ManualPaymentOutcome =
  | { kind: "notFound" }
  | { kind: "existing"; invoice: BillingInvoiceRow }
  | { kind: "updated"; previous: BillingInvoiceRow; invoice: BillingInvoiceRow };

/**
 * Records a full manual payment. A full payment always closes the invoice,
 * preventing the UI's status-only action from leaving a stale balance.
 */
export async function recordManualPaymentCore(
  invoiceId: number,
  adapter: ManualPaymentAdapter,
  now: Date = new Date(),
): Promise<ManualPaymentOutcome> {
  await adapter.acquireAdvisoryLock(invoiceId);

  const invoice = await adapter.findInvoiceById(invoiceId);
  if (!invoice) return { kind: "notFound" };
  if (invoice.status === "paid") return { kind: "existing", invoice };

  const updated = await adapter.markInvoicePaid(invoiceId, {
    status: "paid",
    amountPaid: invoice.totalAmount,
    balanceDue: "0",
    paidAt: now.toISOString(),
  });
  return { kind: "updated", previous: invoice, invoice: updated };
}