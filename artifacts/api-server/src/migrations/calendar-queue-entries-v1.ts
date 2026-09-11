import { createHash } from "node:crypto";
import type { MigrationDefinition, MigrationContext } from "./application-migrations.ts";

export const CALENDAR_QUEUE_ENTRIES_V1_ID = "calendar_queue_entries_v1";

/**
 * Gives the scheduling queue somewhere to live.
 *
 * `calendar_schedule_entries_v1` backfilled one entry per *dated* job, which
 * left the undated ones — precisely the "Ready to Schedule" work of spec §4.1 —
 * with no entry at all. This adds them, as `status = 'queued'` rows with no
 * date.
 *
 * It also adds `queue_status`: what the work is waiting on, in the plain
 * language §4.3 asks for. That is deliberately a separate column from `status`.
 * `status` says where the work sits; `queue_status` says why it is still
 * sitting there.
 *
 * A separate migration rather than an edit to the first one because the
 * framework checksums each definition, and a changed checksum needs a new id.
 */

const QUEUE_STATUSES =
  "'needs_contact', 'contacted', 'callback_scheduled', 'waiting_on_customer', 'waiting_on_materials', 'weather_hold', 'ready_to_schedule'";

const CONSTRAINT_DEFINITIONS = [
  [
    "schedule_entries_queue_status_check",
    `queue_status IS NULL OR queue_status IN (${QUEUE_STATUSES})`,
  ],
  [
    "schedule_entries_queue_status_scope_check",
    "queue_status IS NULL OR status IN ('queued', 'on_hold')",
  ],
] as const;

const INDEX_DEFINITIONS = [
  [
    "schedule_entries_queue_idx",
    "CREATE INDEX IF NOT EXISTS schedule_entries_queue_idx ON schedule_entries (status, created_at, id)",
  ],
] as const;

/** Job states that still represent work someone intends to do. */
const OPEN_JOB_STATUSES = "'unscheduled', 'scheduled', 'pending'";

export const CALENDAR_QUEUE_ENTRIES_V1_CONTENT = JSON.stringify({
  column: "schedule_entries.queue_status text",
  constraints: CONSTRAINT_DEFINITIONS,
  indexes: INDEX_DEFINITIONS,
  backfill:
    `one queued schedule_entries row per open job with no scheduled_date and no existing entry; queue_status 'needs_contact'; job value in cents on the row, which is primary`,
});
export const CALENDAR_QUEUE_ENTRIES_V1_CHECKSUM = createHash("sha256")
  .update(CALENDAR_QUEUE_ENTRIES_V1_CONTENT).digest("hex");

type Counts = {
  openUndatedJobs: number;
  queuedEntries: number;
  undatedJobsWithoutEntry: number;
  queueStatusOutOfScope: number;
};

const count = (result: { rows: Record<string, unknown>[] }) => Number(result.rows[0]?.count ?? 0);

async function columnExists(context: MigrationContext, column: string): Promise<boolean> {
  const result = await context.client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'schedule_entries' AND column_name = $1
     ) AS exists`,
    [column],
  );
  return result.rows[0]?.exists === true;
}

/**
 * A MigrationContext owns one pg client, so these stay sequential; pg rejects
 * concurrent queries on a single client.
 */
async function queueCounts(context: MigrationContext): Promise<Counts> {
  const open = await context.client.query(
    `SELECT count(*)::int AS count FROM jobs
      WHERE scheduled_date IS NULL AND status IN (${OPEN_JOB_STATUSES})`,
  );
  const queued = await context.client.query(
    "SELECT count(*)::int AS count FROM schedule_entries WHERE status = 'queued'",
  );
  const missing = await context.client.query(
    `SELECT count(*)::int AS count
       FROM jobs j
       LEFT JOIN schedule_entries e ON e.job_id = j.id
      WHERE j.scheduled_date IS NULL AND j.status IN (${OPEN_JOB_STATUSES}) AND e.id IS NULL`,
  );

  const hasColumn = await columnExists(context, "queue_status");
  const outOfScope = hasColumn
    ? await context.client.query(
      `SELECT count(*)::int AS count FROM schedule_entries
        WHERE queue_status IS NOT NULL AND status NOT IN ('queued', 'on_hold')`,
    )
    : { rows: [{ count: 0 }] };

  return {
    openUndatedJobs: count(open),
    queuedEntries: count(queued),
    undatedJobsWithoutEntry: count(missing),
    queueStatusOutOfScope: count(outOfScope),
  };
}

/**
 * Refuse before adding the constraint when live rows would violate it, so the
 * failure is a sentence rather than a constraint name raised during boot.
 */
function assertConstrainable(counts: Counts): void {
  if (counts.queueStatusOutOfScope > 0) {
    throw new Error(
      `Queue migration refused: ${counts.queueStatusOutOfScope} schedule entries carry a queue_status `
      + "while scheduled or cancelled. Clear those values, then run this migration again.",
    );
  }
}

async function addConstraint(
  context: MigrationContext,
  name: string,
  expression: string,
): Promise<void> {
  await context.client.query(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
         ALTER TABLE schedule_entries ADD CONSTRAINT ${name} CHECK (${expression});
       END IF;
     END $$`,
  );
}

async function verifyCatalog(context: MigrationContext): Promise<Record<string, unknown>> {
  const constraints = await context.client.query(
    "SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])",
    [CONSTRAINT_DEFINITIONS.map(([name]) => name)],
  );
  const indexes = await context.client.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`,
    [INDEX_DEFINITIONS.map(([name]) => name)],
  );
  return {
    queueStatusColumn: await columnExists(context, "queue_status"),
    constraints: constraints.rows.length,
    expectedConstraints: CONSTRAINT_DEFINITIONS.length,
    indexes: indexes.rows.length,
    expectedIndexes: INDEX_DEFINITIONS.length,
  };
}

function assertCatalogVerified(verified: Record<string, unknown>): void {
  if (
    verified.queueStatusColumn !== true
    || verified.constraints !== verified.expectedConstraints
    || verified.indexes !== verified.expectedIndexes
  ) {
    throw new Error(`Queue schema catalog verification failed: ${JSON.stringify(verified)}`);
  }
}

export const calendarQueueEntriesV1Migration: MigrationDefinition<Counts> = {
  id: CALENDAR_QUEUE_ENTRIES_V1_ID,
  checksum: CALENDAR_QUEUE_ENTRIES_V1_CHECKSUM,
  description: "Add queue_status and backfill queued schedule entries for undated open jobs",
  required: true,
  preflight: queueCounts,
  backup: async (_context, preflight) => ({
    ...preflight,
    backupKind: "additive_column_and_derived_backfill",
    // Backfilled rows derive entirely from jobs, which this migration never
    // writes to, so the source is its own backup.
    sourceTableMutated: false,
  }),
  apply: async (context, preflight) => {
    assertConstrainable(preflight);

    await context.client.query(
      "ALTER TABLE schedule_entries ADD COLUMN IF NOT EXISTS queue_status text",
    );
    for (const [name, expression] of CONSTRAINT_DEFINITIONS) {
      await addConstraint(context, name, expression);
    }
    for (const [, ddl] of INDEX_DEFINITIONS) await context.client.query(ddl);

    // One queued entry per open, undated job. It is the job's only entry, so it
    // is primary and carries the whole value — the same anchoring rule the
    // dated backfill used.
    const inserted = await context.client.query(
      `INSERT INTO schedule_entries (
         job_id, segment_number, is_primary, scheduled_date, status, queue_status,
         allocated_value_cents, recurring_plan_id, created_by
       )
       SELECT
         j.id, 1, true, NULL, 'queued', 'needs_contact',
         COALESCE(ROUND(j.total_amount * 100), 0), j.recurring_plan_id,
         'migration:${CALENDAR_QUEUE_ENTRIES_V1_ID}'
       FROM jobs j
       LEFT JOIN schedule_entries e ON e.job_id = j.id
       WHERE j.scheduled_date IS NULL
         AND j.status IN (${OPEN_JOB_STATUSES})
         AND e.id IS NULL
       RETURNING id`,
    );

    return { additive: true, queuedEntriesBackfilled: inserted.rows.length };
  },
  postflight: async (context, preflight) => {
    const after = await queueCounts(context);
    if (after.openUndatedJobs !== preflight.openUndatedJobs) {
      throw new Error("Queue migration must not change the jobs table");
    }
    if (after.undatedJobsWithoutEntry > 0) {
      throw new Error(
        `Backfill incomplete: ${after.undatedJobsWithoutEntry} open undated jobs have no queue entry`,
      );
    }
    const verified = await verifyCatalog(context);
    assertCatalogVerified(verified);
    return { ...verified, ...after, sourceRowsPreserved: true };
  },
  verify: async (context) => {
    const counts = await queueCounts(context);
    if (counts.undatedJobsWithoutEntry > 0) {
      throw new Error(
        `Verification failed: ${counts.undatedJobsWithoutEntry} open undated jobs have no queue entry`,
      );
    }
    const verified = await verifyCatalog(context);
    assertCatalogVerified(verified);
    return { ...verified, ...counts };
  },
  rollback: async (context) => {
    // Backfilled rows are reproducible from jobs. Anything a person has since
    // queued or held is not, so refuse rather than lose it.
    const authored = await context.client.query(
      `SELECT count(*)::int AS count FROM schedule_entries
        WHERE status IN ('queued', 'on_hold')
          AND created_by IS DISTINCT FROM 'migration:${CALENDAR_QUEUE_ENTRIES_V1_ID}'`,
    );
    if (count(authored) > 0) {
      throw new Error("Rollback refused: queued or held work created outside the backfill would be lost");
    }

    await context.client.query(
      `DELETE FROM schedule_entries
        WHERE status = 'queued' AND created_by = 'migration:${CALENDAR_QUEUE_ENTRIES_V1_ID}'`,
    );
    for (const [name] of CONSTRAINT_DEFINITIONS) {
      await context.client.query(`ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS ${name}`);
    }
    for (const [name] of INDEX_DEFINITIONS) {
      await context.client.query(`DROP INDEX IF EXISTS ${name}`);
    }
    await context.client.query("ALTER TABLE schedule_entries DROP COLUMN IF EXISTS queue_status");
    return { removedColumn: "queue_status", jobRowsChanged: 0 };
  },
};
