import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importStagingRowsTable = pgTable("import_staging_rows", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  fileId: integer("file_id").notNull(),
  rowIndex: integer("row_index").notNull(),
  entityType: text("entity_type").notNull(),
  // customer | lead | job | invoice | property
  externalId: text("external_id"),
  // The Customer Factor's Id field
  fingerprint: text("fingerprint"),
  // sha256 hash for dedup detection
  rawData: text("raw_data").notNull(),
  // JSON of the raw parsed row
  normalizedData: text("normalized_data"),
  // JSON of the row after normalization
  matchedEntityId: integer("matched_entity_id"),
  // id in live table if auto-matched
  matchMethod: text("match_method"),
  // email | phone | none
  duplicateCandidateIds: text("duplicate_candidate_ids"),
  // JSON array of account ids found by the future-safe contact check.
  duplicateMatchTypes: text("duplicate_match_types"),
  // JSON object of match type -> account ids, without contact values.
  status: text("status").notNull().default("pending"),
  // pending | auto_approved | review | applied | error | ignored
  errorMessage: text("error_message"),
  hasParseError: boolean("has_parse_error").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_import_staging_batch_id").on(t.batchId),
  index("idx_import_staging_entity_type").on(t.entityType),
  index("idx_import_staging_status").on(t.status),
  index("idx_import_staging_fingerprint").on(t.fingerprint),
]);

export const insertImportStagingRowSchema = createInsertSchema(importStagingRowsTable).omit({ id: true, createdAt: true });
export type InsertImportStagingRow = z.infer<typeof insertImportStagingRowSchema>;
export type ImportStagingRow = typeof importStagingRowsTable.$inferSelect;
