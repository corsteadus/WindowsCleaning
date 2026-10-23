/**
 * "To be quoted" — profile redesign piece B2, decided 2026-10-23.
 *
 * Kyle books about 99% of estimates with no price: the estimator prices them
 * on site. A blank price is stored as 0 (the column is NOT NULL), so a $0
 * line means **not priced yet**, and an estimate with one is never sent: the
 * customer must not receive "$0.00". A deliberately free line is therefore
 * not sendable either; that is to be confirmed with Kyle.
 */

export interface PricedLine {
  description?: string | null;
  unitPrice: number | string | null | undefined;
}

/** The lines still waiting for a price, by name, in order. */
export function unpricedLines(lines: readonly PricedLine[]): string[] {
  return lines
    .map((line, index) => ({ line, name: line.description?.trim() || `Line ${index + 1}` }))
    .filter(({ line }) => !(Number(line.unitPrice) > 0))
    .map(({ name }) => name);
}

/** The refusal shown to the office, or null when the estimate can go. */
export function unpricedRefusal(lines: readonly PricedLine[]): string | null {
  const missing = unpricedLines(lines);
  if (!lines.length) return "Add a service and its price before sending";
  if (!missing.length) return null;
  return `Add a price before sending: ${missing.join(", ")}`;
}
