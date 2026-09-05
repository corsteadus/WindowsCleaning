import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scheduleEntriesTable } from "./schedule_entries.ts";
import { crewsTable } from "./crews.ts";
import { usersTable } from "./auth.ts";

/**
 * Who is doing the work on a given day.
 *
 * A job used to hold one crew and one technician. The spec wants several
 * assignments per scheduled day, each an employee, a crew, or a placeholder
 * queue such as "Pending Pressure-Washing Assignment".
 *
 * The spec describes a single "Assignment ID". This table uses three typed
 * columns instead, with a check that exactly the one matching
 * `assignment_type` is filled. A polymorphic integer would let a crew id point
 * at a user; this way the database refuses it.
 *
 * Value is not divided here. Spec 9.4's V1 rule is that the company counts a
 * job once and the primary assignment carries its value, while secondary
 * assignments consume duration and capacity only. `value_allocation_percent`
 * is reserved for the future percentage split and stays null until then.
 */
export const scheduleAssignmentsTable = pgTable("schedule_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  scheduleEntryId: integer("schedule_entry_id").notNull(),
  assignmentType: text("assignment_type").notNull(),
  crewId: integer("crew_id"),
  userId: varchar("user_id"),
  /** Placeholder bucket when work is not yet assigned to a real crew or person. */
  queueKey: text("queue_key"),
  isPrimary: boolean("is_primary").notNull().default(false),
  valueAllocationPercent: integer("value_allocation_percent"),
  plannedMinutes: integer("planned_minutes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("schedule_assignments_one_primary_unique")
    .on(table.scheduleEntryId).where(sql`${table.isPrimary}`),
  uniqueIndex("schedule_assignments_crew_unique")
    .on(table.scheduleEntryId, table.crewId).where(sql`${table.crewId} IS NOT NULL`),
  uniqueIndex("schedule_assignments_user_unique")
    .on(table.scheduleEntryId, table.userId).where(sql`${table.userId} IS NOT NULL`),
  uniqueIndex("schedule_assignments_queue_unique")
    .on(table.scheduleEntryId, table.queueKey).where(sql`${table.queueKey} IS NOT NULL`),
  index("schedule_assignments_entry_idx").on(table.scheduleEntryId),
  index("schedule_assignments_crew_idx").on(table.crewId),
  index("schedule_assignments_user_idx").on(table.userId),
  check(
    "schedule_assignments_type_check",
    sql`${table.assignmentType} IN ('employee', 'crew', 'queue')`,
  ),
  // Exactly the column matching the declared type is filled, and only that one.
  check(
    "schedule_assignments_target_check",
    sql`(${table.assignmentType} = 'crew' AND ${table.crewId} IS NOT NULL AND ${table.userId} IS NULL AND ${table.queueKey} IS NULL)
      OR (${table.assignmentType} = 'employee' AND ${table.userId} IS NOT NULL AND ${table.crewId} IS NULL AND ${table.queueKey} IS NULL)
      OR (${table.assignmentType} = 'queue' AND ${table.queueKey} IS NOT NULL AND ${table.crewId} IS NULL AND ${table.userId} IS NULL)`,
  ),
  check(
    "schedule_assignments_percent_check",
    sql`${table.valueAllocationPercent} IS NULL OR (${table.valueAllocationPercent} >= 0 AND ${table.valueAllocationPercent} <= 100)`,
  ),
  check(
    "schedule_assignments_planned_minutes_check",
    sql`${table.plannedMinutes} IS NULL OR ${table.plannedMinutes} >= 0`,
  ),
  foreignKey({
    name: "schedule_assignments_entry_id_schedule_entries_id_cascade_fk",
    columns: [table.scheduleEntryId],
    foreignColumns: [scheduleEntriesTable.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "schedule_assignments_crew_id_crews_id_restrict_fk",
    columns: [table.crewId],
    foreignColumns: [crewsTable.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "schedule_assignments_user_id_users_id_restrict_fk",
    columns: [table.userId],
    foreignColumns: [usersTable.id],
  }).onDelete("restrict"),
]);

export const insertScheduleAssignmentSchema = createInsertSchema(scheduleAssignmentsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertScheduleAssignment = z.infer<typeof insertScheduleAssignmentSchema>;
export type ScheduleAssignment = typeof scheduleAssignmentsTable.$inferSelect;
