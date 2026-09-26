/**
 * The Estimate Status module on the dashboard.
 *
 * Kyle, 2026-09-24 #2: *"Add an Estimate Status area or module on the dashboard
 * so the office can quickly see the current status of estimates … status
 * groupings such as: Open, Pending, Accepted, Accepted & Scheduled, Declined,
 * and Closed. Accepted estimates that still require office action should be
 * highlighted prominently at the top. Show a clear count such as: '3 estimates
 * need to be scheduled.'"*
 *
 * The groupings are a reading of Kyle's list against the statuses the system
 * already derives, and the reading is **still to be confirmed with him**:
 *
 *   Open                — draft or booked for a survey; written, not yet with the customer
 *   Pending             — sent or viewed; it is with the customer and we are waiting
 *   Accepted            — accepted and no job yet: this is the office's queue
 *   Accepted & Scheduled— accepted and turned into a job
 *   Declined            — the customer said no
 *   Closed              — expired without a decision
 */
import type { EstimateDisplayStatus } from "./estimate-lifecycle.ts";

export const ESTIMATE_GROUPS = [
  "open", "pending", "accepted", "accepted_scheduled", "declined", "closed",
] as const;
export type EstimateGroup = typeof ESTIMATE_GROUPS[number];

export const ESTIMATE_GROUP_LABELS: Record<EstimateGroup, string> = {
  open: "Open",
  pending: "Pending",
  accepted: "Accepted",
  accepted_scheduled: "Accepted & Scheduled",
  declined: "Declined",
  closed: "Closed",
};

const OF_STATUS: Record<EstimateDisplayStatus, EstimateGroup> = {
  draft: "open",
  scheduled: "open",
  sent: "pending",
  viewed: "pending",
  accepted: "accepted",
  accepted_scheduled: "accepted_scheduled",
  declined: "declined",
  expired: "closed",
};

export function groupOfStatus(status: string | null | undefined): EstimateGroup {
  return OF_STATUS[status as EstimateDisplayStatus] ?? "open";
}

export interface EstimateSummaryRow { id: number; status: string | null | undefined }

export interface EstimateSummary {
  groups: Array<{ group: EstimateGroup; label: string; count: number }>;
  total: number;
  /** The office's queue: accepted, with nobody having scheduled it yet. */
  needsScheduling: number;
  /** Ready to print: "3 estimates need to be scheduled." */
  needsSchedulingLabel: string | null;
}

export function summariseEstimates(rows: readonly EstimateSummaryRow[]): EstimateSummary {
  const counts = new Map<EstimateGroup, number>(ESTIMATE_GROUPS.map((group) => [group, 0]));
  for (const row of rows) {
    const group = groupOfStatus(row.status);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const needsScheduling = counts.get("accepted") ?? 0;
  return {
    groups: ESTIMATE_GROUPS.map((group) => ({
      group, label: ESTIMATE_GROUP_LABELS[group], count: counts.get(group) ?? 0,
    })),
    total: rows.length,
    needsScheduling,
    needsSchedulingLabel: needsScheduling
      ? `${needsScheduling} estimate${needsScheduling === 1 ? "" : "s"} need${needsScheduling === 1 ? "s" : ""} to be scheduled`
      : null,
  };
}
