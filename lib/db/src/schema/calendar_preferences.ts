import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth.ts";

/**
 * What each person left the calendar looking like.
 *
 * Spec 11.6 lists eighteen things to remember per user. Thirteen of them are
 * single values and get their own column. The other five are inherently
 * lists — which appointment types are ticked, which assignments are selected,
 * which card fields are shown, which sidebar sections are open, and the sidebar
 * order — so they sit together in `list_settings`. None of them is ever
 * filtered on, only read back whole for the person who owns the row.
 */
export const calendarPreferencesTable = pgTable("calendar_preferences", {
  userId: varchar("user_id").primaryKey(),
  defaultView: text("default_view").notNull().default("month"),
  lastViewedDate: text("last_viewed_date"),
  /** 0 = Sunday, 1 = Monday. Kept independent of Sunday visibility, per spec 7.12. */
  weekStartsOn: integer("week_starts_on").notNull().default(1),
  showSunday: boolean("show_sunday").notNull().default(true),
  /** Grouped puts every assignment in one calendar; separate gives each its own lane. */
  assignmentDisplay: text("assignment_display").notNull().default("grouped"),
  showCompletedJobs: boolean("show_completed_jobs").notNull().default(true),
  showInvoiceStatus: boolean("show_invoice_status").notNull().default(true),
  showHolidays: boolean("show_holidays").notNull().default(true),
  showEmployeeBirthdays: boolean("show_employee_birthdays").notNull().default(false),
  showJobCounts: boolean("show_job_counts").notNull().default(true),
  showScheduledValue: boolean("show_scheduled_value").notNull().default(true),
  showDurationTotals: boolean("show_duration_totals").notNull().default(false),
  /** Which category drives the card's accent strip. */
  colorMode: text("color_mode").notNull().default("assignment"),
  sidebarOpen: boolean("sidebar_open").notNull().default(true),
  /** selectedAppointmentTypes, selectedAssignments, cardFields, expandedSections, sidebarOrder. */
  listSettings: jsonb("list_settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check(
    "calendar_preferences_default_view_check",
    sql`${table.defaultView} IN ('month', 'week', 'day')`,
  ),
  check("calendar_preferences_week_start_check", sql`${table.weekStartsOn} IN (0, 1)`),
  check(
    "calendar_preferences_assignment_display_check",
    sql`${table.assignmentDisplay} IN ('grouped', 'separate')`,
  ),
  check(
    "calendar_preferences_color_mode_check",
    sql`${table.colorMode} IN ('assignment', 'event_type', 'customer_type', 'service_type')`,
  ),
  check(
    "calendar_preferences_last_viewed_date_check",
    sql`${table.lastViewedDate} IS NULL OR ${table.lastViewedDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
  ),
  check(
    "calendar_preferences_list_settings_check",
    sql`jsonb_typeof(${table.listSettings}) = 'object'`,
  ),
  foreignKey({
    name: "calendar_preferences_user_id_users_id_cascade_fk",
    columns: [table.userId],
    foreignColumns: [usersTable.id],
  }).onDelete("cascade"),
]);

export const insertCalendarPreferencesSchema = createInsertSchema(calendarPreferencesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertCalendarPreferences = z.infer<typeof insertCalendarPreferencesSchema>;
export type CalendarPreferences = typeof calendarPreferencesTable.$inferSelect;
