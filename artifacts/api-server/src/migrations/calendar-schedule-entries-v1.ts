import { createHash } from "node:crypto";
import type { MigrationDefinition, MigrationContext } from "./application-migrations.ts";

export const CALENDAR_SCHEDULE_ENTRIES_V1_ID = "calendar_schedule_entries_v1";

/**
 * Moves the schedule off the job row.
 *
 * A job carried its own `scheduled_date`, so a job could occupy exactly one
 * date. Multi-day work, on-hold work and the scheduling queue all need more
 * than that. This migration adds the four calendar tables and backfills one
 * primary schedule entry for every job that already has a date.
 *
 * `jobs.scheduled_date` is deliberately left in place as a mirror of the
 * primary entry, the same arrangement `crew_members` has with the legacy text
 * on `crews`. Roughly forty call sites still read it, and breaking them all at
 * once buys nothing.
 *
 * Money follows the client's rule: the whole job value lands on the day the job
 * starts. Every backfilled entry is a primary entry, so each carries its job's
 * full amount.
 */

const TABLE_DEFINITIONS = [
  ["schedule_entries", `CREATE TABLE IF NOT EXISTS schedule_entries (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id integer NOT NULL,
    segment_number integer NOT NULL DEFAULT 1,
    is_primary boolean NOT NULL DEFAULT true,
    scheduled_date text,
    scheduled_start_time text,
    scheduled_end_time text,
    end_date text,
    is_all_day boolean NOT NULL DEFAULT false,
    no_specific_time boolean NOT NULL DEFAULT false,
    duration_minutes integer,
    status text NOT NULL DEFAULT 'scheduled',
    allocated_value_cents numeric(18,0) NOT NULL DEFAULT 0,
    recurring_plan_id integer,
    occurrence_key text,
    rescheduled_count integer NOT NULL DEFAULT 0,
    original_scheduled_date text,
    on_hold_reason text,
    callback_date text,
    created_by text,
    updated_by text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT schedule_entries_status_check CHECK (status IN ('queued', 'scheduled', 'on_hold', 'canceled')),
    CONSTRAINT schedule_entries_segment_check CHECK (segment_number >= 1),
    CONSTRAINT schedule_entries_value_check CHECK (allocated_value_cents >= 0),
    CONSTRAINT schedule_entries_rescheduled_count_check CHECK (rescheduled_count >= 0),
    CONSTRAINT schedule_entries_duration_check CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
    CONSTRAINT schedule_entries_date_format_check CHECK ((scheduled_date IS NULL OR scheduled_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AND (end_date IS NULL OR end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AND (original_scheduled_date IS NULL OR original_scheduled_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AND (callback_date IS NULL OR callback_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')),
    CONSTRAINT schedule_entries_time_format_check CHECK ((scheduled_start_time IS NULL OR scheduled_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$') AND (scheduled_end_time IS NULL OR scheduled_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')),
    CONSTRAINT schedule_entries_scheduled_needs_date_check CHECK (status <> 'scheduled' OR scheduled_date IS NOT NULL),
    CONSTRAINT schedule_entries_hold_needs_reason_check CHECK (status <> 'on_hold' OR on_hold_reason IS NOT NULL),
    CONSTRAINT schedule_entries_value_on_primary_check CHECK (is_primary OR allocated_value_cents = 0))`],
  ["schedule_assignments", `CREATE TABLE IF NOT EXISTS schedule_assignments (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schedule_entry_id integer NOT NULL,
    assignment_type text NOT NULL,
    crew_id integer,
    user_id varchar,
    queue_key text,
    is_primary boolean NOT NULL DEFAULT false,
    value_allocation_percent integer,
    planned_minutes integer,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT schedule_assignments_type_check CHECK (assignment_type IN ('employee', 'crew', 'queue')),
    CONSTRAINT schedule_assignments_target_check CHECK ((assignment_type = 'crew' AND crew_id IS NOT NULL AND user_id IS NULL AND queue_key IS NULL) OR (assignment_type = 'employee' AND user_id IS NOT NULL AND crew_id IS NULL AND queue_key IS NULL) OR (assignment_type = 'queue' AND queue_key IS NOT NULL AND crew_id IS NULL AND user_id IS NULL)),
    CONSTRAINT schedule_assignments_percent_check CHECK (value_allocation_percent IS NULL OR (value_allocation_percent >= 0 AND value_allocation_percent <= 100)),
    CONSTRAINT schedule_assignments_planned_minutes_check CHECK (planned_minutes IS NULL OR planned_minutes >= 0))`],
  ["calendar_events", `CREATE TABLE IF NOT EXISTS calendar_events (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    title text NOT NULL,
    description text,
    start_date text NOT NULL,
    end_date text,
    start_time text,
    end_time text,
    is_all_day boolean NOT NULL DEFAULT false,
    related_type text,
    related_id integer,
    scope_type text NOT NULL DEFAULT 'company',
    crew_id integer,
    user_id varchar,
    block_mode text,
    reason text,
    color text,
    is_active boolean NOT NULL DEFAULT true,
    created_by text,
    updated_by text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT calendar_events_type_check CHECK (event_type IN ('estimate_appointment', 'prospect_appointment', 'task', 'personal_appointment', 'scheduling_block', 'holiday', 'employee_birthday')),
    CONSTRAINT calendar_events_scope_check CHECK (scope_type IN ('company', 'crew', 'employee')),
    CONSTRAINT calendar_events_block_mode_check CHECK (block_mode IS NULL OR block_mode IN ('hard', 'soft')),
    CONSTRAINT calendar_events_block_mode_scope_check CHECK ((event_type = 'scheduling_block' AND block_mode IS NOT NULL) OR (event_type <> 'scheduling_block' AND block_mode IS NULL)),
    CONSTRAINT calendar_events_scope_target_check CHECK ((scope_type = 'company' AND crew_id IS NULL AND user_id IS NULL) OR (scope_type = 'crew' AND crew_id IS NOT NULL) OR (scope_type = 'employee' AND user_id IS NOT NULL)),
    CONSTRAINT calendar_events_date_format_check CHECK (start_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (end_date IS NULL OR end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')),
    CONSTRAINT calendar_events_time_format_check CHECK ((start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$') AND (end_time IS NULL OR end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')),
    CONSTRAINT calendar_events_range_check CHECK (end_date IS NULL OR end_date >= start_date))`],
  ["calendar_preferences", `CREATE TABLE IF NOT EXISTS calendar_preferences (
    user_id varchar PRIMARY KEY,
    default_view text NOT NULL DEFAULT 'month',
    last_viewed_date text,
    week_starts_on integer NOT NULL DEFAULT 1,
    show_sunday boolean NOT NULL DEFAULT true,
    assignment_display text NOT NULL DEFAULT 'grouped',
    show_completed_jobs boolean NOT NULL DEFAULT true,
    show_invoice_status boolean NOT NULL DEFAULT true,
    show_holidays boolean NOT NULL DEFAULT true,
    show_employee_birthdays boolean NOT NULL DEFAULT false,
    show_job_counts boolean NOT NULL DEFAULT true,
    show_scheduled_value boolean NOT NULL DEFAULT true,
    show_duration_totals boolean NOT NULL DEFAULT false,
    color_mode text NOT NULL DEFAULT 'assignment',
    sidebar_open boolean NOT NULL DEFAULT true,
    list_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT calendar_preferences_default_view_check CHECK (default_view IN ('month', 'week', 'day')),
    CONSTRAINT calendar_preferences_week_start_check CHECK (week_starts_on IN (0, 1)),
    CONSTRAINT calendar_preferences_assignment_display_check CHECK (assignment_display IN ('grouped', 'separate')),
    CONSTRAINT calendar_preferences_color_mode_check CHECK (color_mode IN ('assignment', 'event_type', 'customer_type', 'service_type')),
    CONSTRAINT calendar_preferences_last_viewed_date_check CHECK (last_viewed_date IS NULL OR last_viewed_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    CONSTRAINT calendar_preferences_list_settings_check CHECK (jsonb_typeof(list_settings) = 'object'))`],
] as const;

const FK_DEFINITIONS = [
  ["schedule_entries_job_id_jobs_id_cascade_fk", "schedule_entries", "job_id", "jobs", "CASCADE"],
  ["schedule_assignments_entry_id_schedule_entries_id_cascade_fk", "schedule_assignments", "schedule_entry_id", "schedule_entries", "CASCADE"],
  ["schedule_assignments_crew_id_crews_id_restrict_fk", "schedule_assignments", "crew_id", "crews", "RESTRICT"],
  ["schedule_assignments_user_id_users_id_restrict_fk", "schedule_assignments", "user_id", "users", "RESTRICT"],
  ["calendar_events_crew_id_crews_id_restrict_fk", "calendar_events", "crew_id", "crews", "RESTRICT"],
  ["calendar_events_user_id_users_id_restrict_fk", "calendar_events", "user_id", "users", "RESTRICT"],
  ["calendar_preferences_user_id_users_id_cascade_fk", "calendar_preferences", "user_id", "users", "CASCADE"],
] as const;

const INDEX_DEFINITIONS = [
  ["schedule_entries_job_segment_unique", "CREATE UNIQUE INDEX IF NOT EXISTS schedule_entries_job_segment_unique ON schedule_entries (job_id, segment_number)"],
  ["schedule_entries_one_primary_unique", "CREATE UNIQUE INDEX IF NOT EXISTS schedule_entries_one_primary_unique ON schedule_entries (job_id) WHERE is_primary"],
  ["schedule_entries_date_idx", "CREATE INDEX IF NOT EXISTS schedule_entries_date_idx ON schedule_entries (scheduled_date)"],
  ["schedule_entries_status_date_idx", "CREATE INDEX IF NOT EXISTS schedule_entries_status_date_idx ON schedule_entries (status, scheduled_date)"],
  ["schedule_entries_job_idx", "CREATE INDEX IF NOT EXISTS schedule_entries_job_idx ON schedule_entries (job_id)"],
  ["schedule_entries_recurring_plan_idx", "CREATE INDEX IF NOT EXISTS schedule_entries_recurring_plan_idx ON schedule_entries (recurring_plan_id)"],
  ["schedule_assignments_one_primary_unique", "CREATE UNIQUE INDEX IF NOT EXISTS schedule_assignments_one_primary_unique ON schedule_assignments (schedule_entry_id) WHERE is_primary"],
  ["schedule_assignments_crew_unique", "CREATE UNIQUE INDEX IF NOT EXISTS schedule_assignments_crew_unique ON schedule_assignments (schedule_entry_id, crew_id) WHERE crew_id IS NOT NULL"],
  ["schedule_assignments_user_unique", "CREATE UNIQUE INDEX IF NOT EXISTS schedule_assignments_user_unique ON schedule_assignments (schedule_entry_id, user_id) WHERE user_id IS NOT NULL"],
  ["schedule_assignments_queue_unique", "CREATE UNIQUE INDEX IF NOT EXISTS schedule_assignments_queue_unique ON schedule_assignments (schedule_entry_id, queue_key) WHERE queue_key IS NOT NULL"],
  ["schedule_assignments_entry_idx", "CREATE INDEX IF NOT EXISTS schedule_assignments_entry_idx ON schedule_assignments (schedule_entry_id)"],
  ["schedule_assignments_crew_idx", "CREATE INDEX IF NOT EXISTS schedule_assignments_crew_idx ON schedule_assignments (crew_id)"],
  ["schedule_assignments_user_idx", "CREATE INDEX IF NOT EXISTS schedule_assignments_user_idx ON schedule_assignments (user_id)"],
  ["calendar_events_date_idx", "CREATE INDEX IF NOT EXISTS calendar_events_date_idx ON calendar_events (start_date)"],
  ["calendar_events_type_date_idx", "CREATE INDEX IF NOT EXISTS calendar_events_type_date_idx ON calendar_events (event_type, start_date)"],
  ["calendar_events_crew_idx", "CREATE INDEX IF NOT EXISTS calendar_events_crew_idx ON calendar_events (crew_id)"],
  ["calendar_events_user_idx", "CREATE INDEX IF NOT EXISTS calendar_events_user_idx ON calendar_events (user_id)"],
  ["calendar_events_related_idx", "CREATE INDEX IF NOT EXISTS calendar_events_related_idx ON calendar_events (related_type, related_id)"],
] as const;

// The declarative contract. Changing any DDL above necessarily changes the
// checksum, which is what forces a new migration id rather than a silent edit.
export const CALENDAR_SCHEDULE_ENTRIES_V1_CONTENT = JSON.stringify({
  tables: TABLE_DEFINITIONS.map(([name]) => name),
  ddl: TABLE_DEFINITIONS.map(([, ddl]) => ddl.replace(/\s+/g, " ").trim()),
  foreignKeys: FK_DEFINITIONS,
  indexes: INDEX_DEFINITIONS,
  backfill: "one primary schedule_entries row per job with a scheduled_date; full job value in cents on that row",
});
export const CALENDAR_SCHEDULE_ENTRIES_V1_CHECKSUM = createHash("sha256")
  .update(CALENDAR_SCHEDULE_ENTRIES_V1_CONTENT).digest("hex");

type Counts = {
  jobRows: number;
  datedJobRows: number;
  entryRows: number;
  primaryEntryRows: number;
  datedJobsWithoutEntry: number;
  entriesWithoutJob: number;
  jobsWithMultiplePrimaries: number;
  /**
   * Dated jobs whose own columns would violate a schedule-entry constraint.
   * Worth counting separately: this migration runs at server startup, so a raw
   * constraint violation here would stop the process from booting with nothing
   * but a Postgres error to go on.
   */
  unmigratableJobs: number;
};

const count = (result: { rows: Record<string, unknown>[] }) => Number(result.rows[0]?.count ?? 0);

async function tableExists(context: MigrationContext, table: string): Promise<boolean> {
  const result = await context.client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = $1
     ) AS exists`,
    [table],
  );
  return result.rows[0]?.exists === true;
}

/**
 * A MigrationContext owns one pg client. Keep its queries sequential; pg does
 * not support concurrent client.query calls and pg@9 will reject them.
 */
async function scheduleCounts(context: MigrationContext): Promise<Counts> {
  const jobs = await context.client.query("SELECT count(*)::int AS count FROM jobs");
  const dated = await context.client.query(
    "SELECT count(*)::int AS count FROM jobs WHERE scheduled_date IS NOT NULL",
  );
  // Same predicates as the table's own checks, asked of the source data first.
  const unmigratable = await context.client.query(
    `SELECT count(*)::int AS count
       FROM jobs j
      WHERE j.scheduled_date IS NOT NULL
        AND (
          j.scheduled_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          OR (j.scheduled_start_time IS NOT NULL AND j.scheduled_start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
          OR (j.scheduled_end_time IS NOT NULL AND j.scheduled_end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
          OR j.total_amount < 0
          OR (j.estimated_duration IS NOT NULL AND j.estimated_duration < 0)
        )`,
  );

  if (!(await tableExists(context, "schedule_entries"))) {
    return {
      jobRows: count(jobs),
      datedJobRows: count(dated),
      entryRows: 0,
      primaryEntryRows: 0,
      datedJobsWithoutEntry: count(dated),
      entriesWithoutJob: 0,
      jobsWithMultiplePrimaries: 0,
      unmigratableJobs: count(unmigratable),
    };
  }

  const entries = await context.client.query("SELECT count(*)::int AS count FROM schedule_entries");
  const primaries = await context.client.query(
    "SELECT count(*)::int AS count FROM schedule_entries WHERE is_primary",
  );
  const missing = await context.client.query(
    `SELECT count(*)::int AS count
       FROM jobs j
       LEFT JOIN schedule_entries e ON e.job_id = j.id AND e.is_primary
      WHERE j.scheduled_date IS NOT NULL AND e.id IS NULL`,
  );
  const orphans = await context.client.query(
    `SELECT count(*)::int AS count
       FROM schedule_entries e
       LEFT JOIN jobs j ON j.id = e.job_id
      WHERE j.id IS NULL`,
  );
  const duplicatePrimaries = await context.client.query(
    `SELECT count(*)::int AS count FROM (
       SELECT job_id FROM schedule_entries WHERE is_primary
        GROUP BY job_id HAVING count(*) > 1
     ) AS duplicates`,
  );

  return {
    jobRows: count(jobs),
    datedJobRows: count(dated),
    entryRows: count(entries),
    primaryEntryRows: count(primaries),
    datedJobsWithoutEntry: count(missing),
    entriesWithoutJob: count(orphans),
    jobsWithMultiplePrimaries: count(duplicatePrimaries),
    unmigratableJobs: count(unmigratable),
  };
}

function assertConsistent(counts: Counts): void {
  if (counts.entriesWithoutJob > 0 || counts.jobsWithMultiplePrimaries > 0) {
    throw new Error(
      `Calendar schedule entry consistency check failed: ${JSON.stringify(counts)}`,
    );
  }
}

/**
 * Refuse before touching the schema when a dated job could not become a valid
 * schedule entry — a malformed date or time, a negative amount, a negative
 * duration. Saying so plainly beats letting Postgres raise a constraint error
 * during startup, where the only clue would be the constraint's name.
 */
function assertMigratable(counts: Counts): void {
  if (counts.unmigratableJobs > 0) {
    throw new Error(
      `Calendar schedule migration refused: ${counts.unmigratableJobs} dated job(s) have a malformed `
      + "scheduled_date, scheduled_start_time or scheduled_end_time, a negative total_amount, or a "
      + "negative estimated_duration. Correct those job rows, then run this migration again.",
    );
  }
}

async function addForeignKey(
  context: MigrationContext,
  name: string,
  table: string,
  column: string,
  target: string,
  onDelete: string,
): Promise<void> {
  await context.client.query(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
         ALTER TABLE ${table} ADD CONSTRAINT ${name}
           FOREIGN KEY (${column}) REFERENCES ${target}(id) ON DELETE ${onDelete};
       END IF;
     END $$`,
  );
}

async function verifyCatalog(context: MigrationContext): Promise<Record<string, unknown>> {
  const tables: Record<string, boolean> = {};
  for (const [name] of TABLE_DEFINITIONS) tables[name] = await tableExists(context, name);

  const constraints = await context.client.query(
    `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`,
    [FK_DEFINITIONS.map(([name]) => name)],
  );
  const indexes = await context.client.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`,
    [INDEX_DEFINITIONS.map(([name]) => name)],
  );

  return {
    tables,
    foreignKeys: constraints.rows.length,
    expectedForeignKeys: FK_DEFINITIONS.length,
    indexes: indexes.rows.length,
    expectedIndexes: INDEX_DEFINITIONS.length,
  };
}

function assertCatalogVerified(verified: Record<string, unknown>): void {
  const tables = verified.tables as Record<string, boolean>;
  if (
    Object.values(tables).some((exists) => !exists)
    || verified.foreignKeys !== verified.expectedForeignKeys
    || verified.indexes !== verified.expectedIndexes
  ) {
    throw new Error(
      `Calendar schedule schema catalog verification failed: ${JSON.stringify(verified)}`,
    );
  }
}

export const calendarScheduleEntriesV1Migration: MigrationDefinition<Counts> = {
  id: CALENDAR_SCHEDULE_ENTRIES_V1_ID,
  checksum: CALENDAR_SCHEDULE_ENTRIES_V1_CHECKSUM,
  description: "Add the calendar schedule entry, assignment, event and preference tables, and backfill primary entries",
  required: true,
  preflight: scheduleCounts,
  backup: async (_context, preflight) => ({
    ...preflight,
    backupKind: "additive_schema_and_derived_backfill",
    // Every backfilled row is derived from jobs, which this migration never
    // writes to, so the source of truth is its own backup.
    sourceTableMutated: false,
  }),
  apply: async (context, preflight) => {
    assertConsistent(preflight);
    assertMigratable(preflight);

    for (const [, ddl] of TABLE_DEFINITIONS) await context.client.query(ddl);
    for (const [name, table, column, target, onDelete] of FK_DEFINITIONS) {
      await addForeignKey(context, name, table, column, target, onDelete);
    }
    for (const [, ddl] of INDEX_DEFINITIONS) await context.client.query(ddl);

    // One primary entry per dated job. Times and duration come across as they
    // are; the value is the job's whole amount, in cents, because the client's
    // rule anchors a job's money to the day it starts.
    const inserted = await context.client.query(
      `INSERT INTO schedule_entries (
         job_id, segment_number, is_primary, scheduled_date, scheduled_start_time,
         scheduled_end_time, no_specific_time, duration_minutes, status,
         allocated_value_cents, recurring_plan_id, original_scheduled_date, created_by
       )
       SELECT
         j.id, 1, true, j.scheduled_date, j.scheduled_start_time,
         j.scheduled_end_time, j.scheduled_start_time IS NULL, j.estimated_duration,
         CASE WHEN j.status IN ('canceled', 'cancelled') THEN 'canceled' ELSE 'scheduled' END,
         COALESCE(ROUND(j.total_amount * 100), 0), j.recurring_plan_id,
         j.scheduled_date, 'migration:${CALENDAR_SCHEDULE_ENTRIES_V1_ID}'
       FROM jobs j
       LEFT JOIN schedule_entries e ON e.job_id = j.id AND e.is_primary
       WHERE j.scheduled_date IS NOT NULL AND e.id IS NULL
       RETURNING id`,
    );

    return { additive: true, entriesBackfilled: inserted.rows.length };
  },
  postflight: async (context, preflight) => {
    const after = await scheduleCounts(context);
    assertConsistent(after);
    if (after.jobRows !== preflight.jobRows || after.datedJobRows !== preflight.datedJobRows) {
      throw new Error("Calendar schedule migration must not change the jobs table");
    }
    if (after.datedJobsWithoutEntry > 0) {
      throw new Error(
        `Backfill incomplete: ${after.datedJobsWithoutEntry} dated jobs have no primary schedule entry`,
      );
    }
    const verified = await verifyCatalog(context);
    assertCatalogVerified(verified);
    return { ...verified, ...after, sourceRowsPreserved: true };
  },
  verify: async (context) => {
    const counts = await scheduleCounts(context);
    assertConsistent(counts);
    if (counts.datedJobsWithoutEntry > 0) {
      throw new Error(
        `Verification failed: ${counts.datedJobsWithoutEntry} dated jobs have no primary schedule entry`,
      );
    }
    const verified = await verifyCatalog(context);
    assertCatalogVerified(verified);
    return { ...verified, ...counts };
  },
  rollback: async (context) => {
    // Backfilled rows are reproducible from jobs, so dropping them loses
    // nothing. Anything a person has since added is not, so refuse then.
    if (await tableExists(context, "schedule_entries")) {
      const authored = await context.client.query(
        `SELECT count(*)::int AS count FROM schedule_entries
          WHERE created_by IS DISTINCT FROM 'migration:${CALENDAR_SCHEDULE_ENTRIES_V1_ID}'`,
      );
      if (count(authored) > 0) {
        throw new Error("Rollback refused: schedule entries created outside the backfill would be lost");
      }
    }
    for (const table of ["calendar_events", "calendar_preferences"]) {
      if (!(await tableExists(context, table))) continue;
      const rows = await context.client.query(`SELECT count(*)::int AS count FROM ${table}`);
      if (count(rows) > 0) {
        throw new Error(`Rollback refused: ${table} holds data that cannot be reproduced`);
      }
    }

    await context.client.query("DROP TABLE IF EXISTS schedule_assignments");
    await context.client.query("DROP TABLE IF EXISTS schedule_entries");
    await context.client.query("DROP TABLE IF EXISTS calendar_events");
    await context.client.query("DROP TABLE IF EXISTS calendar_preferences");
    return { removedTables: TABLE_DEFINITIONS.length, jobRowsChanged: 0 };
  },
};
