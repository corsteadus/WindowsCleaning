export const MANUAL_PAYMENT_METHODS = [
  "cash",
  "check",
  "ach",
  "bank_transfer",
  "other",
] as const;

export function parsePaymentCents(value: unknown): bigint | null {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function isValidPaymentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isValidManualPaymentMethod(value: string): boolean {
  return MANUAL_PAYMENT_METHODS.includes(value as (typeof MANUAL_PAYMENT_METHODS)[number]);
}

export function validateInvoicePayment(input: {
  customerId: number;
  invoiceId: number;
  amount: unknown;
  outstanding: unknown;
  paymentDate: string;
  method: string;
}): string | null {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) return "Choose a valid customer";
  if (!Number.isInteger(input.invoiceId) || input.invoiceId <= 0) return "Choose a valid invoice";
  const amount = parsePaymentCents(input.amount);
  const outstanding = parsePaymentCents(input.outstanding);
  if (amount === null || amount <= 0n) return "Payment amount must be greater than zero";
  if (outstanding === null || amount > outstanding) return "Payment amount cannot exceed the outstanding balance";
  if (!isValidPaymentDate(input.paymentDate)) return "Choose a valid payment date";
  if (!isValidManualPaymentMethod(input.method)) return "Choose a valid payment method";
  return null;
}