import type { InvoiceInsertValues } from "./invoice-core.js";

function parseMoney(value: string | number): bigint {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new InvoiceCorrectionValidationError("invalid_amount", "Credit amounts must be non-negative decimals with at most two decimal places");
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function formatMoney(cents: bigint): string {
  if (cents < 0n) throw new InvoiceCorrectionValidationError("negative_amount", "Money amounts cannot be negative");
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export type CorrectionInvoiceRow = {
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
  notes: string | null;
  lineItems: string | null;
};

export type CorrectionLineRow = {
  id: number;
  invoiceId: number;
  jobId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
  lineTotal: string;
  sortOrder: number;
};

export type CorrectionCreditLineRow = {
  invoiceLineId: number | null;
  creditAmount: string;
};

export type CreditLineInput = {
  invoiceLineId?: number | null;
  amount: string | number;
  description?: string | null;
};

export type CreditNoteInsertValues = {
  invoiceId: number;
  creditNumber: string;
  reason: string;
  totalAmount: string;
  balanceReductionAmount: string;
  customerCreditAmount: string;
  createdBy: string | null;
};

export type CreditLineInsertValues = {
  creditNoteId: number;
  invoiceLineId: number | null;
  jobId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
  creditAmount: string;
  sortOrder: number;
};

export type VoidInsertValues = {
  invoiceId: number;
  reason: string;
  voidedBy: string | null;
};

export type ReissueInsertValues = {
  sourceInvoiceId: number;
  replacementInvoiceId: number;
  reason: string;
  createdBy: string | null;
};

export type CustomerCreditSourceInsertValues = {
  sourceKey: string;
  sourceType: "credit_note";
  sourceId: number;
  customerId: number;
  originalAmount: string;
};

export interface InvoiceCorrectionAdapter {
  acquireInvoiceLock(invoiceId: number): Promise<void>;
  findInvoiceById(invoiceId: number): Promise<CorrectionInvoiceRow | null>;
  hasPaymentAllocations(invoiceId: number): Promise<boolean>;
  findInvoiceLines(invoiceId: number): Promise<CorrectionLineRow[]>;
  findCreditLines(invoiceId: number): Promise<CorrectionCreditLineRow[]>;
  insertVoid(values: VoidInsertValues): Promise<{ id: number }>;
  insertCreditNote(values: CreditNoteInsertValues): Promise<{ id: number }>;
  insertCustomerCreditSource?(values: CustomerCreditSourceInsertValues): Promise<void>;
  insertCreditLine(values: CreditLineInsertValues): Promise<void>;
  updateInvoice(invoiceId: number, values: {
    status: string;
    balanceDue: string;
  }): Promise<CorrectionInvoiceRow>;
  findLinkedJobIds(invoiceId: number, legacyJobId: number | null): Promise<number[]>;
  findActiveReissue(sourceInvoiceId: number): Promise<{ id: number; replacementInvoiceId: number } | null>;
  insertReplacementInvoice(values: InvoiceInsertValues): Promise<CorrectionInvoiceRow>;
  insertReplacementJob(values: { invoiceId: number; jobId: number }): Promise<void>;
  insertReplacementLine(values: CreditLineInsertValues & { invoiceId: number }): Promise<void>;
  insertReissue(values: ReissueInsertValues): Promise<{ id: number }>;
}

export class InvoiceCorrectionValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InvoiceCorrectionValidationError";
    this.code = code;
  }
}

function requiredReason(value: unknown, label: string): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) {
    throw new InvoiceCorrectionValidationError("reason_required", `${label} reason is required`);
  }
  return reason;
}

export async function voidInvoiceCore(
  invoiceId: number,
  reasonInput: unknown,
  adapter: InvoiceCorrectionAdapter,
  voidedBy: string | null = null,
): Promise<{ invoice: CorrectionInvoiceRow }> {
  const reason = requiredReason(reasonInput, "A void");
  await adapter.acquireInvoiceLock(invoiceId);
  const invoice = await adapter.findInvoiceById(invoiceId);
  if (!invoice) throw new InvoiceCorrectionValidationError("invoice_not_found", "Invoice not found");
  if (invoice.status === "voided") return { invoice };
  if (invoice.status === "credited" || invoice.status === "partially_credited") {
    throw new InvoiceCorrectionValidationError("invalid_void_status", "A credited invoice cannot be voided");
  }
  if (invoice.status === "paid" || parseMoney(invoice.amountPaid) > 0n || await adapter.hasPaymentAllocations(invoiceId)) {
    throw new InvoiceCorrectionValidationError("invoice_has_payments", "Only an unpaid invoice with no applied payments can be voided");
  }
  await adapter.insertVoid({ invoiceId, reason, voidedBy });
  const updated = await adapter.updateInvoice(invoiceId, { status: "voided", balanceDue: "0.00" });
  return { invoice: updated };
}

export async function createCreditNoteCore(
  invoiceId: number,
  reasonInput: unknown,
  linesInput: CreditLineInput[],
  creditNumber: string,
  adapter: InvoiceCorrectionAdapter,
  createdBy: string | null = null,
): Promise<{ invoice: CorrectionInvoiceRow; creditNoteId: number; totalAmount: string }> {
  const reason = requiredReason(reasonInput, "A credit note");
  await adapter.acquireInvoiceLock(invoiceId);
  const invoice = await adapter.findInvoiceById(invoiceId);
  if (!invoice) throw new InvoiceCorrectionValidationError("invoice_not_found", "Invoice not found");
  if (invoice.status === "voided") {
    throw new InvoiceCorrectionValidationError("invalid_credit_status", "A voided invoice cannot receive a credit note");
  }
  if (invoice.status === "credited" || invoice.status === "voided") {
    throw new InvoiceCorrectionValidationError("invoice_not_creditable", "This invoice cannot receive another credit note");
  }
  if (!Array.isArray(linesInput) || linesInput.length === 0) {
    throw new InvoiceCorrectionValidationError("lines_required", "At least one credit line is required");
  }

  const sourceLines = await adapter.findInvoiceLines(invoiceId);
  const sourceById = new Map(sourceLines.map((line) => [line.id, line]));
  const priorCredits = await adapter.findCreditLines(invoiceId);
  const priorByLine = new Map<number, bigint>();
  let priorTotal = 0n;
  for (const prior of priorCredits) {
    priorTotal += parseMoney(prior.creditAmount);
    if (prior.invoiceLineId != null) {
      priorByLine.set(prior.invoiceLineId, (priorByLine.get(prior.invoiceLineId) ?? 0n) + parseMoney(prior.creditAmount));
    }
  }

  const seenLineIds = new Set<number>();
  const planned = linesInput.map((input, index) => {
    const amount = parseMoney(input.amount);
    if (amount <= 0n) {
      throw new InvoiceCorrectionValidationError("amount_must_be_positive", "Credit line amounts must be greater than zero");
    }
    const lineId = input.invoiceLineId == null ? null : Number(input.invoiceLineId);
    if (lineId != null) {
      if (!Number.isInteger(lineId) || lineId <= 0 || !sourceById.has(lineId)) {
        throw new InvoiceCorrectionValidationError("invoice_line_not_found", "Each credited invoice line must belong to the invoice");
      }
      if (seenLineIds.has(lineId)) {
        throw new InvoiceCorrectionValidationError("duplicate_invoice_line", "An invoice line may appear only once per credit note");
      }
      seenLineIds.add(lineId);
      const source = sourceById.get(lineId)!;
      const available = parseMoney(source.lineTotal) - (priorByLine.get(lineId) ?? 0n);
      if (amount > available) {
        throw new InvoiceCorrectionValidationError("line_over_credit", `Credit exceeds the remaining amount for invoice line #${lineId}`);
      }
      return {
        creditNoteId: 0,
        invoiceLineId: lineId,
        jobId: source.jobId,
        description: source.description,
        quantity: source.quantity,
        unitPrice: source.unitPrice,
        discountAmount: source.discountAmount,
        taxAmount: source.taxAmount,
        creditAmount: formatMoney(amount),
        sortOrder: index,
      };
    }
    const description = input.description?.trim() || "General credit";
    return {
      creditNoteId: 0,
      invoiceLineId: null,
      jobId: null,
      description,
      quantity: "1",
      unitPrice: formatMoney(amount),
      discountAmount: "0.00",
      taxAmount: "0.00",
      creditAmount: formatMoney(amount),
      sortOrder: index,
    };
  });

  const total = planned.reduce((sum, line) => sum + parseMoney(line.creditAmount), 0n);
  const originalAvailability = parseMoney(invoice.totalAmount) - priorTotal;
  if (total > originalAvailability) {
    throw new InvoiceCorrectionValidationError("over_credit", "Credit amount cannot exceed the invoice's remaining source availability");
  }
  const available = parseMoney(invoice.balanceDue);
  const balanceReduction = total < available ? total : available;
  const customerCredit = total - balanceReduction;
  const creditNote = await adapter.insertCreditNote({
    invoiceId,
    creditNumber,
    reason,
    totalAmount: formatMoney(total),
    balanceReductionAmount: formatMoney(balanceReduction),
    customerCreditAmount: formatMoney(customerCredit),
    createdBy,
  });
  for (const line of planned) {
    await adapter.insertCreditLine({ ...line, creditNoteId: creditNote.id });
  }
  const newBalance = available - balanceReduction;
  const updated = await adapter.updateInvoice(invoiceId, {
    status: newBalance === 0n ? "credited" : "partially_credited",
    balanceDue: formatMoney(newBalance),
  });
  if (customerCredit > 0n) {
    await adapter.insertCustomerCreditSource?.({
      sourceKey: `credit_note:${creditNote.id}`,
      sourceType: "credit_note",
      sourceId: creditNote.id,
      customerId: invoice.customerId,
      originalAmount: formatMoney(customerCredit),
    });
  }
  return { invoice: updated, creditNoteId: creditNote.id, totalAmount: formatMoney(total) };
}

export async function reissueInvoiceCore(
  invoiceId: number,
  reasonInput: unknown,
  invoiceNumber: string,
  adapter: InvoiceCorrectionAdapter,
  createdBy: string | null = null,
): Promise<{ source: CorrectionInvoiceRow; replacement: CorrectionInvoiceRow }> {
  const reason = requiredReason(reasonInput, "A reissue");
  await adapter.acquireInvoiceLock(invoiceId);
  const source = await adapter.findInvoiceById(invoiceId);
  if (!source) throw new InvoiceCorrectionValidationError("invoice_not_found", "Invoice not found");
  if (source.status !== "voided" && source.status !== "credited") {
    throw new InvoiceCorrectionValidationError("invalid_reissue_status", "Only a voided or fully credited invoice can be reissued");
  }
  if (await adapter.findActiveReissue(invoiceId)) {
    throw new InvoiceCorrectionValidationError("active_replacement_exists", "This invoice already has an active replacement");
  }

  const sourceLines = await adapter.findInvoiceLines(invoiceId);
  const lines = sourceLines.length ? sourceLines : [{
    id: 0,
    invoiceId,
    jobId: source.jobId,
    description: "Invoice line",
    quantity: "1",
    unitPrice: source.totalAmount,
    discountAmount: "0.00",
    taxAmount: "0.00",
    lineTotal: source.totalAmount,
    sortOrder: 0,
  }];
  const jobIds = await adapter.findLinkedJobIds(invoiceId, source.jobId);
  const replacement = await adapter.insertReplacementInvoice({
    customerId: source.customerId,
    jobId: jobIds.length === 1 ? jobIds[0] : null,
    propertyId: source.propertyId,
    invoiceNumber,
    status: "draft",
    subtotal: source.subtotal,
    taxAmount: source.taxAmount,
    totalAmount: source.totalAmount,
    amountPaid: "0.00",
    balanceDue: source.totalAmount,
    dueDate: source.dueDate,
    notes: source.notes,
    lineItems: source.lineItems,
  });
  for (const jobId of jobIds) await adapter.insertReplacementJob({ invoiceId: replacement.id, jobId });
  for (const [index, line] of lines.entries()) {
    await adapter.insertReplacementLine({
      invoiceId: replacement.id,
      creditNoteId: 0,
      invoiceLineId: line.id || null,
      jobId: line.jobId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      taxAmount: line.taxAmount,
      creditAmount: line.lineTotal,
      sortOrder: index,
    });
  }
  await adapter.insertReissue({
    sourceInvoiceId: source.id,
    replacementInvoiceId: replacement.id,
    reason,
    createdBy,
  });
  return { source, replacement };
}