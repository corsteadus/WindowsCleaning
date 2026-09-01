import { pgTable, text, serial, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Future-only source identity links for imported customer accounts.
 *
 * Legacy customers.import_source/import_external_id values are intentionally
 * not backfilled into this table. The unique source + external record pair is
 * the durable idempotency boundary for new staged imports.
 */
export const customerImportProvenanceTable = pgTable("customer_import_provenance", {
  id: serial("id").primaryKey(),
  sourceSystem: text("source_system").notNull(),
  externalRecordId: text("external_record_id").notNull(),
  customerId: integer("customer_id").notNull(),
  importBatchId: integer("import_batch_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("uq_customer_import_provenance_source_external")
    .on(t.sourceSystem, t.externalRecordId),
  index("idx_customer_import_provenance_customer")
    .on(t.customerId),
]);

export const insertCustomerImportProvenanceSchema = createInsertSchema(customerImportProvenanceTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomerImportProvenance = z.infer<typeof insertCustomerImportProvenanceSchema>;
export type CustomerImportProvenance = typeof customerImportProvenanceTable.$inferSelect;