import { pgTable, serial, text, timestamp, integer, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";

export const customerCreditRefundsTable = pgTable("customer_credit_refunds", {
  id: serial("id").primaryKey(),
  refundNumber: text("refund_number").notNull(),
  customerId: integer("customer_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  refundDate: text("refund_date").notNull(),
  method: text("method").notNull(),
  reason: text("reason").notNull(),
  reference: text("reference"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
}, (t) => [
  uniqueIndex("uq_customer_credit_refunds_number").on(t.refundNumber),
  index("idx_customer_credit_refunds_customer").on(t.customerId),
  index("idx_customer_credit_refunds_date").on(t.refundDate),
]);

export type CustomerCreditRefund = typeof customerCreditRefundsTable.$inferSelect;