import { pgTable, serial, integer, text, timestamp, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoiceCreditNotesTable = pgTable("invoice_credit_notes", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  creditNumber: text("credit_number").notNull(),
  reason: text("reason").notNull(),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  balanceReductionAmount: numeric("balance_reduction_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  customerCreditAmount: numeric("customer_credit_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
}, (t) => [
  index("idx_invoice_credit_notes_invoice_id").on(t.invoiceId),
  uniqueIndex("uq_invoice_credit_notes_number").on(t.creditNumber),
]);

export const insertInvoiceCreditNoteSchema = createInsertSchema(invoiceCreditNotesTable).omit({ id: true, createdAt: true });
export type InsertInvoiceCreditNote = z.infer<typeof insertInvoiceCreditNoteSchema>;
export type InvoiceCreditNote = typeof invoiceCreditNotesTable.$inferSelect;