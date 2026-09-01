import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importFilesTable = pgTable("import_files", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  originalName: text("original_name").notNull(),
  fileType: text("file_type").notNull().default("csv"),
  // csv | tsv | sql
  fileGroup: text("file_group").notNull().default("unknown"),
  // active_customers | master_customers | active_prospects | master_prospects | invoices | sql_backup | unknown
  detectedGroup: text("detected_group"),
  rawJsonData: text("raw_json_data"),
  // JSON-encoded rows stored for background staging (cleared after processing)
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  // Set when background worker picks up the file; null until then
  rawRowCount: integer("raw_row_count").notNull().default(0),
  // raw CSV/TSV lines parsed (before any deduplication)
  rowCount: integer("row_count").notNull().default(0),
  // unique entities staged after deduplication (customers/invoices)
  skippedRows: integer("skipped_rows").notNull().default(0),
  // rows collapsed by deduplication (CF repeats a customer once per job)
  errorCount: integer("error_count").notNull().default(0),
  status: text("status").notNull().default("uploaded"),
  // uploaded | parsed | error
  parseErrors: text("parse_errors"),
  // JSON array of {rowIndex, message}
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_import_files_batch_id").on(t.batchId),
]);

export const insertImportFileSchema = createInsertSchema(importFilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertImportFile = z.infer<typeof insertImportFileSchema>;
export type ImportFile = typeof importFilesTable.$inferSelect;
