/**
 * Sales tax — phase 6, Kyle's answer #2. The same rule as the server's
 * (api-server src/lib/sales-tax.ts), for screens that show a total before it is
 * saved and for the customer's own page: tax on the amount after discounts,
 * taxable lines only (the discounts shared by amount), rounded once to the cent.
 */
export interface TaxRate { id: number; name: string; kind: "state" | "county"; state: string; county: string | null; rate: number; isActive: boolean }
export interface TaxLine { totalPrice: number; taxable: boolean }

const toCents = (value: number) => Math.round(value * 100);

export function salesTax(lines: readonly TaxLine[], discountTotal: number, ratePercent: number | null) {
  const taxableCents = lines.filter((l) => l.taxable).reduce((sum, l) => sum + toCents(Number(l.totalPrice)), 0);
  const wholeCents = lines.reduce((sum, l) => sum + toCents(Number(l.totalPrice)), 0);
  const discountCents = toCents(discountTotal);
  // The discount's share on the taxable part, as the server shares it (largest remainder).
  const exact = wholeCents > 0 ? (discountCents * taxableCents) / wholeCents : 0;
  const untaxedExact = wholeCents > 0 ? (discountCents * (wholeCents - taxableCents)) / wholeCents : 0;
  let share = Math.floor(exact);
  const leftover = discountCents - share - Math.floor(untaxedExact);
  if (leftover > 0 && exact - Math.floor(exact) >= untaxedExact - Math.floor(untaxedExact)) share += 1;
  const baseCents = Math.max(0, taxableCents - (discountCents > 0 && wholeCents > 0 ? share : 0));
  const rate = ratePercent && ratePercent > 0 ? ratePercent : 0;
  return { taxableBase: baseCents / 100, tax: Math.round((baseCents * rate) / 100) / 100, rate };
}

/** "Jackson County" matches "jackson", "Jackson Co." and "JACKSON COUNTY". */
export const countyKey = (county: string | null | undefined) =>
  (county ?? "").toLowerCase().replace(/\bcounty\b|\bco\.?(?=\s|$)|\bparish\b/g, "").replace(/[^a-z]/g, "");

/**
 * The rates to suggest for a location (Kyle's default): its state's rate, and
 * the county rate for its county when the business has one.
 */
export function suggestedRates(rates: readonly TaxRate[], place: { state?: string | null; county?: string | null }) {
  const active = rates.filter((r) => r.isActive);
  const state = (place.state ?? "").trim().toUpperCase();
  const stateRate = active.find((r) => r.kind === "state" && r.state === state) ?? null;
  const countyRate = place.county
    ? active.find((r) => r.kind === "county" && r.state === state && countyKey(r.county) === countyKey(place.county)) ?? null
    : null;
  return { stateRate, countyRate };
}

export const rateLabel = (rate: Pick<TaxRate, "name" | "rate">) => `${rate.name} ${Number(rate.rate)}%`;
