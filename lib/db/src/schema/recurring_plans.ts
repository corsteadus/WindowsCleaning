import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recurringPlansTable = pgTable("recurring_plans", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  propertyId: integer("property_id"),
  crewId: integer("crew_id"),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  frequencyType: text("frequency_type").notNull().default("quarterly"),
  intervalValue: integer("interval_value").notNull().default(1),
  preferredDayOfWeek: text("preferred_day_of_week"),
  preferredTimeWindow: text("preferred_time_window"),
  seasonalStartMonth: integer("seasonal_start_month"),
  seasonalEndMonth: integer("seasonal_end_month"),
  nextRunDate: text("next_run_date"),
  lastGeneratedDate: text("last_generated_date"),
  defaultServiceNotes: text("default_service_notes"),
  defaultDurationMinutes: integer("default_duration_minutes"),
  serviceType: text("service_type"),
  estimatedAmount: text("estimated_amount"),
  autoGenerateJobs: boolean("auto_generate_jobs").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_recurring_plans_customer_id").on(t.customerId),
  index("idx_recurring_plans_status").on(t.status),
  index("idx_recurring_plans_next_run_date").on(t.nextRunDate),
]);

export const insertRecurringPlanSchema = createInsertSchema(recurringPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecurringPlan = z.infer<typeof insertRecurringPlanSchema>;
export type RecurringPlan = typeof recurringPlansTable.$inferSelect;
