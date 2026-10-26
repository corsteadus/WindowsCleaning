/**
 * The profile's estimates — Kyle, Videos 4 and 5. What each one says at a
 * glance, and what stands between it and a scheduled job. The server builds
 * `summary` (api-server lib/profile-estimates.ts).
 */
import { estimateStatusOf } from "./estimate-status.ts";

export interface EstimateSummary {
  locations: Array<{ id: number; label: string }>;
  estimator: string | null;
  appointmentAt: string | null;
  lineCount: number;
  pendingCount: number;
  revisionNumber: number | null;
  jobCount: number;
}

export interface ProfileEstimate {
  id: number;
  quoteNumber: string;
  status: string;
  displayStatus?: string | null;
  totalAmount: string;
  createdAt: string;
  validUntil?: string | null;
  summary?: EstimateSummary | null;
}

const money = (value: number) => `$${value.toFixed(2)}`;

/**
 * The price as the list shows it. Kyle (2026-10-24): blank is "to be quoted",
 * $0 is a price — so an estimate with nothing priced yet must not read $0.00.
 */
export function estimatePriceLabel(quote: ProfileEstimate): string {
  const total = Number(quote.totalAmount) || 0;
  const lines = quote.summary?.lineCount ?? 0;
  const pending = quote.summary?.pendingCount ?? 0;
  if (lines === 0) return quote.summary ? "No services" : money(total);
  if (pending === lines) return "To be quoted";
  if (pending > 0) return `${money(total)} · ${pending} to be quoted`;
  return money(total);
}

/** Why this estimate cannot be scheduled yet, or null. The server checks the same. */
export function convertBlocker(quote: ProfileEstimate): string | null {
  const status = estimateStatusOf(quote);
  if ((quote.summary?.jobCount ?? 0) > 0) return "This estimate has already been scheduled.";
  if (status === "declined") return "The customer declined this estimate.";
  if ((quote.summary?.lineCount ?? 0) === 0) return "Add a service to this estimate first.";
  const pending = quote.summary?.pendingCount ?? 0;
  if (pending > 0) {
    return `${pending} ${pending === 1 ? "service is" : "services are"} still to be quoted — price ${pending === 1 ? "it" : "them"} before scheduling.`;
  }
  return null;
}

/** One line per estimate on the call screen (phase 4): the caller talks about it. */
export function estimateCallLine(quote: ProfileEstimate): string {
  const locations = (quote.summary?.locations ?? []).map((location) => location.label).join(", ");
  return [`Estimate ${quote.quoteNumber}`, estimatePriceLabel(quote), locations].filter(Boolean).join(" · ");
}
