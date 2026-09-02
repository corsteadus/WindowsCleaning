/**
 * Who may still be moved on the calendar.
 *
 * Finished work is a record of what happened, not a plan of what will happen.
 * Once a job is completed, or once it has been billed, its date and time are
 * evidence: an invoice cites work performed on a day, and a crew's history
 * cites the day they performed it. Silently dragging that date to a new day
 * rewrites both.
 *
 * So the schedule fields lock. Everything else about the job — notes, crew
 * corrections, status — stays editable through its own path, and a completed
 * job that genuinely needs a new date is reopened first, which is an explicit,
 * audited status change rather than an accidental drag.
 */

export type ScheduleLockReason = "completed" | "invoiced";

/** The schedule fields a reschedule touches. */
export type ScheduleFieldChanges = {
  scheduledDate: boolean;
  scheduledStartTime: boolean;
  scheduledEndTime: boolean;
};

export type ScheduleChangeLockInput = {
  /** Status stored on the locked row. */
  currentStatus: string | null | undefined;
  /** Status supplied by the same request, when it supplies one. */
  requestedStatus?: unknown;
  /** Whether any invoice cites this job. */
  hasInvoice: boolean;
  changes: ScheduleFieldChanges;
};

function normalizeStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** True when the request actually moves the job, rather than resending it. */
export function touchesSchedule(changes: ScheduleFieldChanges): boolean {
  return changes.scheduledDate || changes.scheduledStartTime || changes.scheduledEndTime;
}

/**
 * Returns why a reschedule is refused, or null when it may proceed.
 *
 * A request that carries a status is judged on the status it is asking for,
 * not the one on the row. That is what lets "reopen and move" work in one
 * call: the job is no longer completed by the time the new date applies.
 * Billing is not escapable that way — an invoiced job stays locked whatever
 * its status becomes, because the invoice already told the customer which day
 * the work happened.
 */
export function scheduleChangeLock(input: ScheduleChangeLockInput): ScheduleLockReason | null {
  if (!touchesSchedule(input.changes)) return null;

  const effectiveStatus = input.requestedStatus === undefined
    ? normalizeStatus(input.currentStatus)
    : normalizeStatus(input.requestedStatus);

  if (effectiveStatus === "completed") return "completed";
  if (input.hasInvoice) return "invoiced";
  return null;
}

export function scheduleLockMessage(reason: ScheduleLockReason): string {
  return reason === "completed"
    ? "A completed job cannot be rescheduled. Reopen the job first if the date is wrong."
    : "An invoiced job cannot be rescheduled. Void or credit the invoice first if the date is wrong.";
}
