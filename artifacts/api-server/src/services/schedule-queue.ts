import { sql } from "drizzle-orm";
import { db, activityLogsTable } from "@workspace/db";
import {
  decideHold,
  decideQueueStatusChange,
  decideRelease,
  decideSchedule,
  initialQueueStatus,
  parseQueuePage,
  tabState,
  toQueuePage,
  type EntrySnapshot,
  type QueuePage,
  type QueueStatus,
  type QueueTab,
  type ScheduleFromQueueInput,
} from "../lib/schedule-queue-core.ts";
import {
  countByQueueStatus,
  findEntryFacts,
  listQueuePage,
  type EntryFacts,
} from "../repositories/schedule-entry.ts";
import { queueVisibility } from "../lib/schedule-queue-scope.ts";

/**
 * What the scheduling queue does, as opposed to how it is stored or spoken.
 *
 * The route above parses and responds; the repository below runs SQL; the core
 * module decides. This layer holds the part that is neither — ordering the
 * steps of a transition, keeping `jobs` in step with `schedule_entries`, and
 * leaving an audit trail.
 */

export type Actor = { id?: string; email?: string | null; role?: string | null };

function performedBy(actor: Actor): string {
  return actor.email || actor.id || "system";
}

function snapshot(facts: EntryFacts): EntrySnapshot {
  return {
    state: facts.state as EntrySnapshot["state"],
    hasInvoice: facts.hasInvoice,
    jobStatus: facts.jobStatus,
  };
}

export type QueueRefusal = { status: number; error: string; code: string };

const NOT_FOUND: QueueRefusal = {
  status: 404,
  error: "That scheduling entry no longer exists.",
  code: "entry_not_found",
};

/**
 * A malformed request is a 400; a well-formed request against the wrong state
 * is a 409. The distinction matters to the UI: one means "fix your input", the
 * other means "someone else moved this, reload".
 */
const INPUT_REFUSALS = new Set([
  "bad_date",
  "bad_time",
  "reversed_time",
  "bad_status",
  "hold_needs_reason",
]);

function refusal(reason: string, message: string): QueueRefusal {
  return { status: INPUT_REFUSALS.has(reason) ? 400 : 409, error: message, code: reason };
}

/* -- Reading ------------------------------------------------------------ */

export type QueueReadResult =
  | { ok: true; tab: QueueTab; page: QueuePage; counts: Record<string, number> }
  | { ok: false; refusal: QueueRefusal };

/**
 * One tab of the queue.
 *
 * The counts come from their own aggregate rather than from the page, because
 * a page is at most 100 rows while the chips describe the whole tab. That is
 * one extra grouped query per read — cheap, and it runs off the same index the
 * page walks.
 */
export async function readQueue(
  query: Record<string, unknown>,
  viewer: { isAssignmentScoped: boolean; userId: string | undefined },
): Promise<QueueReadResult> {
  const parsed = parseQueuePage(query);
  if (!parsed.ok) {
    return { ok: false, refusal: { status: 400, error: parsed.message, code: parsed.error } };
  }
  const { tab, limit, cursor, status } = parsed.request;
  if (tab === "due") {
    return {
      ok: false,
      refusal: {
        status: 400,
        error: "The repeat-service tab is served by /recurring-plans/due.",
        code: "wrong_endpoint",
      },
    };
  }

  const visibility = queueVisibility(viewer.isAssignmentScoped, viewer.userId);
  const state = tabState(tab);
  const [rows, grouped] = await Promise.all([
    listQueuePage({ state, limit, cursor, status }, visibility),
    countByQueueStatus(state, visibility),
  ]);

  const counts: Record<string, number> = {};
  for (const row of grouped) counts[row.queueStatus ?? "unspecified"] = row.count;

  return { ok: true, tab, page: toQueuePage(rows, limit), counts };
}

/* -- Transitions -------------------------------------------------------- */

export type TransitionResult =
  | { ok: true; entryId: number; jobId: number; state: string }
  | { ok: false; refusal: QueueRefusal };

type AuditEntry = {
  action: string;
  fromValue: string | null;
  toValue: string | null;
  reason?: string | null;
  note: string;
};

type Executor = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
  insert: typeof db.insert;
};

type Plan =
  | { ok: true; state: string; write: (tx: Executor) => Promise<void>; audit: AuditEntry }
  | { ok: false; refusal: QueueRefusal };

function readFacts(row: Record<string, unknown>): EntryFacts {
  return {
    entryId: Number(row.entryId),
    jobId: Number(row.jobId),
    state: String(row.state),
    isPrimary: row.isPrimary === true,
    scheduledDate: (row.scheduledDate as string | null) ?? null,
    jobStatus: String(row.jobStatus ?? ""),
    hasInvoice: row.hasInvoice === true,
  };
}

/**
 * Runs one transition inside a single transaction, re-reading the entry under
 * `FOR UPDATE` before deciding.
 *
 * The re-read is the point. The unlocked read tells us whether the request is
 * worth attempting; the locked read tells us whether it is still true. Without
 * it, two people acting on the same card from two browsers would both pass the
 * check and the second write would silently win.
 */
async function transition(
  entryId: number,
  actor: Actor,
  plan: (entry: EntrySnapshot, facts: EntryFacts) => Plan,
): Promise<TransitionResult> {
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return { ok: false, refusal: { status: 400, error: "Invalid entry id", code: "bad_entry_id" } };
  }
  // Cheap enough to be worth doing before opening a transaction: a request for
  // an entry that does not exist never takes a row lock.
  if (!(await findEntryFacts(entryId))) return { ok: false, refusal: NOT_FOUND };

  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT
        e.id AS "entryId", e.job_id AS "jobId", e.status AS "state",
        e.is_primary AS "isPrimary", e.scheduled_date AS "scheduledDate",
        jobs.status AS "jobStatus",
        EXISTS (SELECT 1 FROM invoice_jobs ij WHERE ij.job_id = e.job_id) AS "hasInvoice"
      FROM schedule_entries e
      JOIN jobs ON jobs.id = e.job_id
      WHERE e.id = ${entryId}
      FOR UPDATE OF e
    `);
    const row = locked.rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false as const, refusal: NOT_FOUND };

    const facts = readFacts(row);
    const decision = plan(snapshot(facts), facts);
    if (!decision.ok) return { ok: false as const, refusal: decision.refusal };

    const executor = tx as unknown as Executor;
    await decision.write(executor);

    // Logged against the customer, matching how job status changes and
    // reschedules are recorded, so one activity feed carries the whole story.
    const customer = await tx.execute(
      sql`SELECT customer_id AS "customerId" FROM jobs WHERE id = ${facts.jobId}`,
    );
    const customerId = Number(
      (customer.rows[0] as Record<string, unknown> | undefined)?.customerId ?? 0,
    );
    if (customerId) {
      await executor.insert(activityLogsTable).values({
        entityType: "customer",
        entityId: customerId,
        action: decision.audit.action,
        fromValue: decision.audit.fromValue,
        toValue: decision.audit.toValue,
        reason: decision.audit.reason ?? null,
        note: decision.audit.note,
        performedBy: performedBy(actor),
      });
    }

    return { ok: true as const, entryId: facts.entryId, jobId: facts.jobId, state: decision.state };
  });
}

/** A caller-supplied waiting reason, or the given default when it is absent or unusable. */
function chosenQueueStatus(
  entry: EntrySnapshot,
  state: EntrySnapshot["state"],
  supplied: unknown,
  fallback: QueueStatus,
): QueueStatus {
  const decision = decideQueueStatusChange({ ...entry, state }, supplied);
  return decision.ok ? decision.queueStatus : fallback;
}

/**
 * Pull work off the calendar without cancelling it — spec §4.6.
 *
 * The date is not discarded: it moves to `original_scheduled_date`, so the card
 * can still say when this was meant to happen. `jobs.scheduled_date` is cleared
 * to keep the legacy mirror honest — a held job must not keep painting on the
 * calendar through the old column.
 */
export async function holdEntry(
  entryId: number,
  input: { reason?: string | null; queueStatus?: unknown },
  actor: Actor,
): Promise<TransitionResult> {
  return transition(entryId, actor, (entry, facts) => {
    const decision = decideHold(entry, input);
    if (!decision.ok) return { ok: false, refusal: refusal(decision.reason, decision.message) };

    const reason = String(input.reason).trim();
    const queueStatus = chosenQueueStatus(entry, "on_hold", input.queueStatus, "waiting_on_customer");
    const who = performedBy(actor);

    return {
      ok: true,
      state: "on_hold",
      write: async (tx) => {
        await tx.execute(sql`
          UPDATE schedule_entries
             SET status = 'on_hold',
                 on_hold_reason = ${reason},
                 queue_status = ${queueStatus},
                 original_scheduled_date = COALESCE(original_scheduled_date, scheduled_date),
                 scheduled_date = NULL,
                 updated_by = ${who},
                 updated_at = now()
           WHERE id = ${entryId}
        `);
        if (facts.isPrimary) {
          await tx.execute(sql`
            UPDATE jobs
               SET scheduled_date = NULL, status = 'unscheduled', updated_at = now()
             WHERE id = ${facts.jobId}
               AND status NOT IN ('completed', 'canceled', 'cancelled')
          `);
        }
      },
      audit: {
        action: "job_placed_on_hold",
        fromValue: facts.scheduledDate ?? facts.state,
        toValue: "on_hold",
        reason,
        note: `Job put on hold: ${reason}`,
      },
    };
  });
}

/** Held work returns to the queue, ready to be scheduled again — spec §4.4. */
export async function releaseEntry(
  entryId: number,
  input: { queueStatus?: unknown },
  actor: Actor,
): Promise<TransitionResult> {
  return transition(entryId, actor, (entry) => {
    const decision = decideRelease(entry);
    if (!decision.ok) return { ok: false, refusal: refusal(decision.reason, decision.message) };

    const queueStatus = chosenQueueStatus(
      entry,
      "queued",
      input.queueStatus,
      initialQueueStatus("released_from_hold"),
    );
    const who = performedBy(actor);

    return {
      ok: true,
      state: "queued",
      write: async (tx) => {
        // The hold reason goes with the hold. Leaving it behind would make a
        // ready card claim it is still waiting on something.
        await tx.execute(sql`
          UPDATE schedule_entries
             SET status = 'queued', on_hold_reason = NULL, queue_status = ${queueStatus},
                 updated_by = ${who}, updated_at = now()
           WHERE id = ${entryId}
        `);
      },
      audit: {
        action: "job_returned_to_queue",
        fromValue: "on_hold",
        toValue: "queued",
        note: "Job returned to Ready to Schedule",
      },
    };
  });
}

/** Queued or held work moves onto the calendar — spec §4.4. */
export async function scheduleEntry(
  entryId: number,
  input: ScheduleFromQueueInput,
  actor: Actor,
): Promise<TransitionResult> {
  return transition(entryId, actor, (entry, facts) => {
    const decision = decideSchedule(entry, input);
    if (!decision.ok) return { ok: false, refusal: refusal(decision.reason, decision.message) };

    const { scheduledDate, startTime, endTime } = decision;
    const who = performedBy(actor);

    return {
      ok: true,
      state: "scheduled",
      write: async (tx) => {
        // `queue_status` must go to NULL: the scope constraint allows a waiting
        // reason only off the calendar, and scheduled work waits on nothing.
        await tx.execute(sql`
          UPDATE schedule_entries
             SET status = 'scheduled', scheduled_date = ${scheduledDate},
                 scheduled_start_time = ${startTime}, scheduled_end_time = ${endTime},
                 queue_status = NULL, on_hold_reason = NULL,
                 updated_by = ${who}, updated_at = now()
           WHERE id = ${entryId}
        `);
        if (facts.isPrimary) {
          await tx.execute(sql`
            UPDATE jobs
               SET scheduled_date = ${scheduledDate},
                   scheduled_start_time = ${startTime},
                   scheduled_end_time = ${endTime},
                   status = CASE WHEN status = 'unscheduled' THEN 'scheduled' ELSE status END,
                   updated_at = now()
             WHERE id = ${facts.jobId}
          `);
        }
      },
      audit: {
        action: "job_scheduled_from_queue",
        fromValue: facts.state,
        toValue: scheduledDate,
        note: `Job scheduled from the queue for ${scheduledDate}`,
      },
    };
  });
}

/** Change what a card is waiting on, without moving it — spec §4.3. */
export async function setQueueStatus(
  entryId: number,
  next: unknown,
  actor: Actor,
): Promise<TransitionResult> {
  return transition(entryId, actor, (entry, facts) => {
    const decision = decideQueueStatusChange(entry, next);
    if (!decision.ok) return { ok: false, refusal: refusal(decision.reason, decision.message) };
    const who = performedBy(actor);

    return {
      ok: true,
      state: facts.state,
      write: async (tx) => {
        await tx.execute(sql`
          UPDATE schedule_entries
             SET queue_status = ${decision.queueStatus},
                 updated_by = ${who}, updated_at = now()
           WHERE id = ${entryId}
        `);
      },
      audit: {
        action: "queue_status_changed",
        fromValue: null,
        toValue: decision.queueStatus,
        note: `Queue status set to ${decision.queueStatus}`,
      },
    };
  });
}
