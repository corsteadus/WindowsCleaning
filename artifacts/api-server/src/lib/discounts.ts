/**
 * Discounts — phase 5, Kyle's Video 5: "I can do dollar discounts or percentage
 * discounts, and I can name the discounts as well … add more discounts if I want
 * to stack them", and discounts that "follow the customer" (senior, military).
 *
 * The one rule, worked in whole cents so nothing drifts:
 *   - a percentage is a percentage of the subtotal (they do not compound);
 *   - a dollar discount is its amount;
 *   - in order, each is cut to what is left, so a total is never below zero.
 * The same rule runs in the browser (crm src/lib/discounts.ts) for the
 * customer's own page, where choosing services changes the subtotal.
 */
export type DiscountKind = "amount" | "percent";
export interface DiscountInput { name: string; kind: DiscountKind; value: number }
export interface AppliedDiscount extends DiscountInput { amount: number }

export const MAX_DISCOUNTS = 10;
export const MAX_DISCOUNT_NAME = 60;
const MAX_AMOUNT = 1_000_000;

export const toCents = (value: number) => Math.round(value * 100);
export const fromCents = (cents: number) => cents / 100;

/** One discount as sent, or why it cannot be one. */
export function discountOf(raw: unknown): { discount: DiscountInput } | { error: string } {
  const value = raw as { name?: unknown; kind?: unknown; value?: unknown } | null;
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  if (!name) return { error: "Give the discount a name, e.g. Senior" };
  if (name.length > MAX_DISCOUNT_NAME) return { error: `A discount name can be up to ${MAX_DISCOUNT_NAME} characters` };
  if (value?.kind !== "amount" && value?.kind !== "percent") return { error: "A discount is a dollar amount or a percentage" };
  const number = typeof value.value === "string" && value.value.trim() !== "" ? Number(value.value) : value.value;
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) return { error: `${name}: the discount must be more than 0` };
  if (value.kind === "percent" && number > 100) return { error: `${name}: a percentage can be at most 100` };
  if (value.kind === "amount" && number > MAX_AMOUNT) return { error: `${name}: that amount is too large` };
  return { discount: { name, kind: value.kind, value: Math.round(number * 100) / 100 } };
}

export function discountsOf(raw: unknown): { discounts: DiscountInput[] } | { error: string } {
  if (raw == null) return { discounts: [] };
  if (!Array.isArray(raw)) return { error: "Discounts must be a list" };
  if (raw.length > MAX_DISCOUNTS) return { error: `At most ${MAX_DISCOUNTS} discounts on one estimate` };
  const discounts: DiscountInput[] = [];
  for (const item of raw) {
    const one = discountOf(item);
    if ("error" in one) return one;
    discounts.push(one.discount);
  }
  return { discounts };
}

/** The subtotal, each discount's dollars, and the total — in dollars, exact to the cent. */
export function applyDiscounts(subtotal: number, discounts: readonly DiscountInput[]) {
  const subtotalCents = Math.max(0, toCents(subtotal));
  let left = subtotalCents;
  const applied: AppliedDiscount[] = discounts.map((discount) => {
    const wanted = discount.kind === "percent"
      ? Math.round((subtotalCents * discount.value) / 100)
      : toCents(discount.value);
    const cents = Math.min(wanted, left);
    left -= cents;
    return { ...discount, amount: fromCents(cents) };
  });
  return {
    subtotal: fromCents(subtotalCents),
    discounts: applied,
    discountTotal: fromCents(subtotalCents - left),
    total: fromCents(left),
  };
}

/**
 * Shares a discount between parts of a whole (one job per location), in
 * proportion to each part's amount, to the cent: the shares always add up to
 * the discount, the largest remainders taking the leftover cents.
 */
export function shareDiscount(discount: number, parts: readonly number[]): number[] {
  const discountCents = toCents(discount);
  const partCents = parts.map(toCents);
  const whole = partCents.reduce((sum, cents) => sum + cents, 0);
  if (discountCents <= 0 || whole <= 0) return parts.map(() => 0);
  const exact = partCents.map((cents) => (discountCents * cents) / whole);
  const shares = exact.map(Math.floor);
  let leftover = discountCents - shares.reduce((sum, cents) => sum + cents, 0);
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    shares[i] += 1;
    leftover -= 1;
  }
  return shares.map(fromCents);
}
