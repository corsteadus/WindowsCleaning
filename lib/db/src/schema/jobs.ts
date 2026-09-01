import { pgTable, text, serial, timestamp, integer, numeric, boolean, index, varchar, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth.ts";
import { crewsTable } from "./crews.ts";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  propertyId: integer("property_id"),
  quoteId: integer("quote_id"),
  crewId: integer("crew_id"),
  assignedTechnicianUserId: varchar("assigned_technician_user_id"),
  jobNumber: text("job_number").notNull(),
  status: text("status").notNull().default("scheduled"),
  serviceType: text("service_type"),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  estimatedDuration: integer("estimated_duration"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurringFrequency: text("recurring_frequency"),
  recurringPlanId: integer("recurring_plan_id"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  techNotes: text("tech_notes"),
  lineItems: text("line_items"),
  completedAt: text("completed_at"),
  // Import tracking
  importSource: text("import_source"),
  importExternalId: text("import_external_id"),
  importBatchId: integer("import_batch_id"),
  isImported: boolean("is_imported").notNull().default(false),
  isHidden: boolean("is_hidden").notNull().default(false),
  isIgnored: boolean("is_ignored").notNull().default(false),
  isSuspectedDuplicate: boolean("is_suspected_duplicate").notNull().default(false),
  duplicateReviewStatus: text("duplicate_review_status"),
  lastImportFingerprint: text("last_import_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_jobs_customer_id").on(t.customerId),
  index("idx_jobs_status").on(t.status),
  index("idx_jobs_scheduled_date").on(t.scheduledDate),
  index("idx_jobs_crew_id").on(t.crewId),
  index("idx_jobs_assigned_technician_user_id").on(t.assignedTechnicianUserId),
  index("idx_jobs_status_date").on(t.status, t.scheduledDate),
  index("idx_jobs_recurring_plan_id").on(t.recurringPlanId),
  index("idx_jobs_created_at").on(t.createdAt),
  foreignKey({
    name: "jobs_crew_id_crews_id_restrict_fk",
    columns: [t.crewId],
    foreignColumns: [crewsTable.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "jobs_assigned_technician_user_id_users_id_restrict_fk",
    columns: [t.assignedTechnicianUserId],
    foreignColumns: [usersTable.id],
  }).onDelete("restrict"),
]);

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
