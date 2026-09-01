import { pgTable, text, serial, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentAllocationsTable = pgTable("payment_allocations", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
}, (t) => [
  index("idx_payment_allocations_payment_id").on(t.paymentId),
  index("idx_payment_allocations_invoice_id").on(t.invoiceId),
]);

export const insertPaymentAllocationSchema = createInsertSchema(paymentAllocationsTable).omit({ id: true, createdAt: true });
export type InsertPaymentAllocation = z.infer<typeof insertPaymentAllocationSchema>;
export type PaymentAllocation = typeof paymentAllocationsTable.$inferSelect;