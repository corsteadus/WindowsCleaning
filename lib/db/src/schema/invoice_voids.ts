import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoiceVoidsTable = pgTable("invoice_voids", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  reason: text("reason").notNull(),
  voidedAt: timestamp("voided_at", { withTimezone: true }).notNull().defaultNow(),
  voidedBy: text("voided_by"),
}, (t) => [
  uniqueIndex("uq_invoice_voids_invoice").on(t.invoiceId),
]);

export const insertInvoiceVoidSchema = createInsertSchema(invoiceVoidsTable).omit({ id: true, voidedAt: true });
export type InsertInvoiceVoid = z.infer<typeof insertInvoiceVoidSchema>;
export type InvoiceVoid = typeof invoiceVoidsTable.$inferSelect;