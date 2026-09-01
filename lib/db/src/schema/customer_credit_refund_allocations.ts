import { pgTable, serial, text, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";

export const customerCreditRefundAllocationsTable = pgTable("customer_credit_refund_allocations", {
  id: serial("id").primaryKey(),
  refundId: integer("refund_id").notNull(),
  sourceKey: text("source_key").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_customer_credit_refund_allocations_refund").on(t.refundId),
  index("idx_customer_credit_refund_allocations_source").on(t.sourceKey),
]);

export type CustomerCreditRefundAllocation = typeof customerCreditRefundAllocationsTable.$inferSelect;