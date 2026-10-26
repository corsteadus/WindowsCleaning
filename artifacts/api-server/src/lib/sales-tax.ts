/**
 * Sales tax — phase 6, Kyle's answer #2 (2026-10-26): "optional, never by
 * default, on estimates and invoices." The business sets up state and county
 * rates; an estimate uses the state rate, the county rate, or both added
 * together; each service is Taxable or not.
 *
 * The rule, in whole cents (the same in crm src/lib/sales-tax.ts):
 *   - tax is on the amount after discounts (Kyle's default) — the discounts are
 *     shared between taxable and untaxed lines in proportion to their amounts;
 *   - only taxable lines are taxed;
 *   - one rounding, on the whole: round(taxable base × rate / 100);
 *   - a Tax Exempt customer is never taxed.
 */
import { shareDiscount, toCents, fromCents } from "./discounts.ts";

export const MAX_TAX_RATE = 20;

export interface TaxLine { totalPrice: number; taxable: boolean }

/** The taxable amount after its share of the discounts, and the tax on it. */
export function salesTax(lines: readonly TaxLine[], discountTotal: number, ratePercent: number | null) {
  const taxableCents = lines.filter((line) => line.taxable).reduce((sum, line) => sum + toCents(Number(line.totalPrice)), 0);
  const untaxedCents = lines.filter((line) => !line.taxable).reduce((sum, line) => sum + toCents(Number(line.totalPrice)), 0);
  const [taxableShare] = shareDiscount(discountTotal, [fromCents(taxableCents), fromCents(untaxedCents)]);
  const baseCents = Math.max(0, taxableCents - toCents(taxableShare));
  const rate = ratePercent && ratePercent > 0 ? ratePercent : 0;
  return { taxableBase: fromCents(baseCents), tax: fromCents(Math.round((baseCents * rate) / 100)), rate };
}

/** A rate as set up in Settings, or why it cannot be one. */
export function taxRateOf(raw: unknown): { rate: { name: string; kind: "state" | "county"; state: string; county: string | null; rate: number } } | { error: string } {
  const value = raw as Record<string, unknown> | null;
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 80) return { error: "Give the rate a name, e.g. Missouri state tax" };
  if (value?.kind !== "state" && value?.kind !== "county") return { error: "A rate is a state rate or a county rate" };
  const state = typeof value.state === "string" ? value.state.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(state)) return { error: "Give the two-letter state, e.g. MO" };
  const county = typeof value.county === "string" ? value.county.trim() : "";
  if (value.kind === "county" && !county) return { error: "Give the county this rate is for" };
  const rate = Number(value.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_TAX_RATE) return { error: `A rate is a percentage more than 0 and at most ${MAX_TAX_RATE}` };
  return { rate: { name, kind: value.kind, state, county: value.kind === "county" ? county : null, rate: Math.round(rate * 10000) / 10000 } };
}

/** "Jackson County" matches "jackson", "Jackson Co." and "JACKSON COUNTY". */
export const countyKey = (county: string | null | undefined) =>
  (county ?? "").toLowerCase().replace(/\bcounty\b|\bco\.?(?=\s|$)|\bparish\b/g, "").replace(/[^a-z]/g, "");

/** The estimate's rate: the chosen state and county rates added together, and how it reads. */
export function combinedRate(rates: ReadonlyArray<{ name: string; rate: number }>) {
  const rate = Math.round(rates.reduce((sum, r) => sum + Number(r.rate), 0) * 10000) / 10000;
  return { rate, label: rates.map((r) => `${r.name} ${Number(r.rate)}%`).join(" + ") };
}
