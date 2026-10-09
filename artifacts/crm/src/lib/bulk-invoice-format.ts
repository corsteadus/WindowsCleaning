/**
 * The three things the review screen works out for itself.
 *
 * Kept apart from the request so they can be tested without a browser or a
 * server — the rules that decide what is billed are the server's, and these
 * only decide how it reads.
 */

/** Integer cents as money, for a screen that is about to create it. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}$${(absolute / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The first and last day of a month, as the range to offer.
 *
 * `monthIndex` is 0–11, the way `Date` and the calendar grid count months.
 * A 1-based month here would mean every call site remembering a +1, and the
 * one that forgot it offered September while October was on screen.
 */
export function monthRange(year: number, monthIndex: number): { from: string; to: string } {
  const pad = (value: number) => String(value).padStart(2, "0");
  const last = new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
  const month = pad(monthIndex + 1);
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${pad(last)}` };
}

/** Why a job is not being billed, in the office's words. */
export function skipHeading(reason: string): string {
  switch (reason) {
    case "invoiced": return "Already invoiced";
    case "not_completed": return "Not marked complete";
    case "cancelled": return "Cancelled";
    case "no_amount": return "No amount";
    default: return "Skipped";
  }
}
