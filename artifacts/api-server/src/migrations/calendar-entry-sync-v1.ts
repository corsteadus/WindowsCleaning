import { createHash } from "node:crypto";
import type { MigrationDefinition, MigrationContext } from "./application-migrations.ts";

export const CALENDAR_ENTRY_SYNC_V1_ID = "calendar_entry_sync_v1";

/**
 * Keeps each job's primary schedule entry in step with the job, from the
 * database itself.
 *
 * The two calendar migrations backfilled entries once. Nothing in the
 * application wrote them afterwards, so a job created or re-dated after those
 * migrations never reached the queue or the entries table at all. Jobs are
 * written from nine places — the jobs, quotes, estimates and recurring-plan
 * routes, the recurring engine, the initial-job flow, admin tools, and two
 * raw-SQL importers — and wiring each one by hand would leave the next new
 * path silently out of sync. A trigger on `jobs` covers every path, including
 * the ones that bypass the ORM.
 *
 * The mapping is exactly the one the two backfills used, so an entry written
 * by the trigger is indistinguishable from one written by a migration:
 *
 *  - cancelled job        → `canceled` (only if dated, or if an entry exists)
 *  - job with a date      → `scheduled`
 *  - undated, entry held  → stays `on_hold` — see below
 *  - undated, open status → `queued`, keeping any waiting reason already set
 *  - undated, finished    → left alone; there is nowhere sensible to put it
 *
 * The one rule the backfills never needed: **a held entry is never demoted.**
 * Putting work on hold clears the job's date through the legacy mirror column,
 * and without this rule that update would bounce the entry straight back into
 * the queue and discard the hold reason.
 *
 * Only primary entries are managed. Later segments of multi-day work belong to
 * the scheduling code that creates them.
 */

const FUNCTION_NAME = "sync_primary_schedule_entry";
const TRIGGER_NAME = "jobs_sync_primary_schedule_entry";

/** Same shapes the schedule_entries check constraints enforce. */
const DATE_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";
const TIME_PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$";
const OPEN_JOB_STATUSES = "'unscheduled', 'scheduled', 'pending'";

/**
 * Columns whose change can move an entry. Deliberately not "every column": a
 * note or a crew edit has no bearing on the entry and should not rewrite it.
 */
const SCHEDULING_COLUMNS = [
  "scheduled_date",
  "scheduled_start_time",
  "scheduled_end_time",
  "status",
  "total_amount",
  "estimated_duration",
  "recurring_plan_id",
] as const;

/*
 * A malformed legacy date or time is treated as absent rather than raised.
 * Raising would turn a bad imported value into a failed job write — the
 * importers would stop — while the entry's own check constraints would reject
 * it anyway.
 */
export const SYNC_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  job_date    text    := CASE WHEN NEW.scheduled_date ~ '${DATE_PATTERN}' THEN NEW.scheduled_date END;
  start_time  text    := CASE WHEN NEW.scheduled_start_time ~ '${TIME_PATTERN}' THEN NEW.scheduled_start_time END;
  end_time    text    := CASE WHEN NEW.scheduled_end_time ~ '${TIME_PATTERN}' THEN NEW.scheduled_end_time END;
  job_status  text    := lower(trim(coalesce(NEW.status, '')));
  value_cents numeric := COALESCE(ROUND(NEW.total_amount * 100), 0);
  duration    integer := CASE WHEN NEW.estimated_duration >= 0 THEN NEW.estimated_duration END;
  entry       schedule_entries%ROWTYPE;
  has_entry   boolean;
  next_status text;
BEGIN
  SELECT * INTO entry FROM schedule_entries
   WHERE job_id = NEW.id AND is_primary
   FOR UPDATE;
  has_entry := FOUND;

  IF job_status IN ('canceled', 'cancelled') THEN
    next_status := 'canceled';
  ELSIF job_date IS NOT NULL THEN
    next_status := 'scheduled';
  ELSIF has_entry AND entry.status = 'on_hold' THEN
    -- Holding clears the job's date; that must not undo the hold.
    next_status := 'on_hold';
  ELSIF job_status IN (${OPEN_JOB_STATUSES}) THEN
    next_status := 'queued';
  ELSE
    RETURN NEW;
  END IF;

  IF NOT has_entry THEN
    -- The backfills never gave an undated cancelled job an entry; neither do we.
    IF next_status = 'canceled' AND job_date IS NULL THEN
      RETURN NEW;
    END IF;
    INSERT INTO schedule_entries (
      job_id, segment_number, is_primary, scheduled_date, scheduled_start_time,
      scheduled_end_time, no_specific_time, duration_minutes, status, queue_status,
      allocated_value_cents, recurring_plan_id, original_scheduled_date, created_by
    ) VALUES (
      NEW.id, 1, true, job_date, start_time,
      end_time, start_time IS NULL, duration, next_status,
      CASE WHEN next_status = 'queued' THEN 'needs_contact' END,
      value_cents, NEW.recurring_plan_id, job_date, 'trigger:${FUNCTION_NAME}'
    );
    RETURN NEW;
  END IF;

  UPDATE schedule_entries SET
    scheduled_date          = job_date,
    scheduled_start_time    = start_time,
    scheduled_end_time      = end_time,
    no_specific_time        = start_time IS NULL,
    duration_minutes        = duration,
    status                  = next_status,
    -- A waiting reason only exists off the calendar (scope constraint).
    queue_status            = CASE
                                WHEN next_status = 'queued' THEN COALESCE(entry.queue_status, 'needs_contact')
                                WHEN next_status = 'on_hold' THEN entry.queue_status
                              END,
    on_hold_reason          = CASE WHEN next_status IN ('on_hold', 'canceled') THEN entry.on_hold_reason END,
    rescheduled_count       = entry.rescheduled_count
                              + CASE WHEN entry.scheduled_date IS NOT NULL AND job_date IS NOT NULL
                                      AND entry.scheduled_date <> job_date THEN 1 ELSE 0 END,
    original_scheduled_date = COALESCE(entry.original_scheduled_date, job_date),
    allocated_value_cents   = value_cents,
    recurring_plan_id       = NEW.recurring_plan_id,
    updated_at              = now()
  WHERE id = entry.id;

  RETURN NEW;
END
$fn$`;

export const SYNC_TRIGGER_SQL = `DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON jobs;
CREATE TRIGGER ${TRIGGER_NAME}
  AFTER INSERT OR UPDATE OF ${SCHEDULING_COLUMNS.join(", ")}
  ON jobs
  FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}()`;

/** Jobs the mapping says should have a primary entry and do not. */
const MISSING_PRIMARY_SQL = `SELECT j.id
   FROM jobs j
   LEFT JOIN schedule_entries e ON e.job_id = j.id AND e.is_primary
  WHERE e.id IS NULL
    AND (j.scheduled_date ~ '${DATE_PATTERN}'
         OR (j.scheduled_date IS NULL AND lower(trim(j.status)) IN (${OPEN_JOB_STATUSES})))`;

export const CALENDAR_ENTRY_SYNC_V1_CONTENT = JSON.stringify({
  function: SYNC_FUNCTION_SQL,
  trigger: SYNC_TRIGGER_SQL,
  reconcile: "fire the trigger once for every job missing a primary entry",
});
export const CALENDAR_ENTRY_SYNC_V1_CHECKSUM = createHash("sha256")
  .update(CALENDAR_ENTRY_SYNC_V1_CONTENT).digest("hex");

type Counts = {
  jobs: number;
  missingPrimary: number;
  functionExists: boolean;
  triggerEnabled: boolean;
};

const count = (result: { rows: Record<string, unknown>[] }) => Number(result.rows[0]?.count ?? 0);

/** Sequential: a MigrationContext owns one pg client, which rejects concurrent queries. */
async function syncCounts(context: MigrationContext): Promise<Counts> {
  const jobs = await context.client.query("SELECT count(*)::int AS count FROM jobs");
  const missing = await context.client.query(
    `SELECT count(*)::int AS count FROM (${MISSING_PRIMARY_SQL}) missing`,
  );
  const fn = await context.client.query(
    `SELECT count(*)::int AS count FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = current_schema() AND p.proname = $1`,
    [FUNCTION_NAME],
  );
  const trigger = await context.client.query(
    `SELECT count(*)::int AS count FROM pg_trigger
      WHERE tgname = $1 AND NOT tgisinternal AND tgenabled <> 'D'`,
    [TRIGGER_NAME],
  );
  return {
    jobs: count(jobs),
    missingPrimary: count(missing),
    functionExists: count(fn) === 1,
    triggerEnabled: count(trigger) === 1,
  };
}

function assertInSync(counts: Counts, stage: string): void {
  if (!counts.functionExists || !counts.triggerEnabled || counts.missingPrimary > 0) {
    throw new Error(`Calendar entry sync ${stage} failed: ${JSON.stringify(counts)}`);
  }
}

export const calendarEntrySyncV1Migration: MigrationDefinition<Counts> = {
  id: CALENDAR_ENTRY_SYNC_V1_ID,
  checksum: CALENDAR_ENTRY_SYNC_V1_CHECKSUM,
  description: "Keep each job's primary schedule entry in sync through a trigger on jobs",
  required: true,
  preflight: syncCounts,
  backup: async (_context, preflight) => ({
    ...preflight,
    backupKind: "trigger_definition_only",
    // Reconciliation re-fires the trigger with values the rows already hold;
    // no job value changes, so the jobs table is its own backup.
    jobValuesChanged: false,
  }),
  apply: async (context) => {
    await context.client.query(SYNC_FUNCTION_SQL);
    await context.client.query(SYNC_TRIGGER_SQL);

    // Jobs created between the backfills and now have no entry. Rather than a
    // second copy of the mapping in SQL, touch exactly those rows so the
    // trigger writes them — one definition of the rule, not two.
    const reconciled = await context.client.query(
      `UPDATE jobs SET status = status WHERE id IN (${MISSING_PRIMARY_SQL}) RETURNING id`,
    );
    return { function: FUNCTION_NAME, trigger: TRIGGER_NAME, reconciledJobs: reconciled.rows.length };
  },
  postflight: async (context, preflight) => {
    const after = await syncCounts(context);
    if (after.jobs !== preflight.jobs) {
      throw new Error("Calendar entry sync must not add or remove jobs");
    }
    assertInSync(after, "postflight");
    return { ...after, sourceRowsPreserved: true };
  },
  verify: async (context) => {
    const counts = await syncCounts(context);
    assertInSync(counts, "verification");
    return counts;
  },
  rollback: async (context) => {
    // Entries the trigger wrote stay: they are correct data, and removing them
    // would take work back out of the queue.
    await context.client.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON jobs`);
    await context.client.query(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`);
    return { removedTrigger: TRIGGER_NAME, removedFunction: FUNCTION_NAME, entriesRemoved: 0 };
  },
};
