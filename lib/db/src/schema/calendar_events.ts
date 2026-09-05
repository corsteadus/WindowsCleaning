import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { crewsTable } from "./crews.ts";
import { usersTable } from "./auth.ts";

/**
 * Everything on the calendar that is not a job.
 *
 * Estimate visits, prospect appointments, tasks, personal appointments,
 * scheduling blocks, holidays and employee birthdays all live here. Spec 11.4
 * is explicit that these must not be stored as fake jobs — if they were, they
 * would be counted as work in the daily job counts that 7.10 says to keep them
 * out of.
 *
 * Scheduling blocks are the reason `scope_type` and `block_mode` exist. A block
 * can cover the whole company, one crew or one person, and a hard block refuses
 * a drop while a soft block only warns (spec 7.15).
 */
export const calendarEventsTable = pgTable("calendar_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  isAllDay: boolean("is_all_day").notNull().default(false),
  /** Links back to the quote, lead, task or user this event belongs to. */
  relatedType: text("related_type"),
  relatedId: integer("related_id"),
  scopeType: text("scope_type").notNull().default("company"),
  crewId: integer("crew_id"),
  userId: varchar("user_id"),
  /** Scheduling blocks only: hard blocks reject drops, soft blocks warn. */
  blockMode: text("block_mode"),
  reason: text("reason"),
  color: text("color"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("calendar_events_date_idx").on(table.startDate),
  index("calendar_events_type_date_idx").on(table.eventType, table.startDate),
  index("calendar_events_crew_idx").on(table.crewId),
  index("calendar_events_user_idx").on(table.userId),
  index("calendar_events_related_idx").on(table.relatedType, table.relatedId),
  check(
    "calendar_events_type_check",
    sql`${table.eventType} IN ('estimate_appointment', 'prospect_appointment', 'task', 'personal_appointment', 'scheduling_block', 'holiday', 'employee_birthday')`,
  ),
  check(
    "calendar_events_scope_check",
    sql`${table.scopeType} IN ('company', 'crew', 'employee')`,
  ),
  check(
    "calendar_events_block_mode_check",
    sql`${table.blockMode} IS NULL OR ${table.blockMode} IN ('hard', 'soft')`,
  ),
  // Only a scheduling block may declare a block mode, and it must declare one.
  check(
    "calendar_events_block_mode_scope_check",
    sql`(${table.eventType} = 'scheduling_block' AND ${table.blockMode} IS NOT NULL)
      OR (${table.eventType} <> 'scheduling_block' AND ${table.blockMode} IS NULL)`,
  ),
  // A scoped event has to name what it is scoped to.
  check(
    "calendar_events_scope_target_check",
    sql`(${table.scopeType} = 'company' AND ${table.crewId} IS NULL AND ${table.userId} IS NULL)
      OR (${table.scopeType} = 'crew' AND ${table.crewId} IS NOT NULL)
      OR (${table.scopeType} = 'employee' AND ${table.userId} IS NOT NULL)`,
  ),
  check(
    "calendar_events_date_format_check",
    sql`${table.startDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND (${table.endDate} IS NULL OR ${table.endDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')`,
  ),
  // Seconds optional, matching the rest of the platform's time handling.
  check(
    "calendar_events_time_format_check",
    sql`(${table.startTime} IS NULL OR ${table.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
      AND (${table.endTime} IS NULL OR ${table.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')`,
  ),
  check(
    "calendar_events_range_check",
    sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
  ),
  foreignKey({
    name: "calendar_events_crew_id_crews_id_restrict_fk",
    columns: [table.crewId],
    foreignColumns: [crewsTable.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "calendar_events_user_id_users_id_restrict_fk",
    columns: [table.userId],
    foreignColumns: [usersTable.id],
  }).onDelete("restrict"),
]);

export const insertCalendarEventSchema = createInsertSchema(calendarEventsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEventsTable.$inferSelect;
