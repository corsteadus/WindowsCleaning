/**
 * Drag rules for the calendar.
 *
 * Two rules the spec is explicit about, kept here rather than inside the
 * component so they can be proven without a browser:
 *
 *   Month view moves the day and keeps the time. Dropping a 9am job on the
 *   14th makes it a 9am job on the 15th — the drop position carries no hour,
 *   so inventing one would silently reschedule the crew's morning.
 *
 *   Finished and billed work does not move at all. The server refuses it; the
 *   grid should not offer the gesture in the first place.
 */

export type DragBlockReason = "completed" | "invoiced" | "canceled";

export type DraggableOccurrence = {
  id: number;
  status: string;
  scheduledDate: string;
  invoiceStatus?: string | null;
};

/**
 * An invoice that has been voided no longer cites a service date, so the job
 * underneath it is schedulable again. Every other invoice state pins it.
 */
function isBillingPinned(invoiceStatus: string | null | undefined): boolean {
  if (!invoiceStatus) return false;
  return invoiceStatus.trim().toLowerCase() !== "voided";
}

/** Why this job cannot be dragged, or null when it can. */
export function dragBlockReason(
  occurrence: DraggableOccurrence,
): DragBlockReason | null {
  const status = occurrence.status.trim().toLowerCase();
  if (status === "completed") return "completed";
  if (status === "canceled") return "canceled";
  if (isBillingPinned(occurrence.invoiceStatus)) return "invoiced";
  return null;
}

export function canDrag(occurrence: DraggableOccurrence): boolean {
  return dragBlockReason(occurrence) === null;
}

export function dragBlockMessage(reason: DragBlockReason): string {
  switch (reason) {
    case "completed":
      return "Completed jobs cannot be moved. Reopen the job first.";
    case "invoiced":
      return "Invoiced jobs cannot be moved. Void or credit the invoice first.";
    case "canceled":
      return "Canceled jobs cannot be moved.";
  }
}

export type MonthDrop =
  | { kind: "blocked"; reason: DragBlockReason }
  | { kind: "unchanged" }
  | { kind: "move"; jobId: number; from: string; to: string };

/**
 * Resolves a drop in month view.
 *
 * Returns only the date, never a time: the caller patches `scheduledDate`
 * alone, so whatever start and end the job already had survive the move.
 */
export function resolveMonthDrop(
  occurrence: DraggableOccurrence,
  targetDate: string,
): MonthDrop {
  const reason = dragBlockReason(occurrence);
  if (reason) return { kind: "blocked", reason };
  if (targetDate === occurrence.scheduledDate) return { kind: "unchanged" };
  return {
    kind: "move",
    jobId: occurrence.id,
    from: occurrence.scheduledDate,
    to: targetDate,
  };
}

/** How long an undo stays on offer, per the spec's 10–20 second window. */
export const UNDO_WINDOW_MS = 15_000;
