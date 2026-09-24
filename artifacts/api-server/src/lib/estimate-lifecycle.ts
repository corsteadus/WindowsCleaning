export type EstimateLifecycleInput = {
  legacyStatus?: string | null;
  hasAppointment?: boolean;
  hasFinalizedRevision?: boolean;
  sentAt?: Date | string | null;
  firstOpenedAt?: Date | string | null;
  decision?: string | null;
  hasLinkedJob?: boolean;
  /** When the customer's link stops working. Past it, an undecided estimate has expired. */
  expiresAt?: Date | string | null;
  /** Defaults to now; a parameter so the rule can be tested without waiting. */
  now?: Date;
};

export type EstimateDisplayStatus =
  | "scheduled" | "draft" | "sent" | "viewed"
  | "accepted" | "accepted_scheduled" | "declined" | "expired";

/**
 * The statuses Kyle asked for (Random Edits #4): "V1 statuses: Draft, Sent,
 * Viewed, Accepted, Declined, Expired." `scheduled` and `accepted_scheduled`
 * are finer shades the system already drew and keeps.
 */
export const ESTIMATE_STATUSES: readonly EstimateDisplayStatus[] = [
  "draft", "scheduled", "sent", "viewed", "accepted", "accepted_scheduled", "declined", "expired",
];

/**
 * What an authorised employee may set by hand. Acceptance is deliberately not
 * here: it can only come from the customer's own decision, so that an accepted
 * estimate always has a real acceptance behind it.
 */
export const MANUALLY_CORRECTABLE_STATUSES: readonly EstimateDisplayStatus[] = [
  "draft", "sent", "viewed", "declined", "expired",
];

export function isManuallyCorrectableStatus(value: unknown): value is EstimateDisplayStatus {
  return typeof value === "string"
    && (MANUALLY_CORRECTABLE_STATUSES as readonly string[]).includes(value);
}

function hasPassed(when: Date | string | null | undefined, now: Date): boolean {
  if (!when) return false;
  const at = when instanceof Date ? when : new Date(when);
  return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}

export function isTerminalEstimateStatus(status: unknown): boolean {
  return status === "accepted" || status === "approved";
}

export function deriveEstimateStatus(input: EstimateLifecycleInput): EstimateDisplayStatus {
  const now = input.now ?? new Date();
  // The customer's own decision outranks everything, including a correction
  // typed by an employee: an acceptance must always be the customer's.
  if (input.decision === "accepted" || input.legacyStatus === "accepted" || input.legacyStatus === "approved") {
    return input.hasLinkedJob ? "accepted_scheduled" : "accepted";
  }
  if (input.decision === "declined" || input.legacyStatus === "declined" || input.legacyStatus === "rejected") return "declined";
  // A correction an employee made by hand, which the automatic rules below
  // would otherwise talk over.
  if (input.legacyStatus === "expired") return "expired";
  if (input.legacyStatus === "viewed") return "viewed";
  // Undecided and past its date.
  if (hasPassed(input.expiresAt, now)) return "expired";
  if (input.firstOpenedAt) return "viewed";
  if (input.sentAt || input.legacyStatus === "sent") return "sent";
  if (input.hasAppointment && !input.hasFinalizedRevision) return "scheduled";
  return "draft";
}

export function isOpenEstimateStatus(status: EstimateDisplayStatus): boolean {
  return ["scheduled", "draft", "sent", "viewed"].includes(status);
}

export function assertDecisionTransition(
  current: string | null | undefined,
  requested: "accepted" | "declined",
): "apply" | "idempotent" {
  if (!current) return "apply";
  if (current === requested) return "idempotent";
  throw Object.assign(new Error(`Estimate was already ${current}`), { status: 409 });
}

export function assertStaffWritableQuoteStatus(status: unknown): void {
  if (isTerminalEstimateStatus(status)) {
    throw Object.assign(new Error("Acceptance is only allowed through the secure customer decision flow"), { status: 400 });
  }
}

export function assertActiveEstimateRevision(linkRevisionId: number, latestRevisionId: number): void {
  if (linkRevisionId !== latestRevisionId) {
    throw Object.assign(new Error("This estimate link was superseded by a newer revision"), { status: 409, statusCode: 409 });
  }
}