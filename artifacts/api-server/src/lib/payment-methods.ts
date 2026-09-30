/**
 * How a payment was taken.
 *
 * Kyle, 2026-09-24 #3: *"Treat Gift Certificate as a normal invoice payment
 * method, not as a separate customer-credit system … Payment method options
 * should include at least: Cash, Credit Card, Check, and Gift Certificate."*
 *
 * So a gift certificate records the amount it paid and nothing more: there is no
 * stored balance, and anything it was worth beyond the invoice is not tracked.
 * Credit Card records that a card was used; Corstead does not take the payment
 * and holds no card details, in keeping with Kyle's #6.
 *
 * The four Kyle named come first, in his order. The rest were already in use and
 * stay, so no existing payment becomes unreadable.
 *
 * The CRM keeps its own copy of this list, because the two packages share no
 * runtime code; `payment-methods-agree.test.ts` in the CRM fails if they drift.
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
