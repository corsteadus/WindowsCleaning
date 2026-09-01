import { pgTable, text, serial, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importReviewQueueTable = pgTable("import_review_queue", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  stagingRowId: integer("staging_row_id").notNull(),
  entityType: text("entity_type").notNull(),
  // customer | lead | job | invoice | property
  issueType: text("issue_type").notNull(),
  // new_record | field_conflict | duplicate_job | ambiguous_match | phone_overflow | status_downgrade
  currentData: text("current_data"),
  // JSON of existing live record (null for new_record)
  proposedData: text("proposed_data").notNull(),
  // JSON of what the import wants to write
  conflictFields: text("conflict_fields"),
  // JSON array of field names that differ
  action: text("action").notNull().default("pending"),
  // pending | keep_existing | accept_import | ignore
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_import_review_batch_id").on(t.batchId),
  index("idx_import_review_action").on(t.action),
  index("idx_import_review_entity_type").on(t.entityType),
  // Prevents staging from inserting duplicate review items for the same row+issue
  uniqueIndex("uq_import_review_row_issue").on(t.stagingRowId, t.issueType),
]);

export const insertImportReviewQueueSchema = createInsertSchema(importReviewQueueTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertImportReviewQueue = z.infer<typeof insertImportReviewQueueSchema>;
export type ImportReviewQueue = typeof importReviewQueueTable.$inferSelect;
