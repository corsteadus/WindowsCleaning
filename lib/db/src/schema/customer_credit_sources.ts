import { pgTable, serial, text, timestamp, integer, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";

export const customerCreditSourcesTable = pgTable("customer_credit_sources", {
  id: serial("id").primaryKey(),
  sourceKey: text("source_key").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  customerId: integer("customer_id").notNull(),
  originalAmount: numeric("original_amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_customer_credit_sources_key").on(t.sourceKey),
  index("idx_customer_credit_sources_customer").on(t.customerId),
  index("idx_customer_credit_sources_type_id").on(t.sourceType, t.sourceId),
]);

export type CustomerCreditSource = typeof customerCreditSourcesTable.$inferSelect;