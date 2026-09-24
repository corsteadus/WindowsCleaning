/**
 * One estimate status, shown the same way everywhere.
 *
 * Kyle (Random Edits #4): the status belongs "in the Estimates list, at the top
 * of the individual estimate, and anywhere the estimate appears in scheduling or
 * reporting". The server derives it — from whether the estimate was sent,
 * opened, decided on, or has run past its date — and sends it as
 * `displayStatus`. `status` is the older column, kept as the fallback.
 */

export const ESTIMATE_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  accepted_scheduled: "Accepted & Scheduled",
  declined: "Declined",
  expired: "Expired",
};

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
