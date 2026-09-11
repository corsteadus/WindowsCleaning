import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { QueueEntryRow, QueueStatus } from "../lib/schedule-queue-core.ts";
import type { QueueVisibility } from "../lib/schedule-queue-scope.ts";

/**
 * Every `schedule_entries` read and write, and nothing else.
 *
 * No business rules live here — `lib/schedule-queue-core.ts` decides and
 * `services/schedule-queue.ts` orchestrates. This layer only knows how to ask
 * Postgres a question efficiently.
 *
 * Two habits, both borrowed from `routes/calendar.ts`:
 *
 *  1. **Project, never `SELECT *`.** The queue card paints a dozen fields; a
 *     job row has sixty, several of them JSON. Reading the other forty-eight
 *     costs bandwidth on every page for nothing.
 *  2. **Bound every read.** The queue grows without limit in a busy office, so
 *     there is no query here that a thousand unscheduled jobs could turn into
 *     a thousand-row response.
 */

type PageQuery = {
  state: "queued" | "on_hold";
  limit: number;
  cursor: { queuedAt: string; id: number } | null;
  status: QueueStatus | null;
};

/**
 * One page of the queue, walked by keyset.
 *
 * `(e.created_at, e.id) > (:queuedAt, :id)` is a row comparison, not two
 * chained conditions — Postgres matches it against
 * `schedule_entries_queue_idx (status, created_at, id)` as a single range
 * scan, so page 40 costs what page 1 costs. The naive
 * `created_at > x OR (created_at = x AND id > y)` spelling does not.
 */
export async function listQueuePage(
  query: PageQuery,
  visibility: QueueVisibility,
): Promise<QueueEntryRow[]> {
  const after = query.cursor
    ? sql`AND (e.created_at, e.id) > (${query.cursor.queuedAt}::timestamptz, ${query.cursor.id}::int)`
    : sql``;
  const narrowed = query.status ? sql`AND e.queue_status = ${query.status}` : sql``;

  const result = await db.execute(sql`
    SELECT
      e.id                                                AS "entryId",
      e.job_id                                            AS "jobId",
      e.status,
      e.queue_status                                      AS "queueStatus",
      e.on_hold_reason                                    AS "onHoldReason",
      e.callback_date                                     AS "callbackDate",
      e.created_at                                        AS "queuedAt",
      ${visibility.showAmounts
        ? sql`e.allocated_value_cents::bigint`
        : sql`NULL::bigint`}                              AS "valueCents",
      jobs.job_number                                     AS "jobNumber",
      jobs.service_type                                   AS "serviceType",
      jobs.status                                         AS "jobStatus",
      jobs.estimated_duration                             AS "durationMinutes",
      -- Mirrors customerDisplayName(): person, then company, then the id
      -- fallback. TRIM/NULLIF matter — a business-only record has empty name
      -- columns and a naive concat yields a truthy single space.
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''),
        NULLIF(TRIM(cu.company_name), ''),
        'Customer #' || jobs.customer_id
      )                                                   AS "customerLabel",
      cu.client_type                                      AS "clientType",
      COALESCE(NULLIF(TRIM(p.name), ''), NULLIF(TRIM(p.address), '')) AS "propertyLabel"
    FROM schedule_entries e
    JOIN jobs            ON jobs.id = e.job_id
    LEFT JOIN customers  cu ON cu.id = jobs.customer_id
    LEFT JOIN properties p  ON p.id  = jobs.property_id
    WHERE e.status = ${query.state}
      ${narrowed}
      ${after}
      AND ${visibility.jobFilter}
    ORDER BY e.created_at, e.id
    LIMIT ${query.limit + 1}
  `);
  return result.rows as unknown as QueueEntryRow[];
}

/**
 * How many entries sit under each waiting reason, for the filter chips.
 *
 * Counted in the database and returned as one row per reason. Deriving these
 * from the current page would be wrong the moment the queue is longer than a
 * page, which is the only case where the counts matter.
 */
export async function countByQueueStatus(
  state: "queued" | "on_hold",
  visibility: QueueVisibility,
): Promise<{ queueStatus: string | null; count: number }[]> {
  const result = await db.execute(sql`
    SELECT e.queue_status AS "queueStatus", COUNT(*)::int AS "count"
      FROM schedule_entries e
      JOIN jobs ON jobs.id = e.job_id
     WHERE e.status = ${state}
       AND ${visibility.jobFilter}
     GROUP BY e.queue_status
  `);
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    queueStatus: (row.queueStatus as string | null) ?? null,
    count: Number(row.count),
  }));
}

/**
 * The facts a transition decision needs, in one round trip.
 *
 * `decideHold` needs the entry's state, the job's status and whether an
 * invoice exists. Fetching those separately would be three queries and a race
 * between them; this is one, and the service re-reads inside its transaction
 * before writing.
 */
export type EntryFacts = {
  entryId: number;
  jobId: number;
  state: string;
  isPrimary: boolean;
  scheduledDate: string | null;
  jobStatus: string;
  hasInvoice: boolean;
};

export async function findEntryFacts(entryId: number): Promise<EntryFacts | null> {
  const result = await db.execute(sql`
    SELECT
      e.id             AS "entryId",
      e.job_id         AS "jobId",
      e.status         AS "state",
      e.is_primary     AS "isPrimary",
      e.scheduled_date AS "scheduledDate",
      jobs.status      AS "jobStatus",
      EXISTS (SELECT 1 FROM invoice_jobs ij WHERE ij.job_id = e.job_id) AS "hasInvoice"
    FROM schedule_entries e
    JOIN jobs ON jobs.id = e.job_id
    WHERE e.id = ${entryId}
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
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
