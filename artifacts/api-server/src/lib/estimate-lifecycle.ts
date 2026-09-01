export type EstimateLifecycleInput = {
  legacyStatus?: string | null;
  hasAppointment?: boolean;
  hasFinalizedRevision?: boolean;
  sentAt?: Date | string | null;
  firstOpenedAt?: Date | string | null;
  decision?: string | null;
  hasLinkedJob?: boolean;
};

export type EstimateDisplayStatus =
  | "scheduled" | "draft" | "sent" | "viewed"
  | "accepted" | "accepted_scheduled" | "declined";

export function isTerminalEstimateStatus(status: unknown): boolean {
  return status === "accepted" || status === "approved";
}

export function deriveEstimateStatus(input: EstimateLifecycleInput): EstimateDisplayStatus {
  if (input.decision === "accepted" || input.legacyStatus === "accepted" || input.legacyStatus === "approved") {
    return input.hasLinkedJob ? "accepted_scheduled" : "accepted";
  }
  if (input.decision === "declined" || input.legacyStatus === "declined" || input.legacyStatus === "rejected") return "declined";
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