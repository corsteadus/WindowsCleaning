import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importChangeLogTable = pgTable("import_change_log", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  operation: text("operation").notNull(),
  // insert | update | hide
  entityType: text("entity_type").notNull(),
  // customer | lead | job | invoice | property
  entityId: integer("entity_id").notNull(),
  beforeJson: text("before_json"),
  // null for inserts
  afterJson: text("after_json").notNull(),
  rolledBack: boolean("rolled_back").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_import_change_log_batch_id").on(t.batchId),
  index("idx_import_change_log_entity").on(t.entityType, t.entityId),
  index("idx_import_change_log_rolled_back").on(t.rolledBack),
]);

export const insertImportChangeLogSchema = createInsertSchema(importChangeLogTable).omit({ id: true, createdAt: true });
export type InsertImportChangeLog = z.infer<typeof insertImportChangeLogSchema>;
export type ImportChangeLog = typeof importChangeLogTable.$inferSelect;
