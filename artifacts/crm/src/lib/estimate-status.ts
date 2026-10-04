/**
 * One estimate status, shown the same way everywhere.
 *
 * Kyle (Random Edits #4): the status belongs "in the Estimates list, at the top
 * of the individual estimate, and anywhere the estimate appears in scheduling or
 * reporting". The server derives it — from whether the estimate was sent,
 * opened, decided on, or has run past its date — and sends it as
 * `displayStatus`. `status` is the older column, kept as the fallback.
 */

/**
 * Kyle (Testing Edits, 2026-10-01, #10) named the six an estimate may read as,
 * and asked for the two kinds of Pending to stay apart "so the office can
 * immediately tell whether the customer has opened the quote".
 *
 * The derivation behind these is unchanged — what moved is the wording. Two
 * derived values share a label on purpose: an estimate that has been turned into
 * a job is still Accepted to the reader, and the dashboard's own queue is what
 * says which accepted ones still need scheduling.
 */
export const ESTIMATE_STATUS_LABELS: Record<string, string> = {
  draft: "Open",
  scheduled: "Open",
  sent: "Pending – Sent Only",
  viewed: "Pending – Sent and Viewed",
  accepted: "Accepted",
  accepted_scheduled: "Accepted",
  declined: "Declined",
  expired: "Closed",
};

/** The six, in Kyle's order, for anywhere that lists them. */
export const ESTIMATE_STATUS_ORDER = [
  "draft", "sent", "viewed", "accepted", "declined", "expired",
] as const;

/** What an authorised employee may correct a status to; never Accepted. */
export const CORRECTABLE_ESTIMATE_STATUSES = ["draft", "sent", "viewed", "declined", "expired"] as const;

export function estimateStatusOf(
  quote: { displayStatus?: string | null; status?: string | null } | null | undefined,
): string {
  return quote?.displayStatus ?? quote?.status ?? "draft";
}

export function estimateStatusLabel(status: string): string {
  return ESTIMATE_STATUS_LABELS[status] ?? status;
}
