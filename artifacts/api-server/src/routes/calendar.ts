import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { assignedJobCondition } from "../lib/field-tech-scope.ts";
import {
  MAX_CALENDAR_OCCURRENCES,
  parseCalendarRange,
  type CalendarRange,
} from "../lib/calendar-range.ts";

/**
 * Calendar reads.
 *
 * These endpoints exist alongside `/jobs` rather than reusing it because the
 * calendar has a different cost profile from a job list. `/jobs?start=&end=`
 * returns whole job rows and then hydrates each one with a whole customer row
 * and a whole property row; that is the right shape for a detail screen and
 * the wrong shape for a grid that paints six weeks at once.
 *
 * Two rules hold here:
 *
 *  1. Never read a row the view will not paint. The occurrences endpoint
 *     projects only the fields a calendar card renders, and refuses an
 *     unbounded window.
 *  2. Never load rows to count them. Totals are aggregated in SQL and come
 *     back one row per day, so a month total costs the same whether the month
 *     holds ten jobs or ten thousand.
 */

const router: IRouter = Router();

/** Cards render a status word; canceled work is excluded from the grid entirely. */
const CALENDAR_STATUSES = ["scheduled", "in_progress", "completed"] as const;

/**
 * Jobs the calendar is allowed to show this caller.
 *
 * Field techs see only their own assigned work — the same predicate the jobs
 * routes use, so the calendar cannot become a way around assignment scoping.
 */
function visibilityCondition(role: string | null | undefined, userId: string | undefined) {
  if (!isAssignmentScopedOperationalRole(role) || !userId) return sql`TRUE`;
  return assignedJobCondition(userId);
}

function boundedRange(req: { query: Record<string, unknown> }) {
  return parseCalendarRange(req.query.start, req.query.end);
}

/**
 * GET /calendar/occurrences?start=&end=
 *
 * One lean row per scheduled job in the window — exactly the fields a card
 * paints, nothing else. No `SELECT *`, no line-item JSON, no import-tracking
 * columns, no full customer record.
 */
router.get("/calendar/occurrences", async (req, res): Promise<void> => {
  const parsed = boundedRange(req);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.message });
    return;
  }
  const { start, end }: CalendarRange = parsed.range;

  try {
    const visible = visibilityCondition(req.user?.role, req.user?.id);
    const showAmounts = !isAssignmentScopedOperationalRole(req.user?.role);

    // One row cap + 1, so we can tell "exactly full" from "truncated".
    const rows = await db.execute(sql`
      SELECT
        jobs.id,
        jobs.job_number                                        AS "jobNumber",
        jobs.status,
        jobs.scheduled_date                                    AS "scheduledDate",
        jobs.scheduled_start_time                              AS "startTime",
        jobs.scheduled_end_time                                AS "endTime",
        jobs.service_type                                      AS "serviceType",
        jobs.is_recurring                                      AS "isRecurring",
        jobs.crew_id                                           AS "crewId",
        c.name                                              AS "crewName",
        -- Mirrors customerDisplayName(): person name wins, then company, then
        -- the id fallback. TRIM/NULLIF matter here — a business-only record has
        -- empty name columns, and a naive concat yields a truthy single space
        -- that renders as a blank label on the card.
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''),
          NULLIF(TRIM(cu.company_name), ''),
          'Customer #' || jobs.customer_id
        )                                                   AS "customerLabel",
        cu.client_type                                      AS "clientType",
        COALESCE(NULLIF(TRIM(p.name), ''), NULLIF(TRIM(p.address), '')) AS "propertyLabel",
        ${showAmounts ? sql`ROUND(jobs.total_amount * 100)::bigint` : sql`NULL::bigint`} AS "amountCents",
        inv.status                                          AS "invoiceStatus"
      FROM jobs
      LEFT JOIN customers  cu ON cu.id = jobs.customer_id
      LEFT JOIN properties p  ON p.id  = jobs.property_id
      LEFT JOIN crews      c  ON c.id  = jobs.crew_id
      LEFT JOIN LATERAL (
        SELECT i.status
        FROM invoice_jobs ij
        JOIN invoices i ON i.id = ij.invoice_id
        WHERE ij.job_id = jobs.id
        ORDER BY i.id DESC
        LIMIT 1
      ) inv ON TRUE
      WHERE jobs.scheduled_date BETWEEN ${start} AND ${end}
        AND jobs.status = ANY(${sql.raw(`ARRAY[${CALENDAR_STATUSES.map((s) => `'${s}'`).join(",")}]`)})
        AND ${visible}
      ORDER BY jobs.scheduled_date, jobs.scheduled_start_time NULLS FIRST, jobs.id
      LIMIT ${MAX_CALENDAR_OCCURRENCES + 1}
    `);

    const all = rows.rows as Record<string, unknown>[];
    const truncated = all.length > MAX_CALENDAR_OCCURRENCES;
    const occurrences = truncated ? all.slice(0, MAX_CALENDAR_OCCURRENCES) : all;

    res.json({
      range: { start, end },
      occurrences: occurrences.map((row) => ({
        ...row,
        amountCents: row.amountCents === null ? null : Number(row.amountCents),
      })),
      truncated,
      limit: MAX_CALENDAR_OCCURRENCES,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load calendar occurrences" });
  }
});

/**
 * GET /calendar/totals?start=&end=
 *
 * Day totals for the footer of each date cell, aggregated in the database.
 *
 * This is deliberately a separate call from occurrences. The grid needs
 * totals for every day it paints, and deriving them by summing the rows the
 * client already holds would break the moment occurrences is truncated, or
 * the moment a day total has to include work the grid does not render.
 *
 * Money is returned as integer cents; duration as whole minutes. Both are
 * summed by Postgres in exact arithmetic, never in floating point.
 */
router.get("/calendar/totals", async (req, res): Promise<void> => {
  const parsed = boundedRange(req);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.message });
    return;
  }
  const { start, end }: CalendarRange = parsed.range;

  try {
    const visible = visibilityCondition(req.user?.role, req.user?.id);
    const showAmounts = !isAssignmentScopedOperationalRole(req.user?.role);

    const rows = await db.execute(sql`
      SELECT
        jobs.scheduled_date                                    AS "date",
        COUNT(*)::int                                       AS "jobCount",
        COUNT(*) FILTER (WHERE jobs.status = 'completed')::int  AS "completedCount",
        ${showAmounts
          ? sql`COALESCE(ROUND(SUM(jobs.total_amount) * 100), 0)::bigint`
          : sql`NULL::bigint`}                              AS "scheduledValueCents",
        COALESCE(SUM(jobs.estimated_duration), 0)::int         AS "durationMinutes"
      FROM jobs
      WHERE jobs.scheduled_date BETWEEN ${start} AND ${end}
        AND jobs.status = ANY(${sql.raw(`ARRAY[${CALENDAR_STATUSES.map((s) => `'${s}'`).join(",")}]`)})
        AND ${visible}
      GROUP BY jobs.scheduled_date
      ORDER BY jobs.scheduled_date
    `);

    const days = (rows.rows as Record<string, unknown>[]).map((row) => ({
      date: row.date as string,
      jobCount: Number(row.jobCount),
      completedCount: Number(row.completedCount),
      scheduledValueCents:
        row.scheduledValueCents === null ? null : Number(row.scheduledValueCents),
      durationMinutes: Number(row.durationMinutes),
    }));

    // Period roll-up, derived from the day rows so the two can never disagree.
    const period = days.reduce(
      (acc, day) => ({
        jobCount: acc.jobCount + day.jobCount,
        completedCount: acc.completedCount + day.completedCount,
        scheduledValueCents:
          day.scheduledValueCents === null
            ? acc.scheduledValueCents
            : (acc.scheduledValueCents ?? 0) + day.scheduledValueCents,
        durationMinutes: acc.durationMinutes + day.durationMinutes,
      }),
      {
        jobCount: 0,
        completedCount: 0,
        scheduledValueCents: showAmounts ? 0 : null as number | null,
        durationMinutes: 0,
      },
    );

    res.json({ range: { start, end }, days, period });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load calendar totals" });
  }
});

export default router;
