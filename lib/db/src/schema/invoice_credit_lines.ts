import { pgTable, serial, integer, text, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoiceCreditLinesTable = pgTable("invoice_credit_lines", {
  id: serial("id").primaryKey(),
  creditNoteId: integer("credit_note_id").notNull(),
  invoiceLineId: integer("invoice_line_id"),
  jobId: integer("job_id"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  creditAmount: numeric("credit_amount", { precision: 10, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_invoice_credit_lines_credit_note_id").on(t.creditNoteId),
  index("idx_invoice_credit_lines_invoice_line_id").on(t.invoiceLineId),
]);

export const insertInvoiceCreditLineSchema = createInsertSchema(invoiceCreditLinesTable).omit({ id: true, createdAt: true });
export type InsertInvoiceCreditLine = z.infer<typeof insertInvoiceCreditLineSchema>;
export type InvoiceCreditLine = typeof invoiceCreditLinesTable.$inferSelect;