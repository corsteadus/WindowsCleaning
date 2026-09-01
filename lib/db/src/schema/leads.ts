import { pgTable, text, serial, timestamp, numeric, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  source: text("source"),
  status: text("status").notNull().default("new"),
  notes: text("notes"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  estimatedValue: numeric("estimated_value", { precision: 10, scale: 2 }),
  followUpDate: text("follow_up_date"),
  assignedTo: text("assigned_to"),
  lostReason: text("lost_reason"),
  convertedCustomerId: integer("converted_customer_id"),
  clientType: text("client_type").default("residential"),  // "residential" | "commercial"
  // Import tracking
  importSource: text("import_source"),
  importExternalId: text("import_external_id"),
  importBatchId: integer("import_batch_id"),
  isImported: boolean("is_imported").notNull().default(false),
  isImportVerified: boolean("is_import_verified").notNull().default(false),
  lastSeenImportAt: timestamp("last_seen_import_at", { withTimezone: true }),
  mergeReviewStatus: text("merge_review_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_leads_status").on(t.status),
  index("idx_leads_client_type").on(t.clientType),
  index("idx_leads_created_at").on(t.createdAt),
]);

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
