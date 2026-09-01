import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importBatchesTable = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sourceSystem: text("source_system"),
  // 0 = legacy batch behavior; 1 = future duplicate-safe customer path.
  safetyVersion: integer("safety_version").notNull().default(0),
  status: text("status").notNull().default("uploading"),
  // uploading | staged | review | applying | applied | rolling_back | rolled_back | error
  createdBy: text("created_by"),
  fileCount: integer("file_count").notNull().default(0),
  totalRows: integer("total_rows").notNull().default(0),
  stagedRows: integer("staged_rows").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  autoApprovedCount: integer("auto_approved_count").notNull().default(0),
  appliedCount: integer("applied_count").notNull().default(0),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_import_batches_status").on(t.status),
  index("idx_import_batches_created_at").on(t.createdAt),
]);

export const insertImportBatchSchema = createInsertSchema(importBatchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type ImportBatch = typeof importBatchesTable.$inferSelect;
