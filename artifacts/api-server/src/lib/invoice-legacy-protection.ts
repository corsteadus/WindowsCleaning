const CORRECTED_STATUSES = new Set(["voided", "partially_credited", "credited"]);
const FINANCIAL_FIELDS = ["subtotal", "taxAmount", "totalAmount", "amountPaid", "lineItems"];

export function correctedInvoicePatchError(
  status: string,
  body: Record<string, unknown>,
): { error: string; code: "invoice_immutable" } | null {
  if (body.status !== undefined && CORRECTED_STATUSES.has(String(body.status))) {
    return { error: "Corrected invoices must use the correction workflow", code: "invoice_immutable" };
  }
  if (!CORRECTED_STATUSES.has(status)) return null;
  if (
    (body.status !== undefined && body.status !== status) ||
    FINANCIAL_FIELDS.some((field) => body[field] !== undefined)
  ) {
    return { error: "Corrected invoices are immutable; use a correction workflow", code: "invoice_immutable" };
  }
  return null;
}

export function correctedInvoiceDeleteError(status: string): { error: string; code: "invoice_immutable" } | null {
  return CORRECTED_STATUSES.has(status)
    ? { error: "Corrected invoices cannot be deleted", code: "invoice_immutable" }
    : null;
}