import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs.ts";

/**
 * When a job is worked, one row per day.
 *
 * A job used to hold its schedule inline, which meant a job could occupy
 * exactly one date. Multi-day work, on-hold work and the scheduling queue all
 * need more than that, so the schedule moved here and `jobs.scheduled_date`
 * stays behind as a backwards-compatible mirror of the primary entry — the
 * same arrangement `crew_members` has with the legacy text on `crews`.
 *
 * Money is anchored, not spread. The client's rule is that a job's whole value
 * lands on the day it starts, so `allocated_value_cents` carries the full
 * amount on the primary entry and zero on every later segment. Monthly
 * reporting follows the same anchor: a job beginning in August and finishing in
 * September belongs to August. Duration is deliberately not anchored — hours
 * stay on the day they are worked, or crew capacity would lie.
 *
 * Storing the allocation per entry rather than deriving it keeps the switch to
 * duration-split a small change if the V1.1 allocation setting arrives.
 */
export const scheduleEntriesTable = pgTable("schedule_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  jobId: integer("job_id").notNull(),
  /** 1-based position within a multi-day job. */
  segmentNumber: integer("segment_number").notNull().default(1),
  /** The anchor day. Carries the job's value and its reporting month. */
  isPrimary: boolean("is_primary").notNull().default(true),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  /** Only set when a single entry deliberately spans days. */
  endDate: text("end_date"),
  isAllDay: boolean("is_all_day").notNull().default(false),
  noSpecificTime: boolean("no_specific_time").notNull().default(false),
  durationMinutes: integer("duration_minutes"),
  /** queued = in the scheduling queue with no date yet. */
  status: text("status").notNull().default("scheduled"),
  /**
   * What queued or held work is waiting on — spec §4.3's plain-language
   * replacements for the reference system's abbreviations.
   *
   * Deliberately separate from `status`: that says where the work sits, this
   * says why it is still sitting there. Null once work is on the calendar.
   */
  queueStatus: text("queue_status"),
  /**
   * Whole cents, never a fraction. Held as numeric(18,0) rather than a 4-byte
   * integer because `jobs.total_amount` is numeric(10,2) and so reaches
   * 9,999,999,999 cents — five times what an int4 can hold. Matches the
   * `financial_approval_policies.threshold_cents` convention.
   */
  allocatedValueCents: numeric("allocated_value_cents", { precision: 18, scale: 0 })
    .notNull().default("0"),
  recurringPlanId: integer("recurring_plan_id"),
  /** Identifies which occurrence of a plan this is, so exceptions can be recorded later. */
  occurrenceKey: text("occurrence_key"),
  rescheduledCount: integer("rescheduled_count").notNull().default(0),
  originalScheduledDate: text("original_scheduled_date"),
  onHoldReason: text("on_hold_reason"),
  callbackDate: text("callback_date"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("schedule_entries_job_segment_unique").on(table.jobId, table.segmentNumber),
  uniqueIndex("schedule_entries_one_primary_unique").on(table.jobId).where(sql`${table.isPrimary}`),
  index("schedule_entries_date_idx").on(table.scheduledDate),
  index("schedule_entries_status_date_idx").on(table.status, table.scheduledDate),
  // The queue is read by state and walked oldest-first, so keyset pagination
  // orders on (created_at, id). Indexing all three keeps a page a range scan
  // rather than a sort over every queued row.
  index("schedule_entries_queue_idx").on(table.status, table.createdAt, table.id),
  index("schedule_entries_job_idx").on(table.jobId),
  index("schedule_entries_recurring_plan_idx").on(table.recurringPlanId),
  check(
    "schedule_entries_status_check",
    sql`${table.status} IN ('queued', 'scheduled', 'on_hold', 'canceled')`,
  ),
  check(
    "schedule_entries_queue_status_check",
    sql`${table.queueStatus} IS NULL OR ${table.queueStatus} IN ('needs_contact', 'contacted', 'callback_scheduled', 'waiting_on_customer', 'waiting_on_materials', 'weather_hold', 'ready_to_schedule')`,
  ),
  // Only work off the calendar is waiting on something.
  check(
    "schedule_entries_queue_status_scope_check",
    sql`${table.queueStatus} IS NULL OR ${table.status} IN ('queued', 'on_hold')`,
  ),
  check("schedule_entries_segment_check", sql`${table.segmentNumber} >= 1`),
  check("schedule_entries_value_check", sql`${table.allocatedValueCents} >= 0`),
  check("schedule_entries_rescheduled_count_check", sql`${table.rescheduledCount} >= 0`),
  check("schedule_entries_duration_check", sql`${table.durationMinutes} IS NULL OR ${table.durationMinutes} >= 0`),
  check(
    "schedule_entries_date_format_check",
    sql`(${table.scheduledDate} IS NULL OR ${table.scheduledDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      AND (${table.endDate} IS NULL OR ${table.endDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      AND (${table.originalScheduledDate} IS NULL OR ${table.originalScheduledDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      AND (${table.callbackDate} IS NULL OR ${table.callbackDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')`,
  ),
  // Seconds are optional: the API has always accepted HH:mm and HH:mm:ss
  // alike, so existing job rows carry both shapes.
  check(
    "schedule_entries_time_format_check",
    sql`(${table.scheduledStartTime} IS NULL OR ${table.scheduledStartTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
      AND (${table.scheduledEndTime} IS NULL OR ${table.scheduledEndTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')`,
  ),
  // A scheduled entry is on the calendar, so it must say when.
  check(
    "schedule_entries_scheduled_needs_date_check",
    sql`${table.status} <> 'scheduled' OR ${table.scheduledDate} IS NOT NULL`,
  ),
  // Spec 4.6: putting work on hold always requires a reason.
  check(
    "schedule_entries_hold_needs_reason_check",
    sql`${table.status} <> 'on_hold' OR ${table.onHoldReason} IS NOT NULL`,
  ),
  // Only the anchor day carries money.
  check(
    "schedule_entries_value_on_primary_check",
    sql`${table.isPrimary} OR ${table.allocatedValueCents} = 0`,
  ),
  foreignKey({
    name: "schedule_entries_job_id_jobs_id_cascade_fk",
    columns: [table.jobId],
    foreignColumns: [jobsTable.id],
  }).onDelete("cascade"),
]);

export const insertScheduleEntrySchema = createInsertSchema(scheduleEntriesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertScheduleEntry = z.infer<typeof insertScheduleEntrySchema>;
export type ScheduleEntry = typeof scheduleEntriesTable.$inferSelect;
