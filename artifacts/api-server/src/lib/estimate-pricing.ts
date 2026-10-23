/**
 * "To be quoted" — Kyle, 2026-10-24:
 *
 *   "Blank price: the service has not been priced yet, so the estimate cannot
 *    be sent. $0.00: this is a valid price. The service can be included in the
 *    estimate and sent to the customer."
 *
 * unit_price is NOT NULL and holds 0 for both, so a line carries
 * `price_pending`. Every writer of quote lines reads the sender's price
 * through `priceOf`: null, "" or a missing price is pending; a number — 0
 * included — is a price. Every reader gives a pending line back as
 * `unitPrice: null`, so a round trip keeps it pending.
 */

export interface LinePrice {
  unitPrice: number;
  pricePending: boolean;
}

/** The sender's price, or an error for one that is not a price at all. */
export function priceOf(value: unknown): LinePrice | { error: string } {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return { unitPrice: 0, pricePending: true };
  }
  const unitPrice = Number(value);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "A price must be 0 or more" };
  return { unitPrice, pricePending: false };
}

/** The price as a reader sees it: null while still to be quoted. */
export function shownPrice(line: { unitPrice: unknown; pricePending?: boolean | null }): number | null {
  return line.pricePending ? null : Number(line.unitPrice);
}

export interface PricedLine {
  description?: string | null;
  unitPrice: number | string | null | undefined;
  pricePending?: boolean | null;
}

const isPending = (line: PricedLine) =>
  line.pricePending === true || line.unitPrice === null || line.unitPrice === undefined
  || (typeof line.unitPrice === "string" && line.unitPrice.trim() === "");

/** The lines still waiting for a price, by name, in order. $0 is a price. */
export function unpricedLines(lines: readonly PricedLine[]): string[] {
  return lines
    .map((line, index) => ({ line, name: line.description?.trim() || `Line ${index + 1}` }))
    .filter(({ line }) => isPending(line))
    .map(({ name }) => name);
}

/** The refusal shown to the office, or null when the estimate can go. */
export function unpricedRefusal(lines: readonly PricedLine[]): string | null {
  const missing = unpricedLines(lines);
  if (!lines.length) return "Add a service and its price before sending";
  if (!missing.length) return null;
  return `Add a price before sending: ${missing.join(", ")}`;
}
