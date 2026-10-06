import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { calendarEventsTable, calendarPreferencesTable, db } from "@workspace/db";
import { isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { assignedJobCondition } from "../lib/field-tech-scope.ts";
import { describeDayMove, planDayMove, type MovableJob } from "../lib/move-day.ts";
import { blockDecision, validateBlock } from "../lib/calendar-blocks.ts";
import { blocksOnDate } from "../lib/calendar-blocks-store.ts";
import { isDateOnly } from "../lib/date.ts";
import {
  DEFAULT_CALENDAR_PREFERENCES,
  fromStoredRow,
  mergeCalendarPreferences,
  toStoredRow,
} from "../lib/calendar-preferences.ts";
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

/** A block as the calendar reads it. */
const BLOCK_FIELDS = {
  id: calendarEventsTable.id,
  title: calendarEventsTable.title,
  description: calendarEventsTable.description,
  startDate: calendarEventsTable.startDate,
  endDate: calendarEventsTable.endDate,
  startTime: calendarEventsTable.startTime,
  endTime: calendarEventsTable.endTime,
  isAllDay: calendarEventsTable.isAllDay,
  scopeType: calendarEventsTable.scopeType,
  crewId: calendarEventsTable.crewId,
  userId: calendarEventsTable.userId,
  blockMode: calendarEventsTable.blockMode,
  reason: calendarEventsTable.reason,
  isActive: calendarEventsTable.isActive,
};

/**
 * GET /calendar/blocks?start=&end= — the days work should not be booked on.
 *
 * Spec V1 #12 and §11.4: a block is not a fake job, so it never reaches the
 * job counts or the scheduled value. Bounded by the same window as the rest
 * of the calendar.
 */
router.get("/calendar/blocks", async (req, res): Promise<void> => {
  const parsed = boundedRange(req);
  if (!parsed.ok) { res.status(400).json({ error: parsed.message }); return; }
  const { start, end } = parsed.range;
  try {
    const rows = await db.select(BLOCK_FIELDS).from(calendarEventsTable).where(and(
      eq(calendarEventsTable.eventType, "scheduling_block"),
      eq(calendarEventsTable.isActive, true),
      // A block overlaps the window when it starts before the window ends and
      // ends after it starts; a one-day block has no end date of its own.
      sql`${calendarEventsTable.startDate} <= ${end}`,
      sql`COALESCE(${calendarEventsTable.endDate}, ${calendarEventsTable.startDate}) >= ${start}`,
    )).orderBy(calendarEventsTable.startDate, calendarEventsTable.id);
    res.json({ range: { start, end }, blocks: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load the scheduling blocks" });
  }
});

/** POST /calendar/blocks — mark a day, or part of one, as not bookable. */
router.post("/calendar/blocks", async (req, res): Promise<void> => {
  const validated = validateBlock((req.body ?? {}) as Record<string, unknown>);
  if (!validated.ok) { res.status(400).json({ error: validated.error }); return; }
  try {
    const [created] = await db.insert(calendarEventsTable).values({
      eventType: "scheduling_block",
      ...validated.values,
      createdBy: actorName(req),
    }).returning(BLOCK_FIELDS);
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save the block" });
  }
});

/**
 * DELETE /calendar/blocks/:id — lift a block.
 *
 * Switched off rather than erased: a day that was blocked in March is part
 * of why the schedule looked as it did.
 */
router.delete("/calendar/blocks/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Block id must be a positive integer" });
    return;
  }
  try {
    const [lifted] = await db.update(calendarEventsTable)
      .set({ isActive: false, updatedBy: actorName(req), updatedAt: new Date() })
      .where(and(
        eq(calendarEventsTable.id, id),
        eq(calendarEventsTable.eventType, "scheduling_block"),
      ))
      .returning(BLOCK_FIELDS);
    if (!lifted) { res.status(404).json({ error: "That block does not exist" }); return; }
    res.json(lifted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to lift the block" });
  }
});

/**
 * POST /calendar/move-day — move a whole day's work to another day.
 *
 * Spec V1 #11 and the third prototype test. Rain moves a day; nobody should
 * reschedule twenty-five jobs one at a time.
 *
 * `preview: true` answers what it would do and changes nothing. The planner is
 * the same either way, so the confirmation screen and the move cannot disagree.
 *
 * **Nothing is sent to any customer.** Phase 11's rule is that nothing leaves
 * without somebody answering a prompt, and a prompt asked twenty-five times is
 * not an answer. The reply says how many customers have work on the day so the
 * office can decide in one go.
 */
router.post("/calendar/move-day", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { from?: unknown; to?: unknown; preview?: unknown };
  const from = typeof body.from === "string" ? body.from.trim() : "";

  try {
    // Only what the planner needs, and only the statuses the calendar paints.
    const rows = await db.execute(sql`
      SELECT
        jobs.id,
        jobs.customer_id AS "customerId",
        jobs.status,
        jobs.crew_id AS "crewId",
        jobs.assigned_technician_user_id AS "userId",
        jobs.scheduled_start_time AS "startTime",
        jobs.scheduled_end_time AS "endTime",
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''),
          NULLIF(TRIM(cu.company_name), ''),
          'Customer #' || jobs.customer_id
        ) AS "label",
        EXISTS (SELECT 1 FROM invoice_jobs ij WHERE ij.job_id = jobs.id) AS "hasInvoice"
      FROM jobs
      LEFT JOIN customers cu ON cu.id = jobs.customer_id
      WHERE jobs.scheduled_date = ${from}
        AND jobs.status = ANY(${sql.raw(`ARRAY[${CALENDAR_STATUSES.map((status) => `'${status}'`).join(",")}]`)})
        AND ${visibilityCondition(req.user?.role, req.user?.id)}
      ORDER BY jobs.scheduled_start_time NULLS FIRST, jobs.id
    `);

    // Spec #34: the day being moved **to** gets the same say as a single drag.
    // A hard block there leaves the job where it is, named with the reason,
    // rather than being overridden twenty-five times in one click. A soft block
    // is a warning, and the screen asking for the move is where it belongs.
    const to = typeof body.to === "string" ? body.to.trim() : "";
    const blocks = isDateOnly(to) ? await blocksOnDate(db, to) : [];
    const planned = planDayMove({
      from: body.from,
      to: body.to,
      jobs: (rows.rows as unknown[]).map((row) => {
        const job = row as MovableJob & {
          crewId: number | null; userId: string | null;
          startTime: string | null; endTime: string | null;
        };
        if (blocks.length === 0) return job;
        const decision = blockDecision({
          date: to,
          crewId: job.crewId,
          userId: job.userId,
          startTime: job.startTime,
          endTime: job.endTime,
        }, blocks);
        return decision.kind === "refused" ? { ...job, blockedBy: decision.message } : job;
      }),
    });
    if (!planned.ok) { res.status(planned.status).json({ error: planned.error }); return; }
    const { plan } = planned;

    if (body.preview === true) {
      res.json({ ...plan, summary: describeDayMove(plan), applied: false });
      return;
    }

    if (plan.moving.length > 0) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE jobs SET scheduled_date = ${plan.to}, updated_at = now()
           WHERE id = ANY(${sql.raw(`ARRAY[${plan.moving.join(",")}]`)})
        `);
        // One audit row per job: a day move is still a move of each job, and
        // the history is where somebody looks when a customer asks why.
        for (const id of plan.moving) {
          await tx.execute(sql`
            INSERT INTO activity_logs (entity_type, entity_id, action, from_value, to_value, note, performed_by)
            VALUES ('job', ${id}, 'job_rescheduled', ${plan.from}, ${plan.to},
                    ${`Moved with the whole day from ${plan.from} to ${plan.to}`},
                    ${req.user ? [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim() || req.user.email : null})
          `);
        }
      });
    }

    res.json({ ...plan, summary: describeDayMove(plan), applied: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to move the day" });
  }
});

/**
 * GET /calendar/preferences — what this person left the calendar looking like.
 *
 * Spec §11.6. Per user, so it needs no capability beyond being signed in: a
 * field technician is as entitled to remember their own filters as anyone.
 * Somebody who has never changed anything gets the defaults, and no row is
 * written until they do.
 */
router.get("/calendar/preferences", async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [row] = await db.select().from(calendarPreferencesTable)
      .where(eq(calendarPreferencesTable.userId, String(req.user.id))).limit(1);
    res.json(fromStoredRow(row as Record<string, unknown> | undefined));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load calendar preferences" });
  }
});

/**
 * PUT /calendar/preferences — change some of them.
 *
 * A partial patch: only the settings named move, so a screen that knows about
 * one setting cannot reset the seventeen it has never heard of.
 */
router.put("/calendar/preferences", async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = String(req.user.id);
  const patch = (req.body ?? {}) as Record<string, unknown>;
  try {
    const [existing] = await db.select().from(calendarPreferencesTable)
      .where(eq(calendarPreferencesTable.userId, userId)).limit(1);
    const current = existing
      ? fromStoredRow(existing as Record<string, unknown>)
      : { ...DEFAULT_CALENDAR_PREFERENCES };
    const merged = mergeCalendarPreferences(current, patch);
    if (!merged.ok) { res.status(400).json({ error: merged.error }); return; }

    const { columns, listSettings } = toStoredRow(merged.values);
    await db.insert(calendarPreferencesTable)
      .values({ userId, ...columns, listSettings })
      .onConflictDoUpdate({
        target: calendarPreferencesTable.userId,
        set: { ...columns, listSettings, updatedAt: new Date() },
      });
    res.json(merged.values);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save calendar preferences" });
  }
});

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

/** Who did it, for the record a block and a day move both keep. */
function actorName(req: { user?: { firstName?: string | null; lastName?: string | null; email?: string | null } }): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || null;
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
