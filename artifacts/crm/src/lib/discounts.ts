/**
 * Discounts — phase 5, Kyle's Video 5. The same rule as the server's
 * (api-server src/lib/discounts.ts), for screens that show a total before it is
 * saved and for the customer's own page, where choosing services changes it:
 * a percentage is of the subtotal (no compounding), a dollar discount is its
 * amount, and each is cut to what is left so a total is never below zero.
 */
export type DiscountKind = "amount" | "percent";
export interface Discount { name: string; kind: DiscountKind; value: number }
export interface AppliedDiscount extends Discount { amount: number }
/** A row being typed: the value as typed. */
export interface DiscountDraft { key: string; name: string; kind: DiscountKind; value: string }

const toCents = (value: number) => Math.round(value * 100);

export function applyDiscounts(subtotal: number, discounts: readonly Discount[]) {
  const subtotalCents = Math.max(0, toCents(subtotal));
  let left = subtotalCents;
  const applied: AppliedDiscount[] = discounts.map((discount) => {
    const wanted = discount.kind === "percent" ? Math.round((subtotalCents * discount.value) / 100) : toCents(discount.value);
    const cents = Math.min(wanted, left);
    left -= cents;
    return { ...discount, amount: cents / 100 };
  });
  return { subtotal: subtotalCents / 100, discounts: applied, discountTotal: (subtotalCents - left) / 100, total: left / 100 };
}

/** "Senior (10%)" or "Spring coupon ($25.00)". */
export function discountLabel(discount: Discount): string {
  const value = discount.kind === "percent" ? `${Number(discount.value)}%` : `$${Number(discount.value).toFixed(2)}`;
  return `${discount.name} (${value})`;
}

/** The drafts that are complete discounts, or the first reason one is not. */
export function draftsToDiscounts(drafts: readonly DiscountDraft[]): { discounts: Discount[] } | { error: string } {
  const discounts: Discount[] = [];
  for (const draft of drafts) {
    const name = draft.name.trim();
    const value = Number(draft.value);
    if (!name && !draft.value.trim()) continue; // an untouched new row
    if (!name) return { error: "Give each discount a name, e.g. Senior" };
    if (!draft.value.trim() || !Number.isFinite(value) || value <= 0) return { error: `${name}: enter an amount more than 0` };
    if (draft.kind === "percent" && value > 100) return { error: `${name}: a percentage can be at most 100` };
    discounts.push({ name, kind: draft.kind, value: Math.round(value * 100) / 100 });
  }
  return { discounts };
}

export const draftOf = (discount: Discount): DiscountDraft => ({
  key: crypto.randomUUID(), name: discount.name, kind: discount.kind, value: String(discount.value),
});
