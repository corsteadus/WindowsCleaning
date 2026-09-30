/**
 * How a payment was taken — the CRM's copy of the list the API keeps in
 * `api-server/src/lib/payment-methods.ts`. The two packages share no runtime
 * code, so `payment-methods-agree.test.ts` fails if they drift apart.
 *
 * Kyle, 2026-09-24 #3: Gift Certificate is an ordinary payment method, not a
 * customer balance. Credit Card records that a card was used; Corstead does not
 * take the payment and asks for no card details.
 */

export interface PaymentMethodOption {
  value: string;
  label: string;
  /** What the free-text reference beside it is for, if anything. */
  referenceHint?: string;
}

export const PAYMENT_METHOD_OPTIONS: readonly PaymentMethodOption[] = [
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Credit Card", referenceHint: "Authorisation or receipt number" },
  { value: "check", label: "Check", referenceHint: "Check number" },
  { value: "gift_certificate", label: "Gift Certificate", referenceHint: "Certificate number" },
  { value: "ach", label: "ACH" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

export const PAYMENT_METHOD_VALUES: readonly string[] = PAYMENT_METHOD_OPTIONS.map((option) => option.value);

export function paymentMethodLabel(value: string | null | undefined): string {
  const found = PAYMENT_METHOD_OPTIONS.find((option) => option.value === value);
  if (found) return found.label;
  // "manual" is written by the one-click Mark Paid action and never offered.
  if (value === "manual") return "Marked paid";
  return (value ?? "").trim() || "Unknown";
}

export function paymentReferenceHint(value: string | null | undefined): string {
  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === value)?.referenceHint ?? "Reference";
}
