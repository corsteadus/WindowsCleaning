/**
 * Moving a whole day's work to another day.
 *
 * Spec V1 #11, and the third of the five prototype tests (§18). Rain moves a
 * day; the office should not reschedule twenty-five jobs one at a time.
 *
 * Three things make this safe rather than merely quick:
 *
 * 1. **It refuses nothing silently.** Completed and invoiced work keeps its
 *    date — the same rule as a single drag, from `schedule-change-lock.ts` —
 *    and so does work the destination will not take, because a day the office
 *    blocked off is not somewhere twenty-five jobs may be dropped in one
 *    click. Every job left behind is named with the reason.
 * 2. **It can be asked what it would do.** The same planner answers a preview
 *    and the move itself, so the screen cannot show one thing and do another.
 * 3. **It tells nobody.** Phase 11's rule is that nothing reaches a customer
 *    without somebody answering a prompt, and a prompt asked twenty-five times
 *    is not an answer. The plan reports how many customers have work on the
 *    day so the office can decide in one go — §8.6 asks for a batch review
 *    screen, which is still an open question with the client.
 */
import { scheduleChangeLock, scheduleLockMessage, type ScheduleLockReason } from "./schedule-change-lock.ts";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface MovableJob {
  id: number;
  customerId: number | null;
  /** For the message that names what was left behind. */
  label: string;
  status: string | null;
  hasInvoice: boolean;
  /**
   * Why the day it is moving **to** refuses this job, or null. Filled in by the
   * caller, which is the only side that can read the blocks; a hard block on
   * the target date leaves the job where it is rather than quietly overriding
   * the block the office set.
   */
  blockedBy?: string | null;
}

/** A job's own state refuses the move, or the day it would land on does. */
export type SkipReason = ScheduleLockReason | "blocked";

export interface SkippedJob {
  id: number;
  label: string;
  reason: SkipReason;
  message: string;
}

export interface DayMovePlan {
  from: string;
  to: string;
  /** Ids that will move, in the order given. */
  moving: number[];
  skipped: SkippedJob[];
  /** Distinct customers with work on that day, moving or not. */
  customersAffected: number;
}

export type DayMoveResult =
  | { ok: false; status: number; error: string }
  | { ok: true; plan: DayMovePlan };

export function planDayMove(input: {
  from: unknown;
  to: unknown;
  jobs: ReadonlyArray<MovableJob>;
}): DayMoveResult {
  const from = typeof input.from === "string" ? input.from.trim() : "";
  const to = typeof input.to === "string" ? input.to.trim() : "";

  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
    return { ok: false, status: 400, error: "from and to must both be YYYY-MM-DD dates" };
  }
  if (from === to) {
    return { ok: false, status: 400, error: "The day is already on that date" };
  }
  if (input.jobs.length === 0) {
    return { ok: false, status: 400, error: "There is no work on that day to move" };
  }

  const moving: number[] = [];
  const skipped: SkippedJob[] = [];
  for (const job of input.jobs) {
    // Exactly the rule a single drag obeys, so a day move cannot do what a drag
    // would have refused.
    const reason = scheduleChangeLock({
      currentStatus: job.status,
      hasInvoice: job.hasInvoice,
      changes: { scheduledDate: true, scheduledStartTime: false, scheduledEndTime: false },
    });
    if (reason) {
      skipped.push({ id: job.id, label: job.label, reason, message: scheduleLockMessage(reason) });
      continue;
    }
    // The job would move; the destination is what refuses it.
    if (job.blockedBy) {
      skipped.push({ id: job.id, label: job.label, reason: "blocked", message: job.blockedBy });
      continue;
    }
    moving.push(job.id);
  }

  const customers = new Set<number>();
  for (const job of input.jobs) if (job.customerId !== null) customers.add(job.customerId);

  return { ok: true, plan: { from, to, moving, skipped, customersAffected: customers.size } };
}

/**
 * What the office is told afterwards, in one sentence.
 *
 * It names the reason in the plural only when it is the single reason: saying
 * "completed or invoiced" about a job the target day refused would send someone
 * looking at the wrong job.
 */
export function describeDayMove(plan: DayMovePlan): string {
  const blocked = plan.skipped.filter((job) => job.reason === "blocked").length;
  const locked = plan.skipped.length - blocked;
  const why = blocked === 0
    ? "completed or invoiced"
    : locked === 0
      ? `blocked on ${plan.to}`
      : `completed, invoiced, or blocked on ${plan.to}`;
  if (plan.moving.length === 0) {
    return `Nothing moved from ${plan.from}: all ${plan.skipped.length} jobs are ${why}`;
  }
  const moved = `${plan.moving.length} ${plan.moving.length === 1 ? "job" : "jobs"} moved to ${plan.to}`;
  const left = plan.skipped.length ? `, ${plan.skipped.length} left on ${plan.from} (${why})` : "";
  return moved + left;
}
