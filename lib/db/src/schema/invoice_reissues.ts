import { pgTable, serial, integer, text, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoiceReissuesTable = pgTable("invoice_reissues", {
  id: serial("id").primaryKey(),
  sourceInvoiceId: integer("source_invoice_id").notNull(),
  replacementInvoiceId: integer("replacement_invoice_id").notNull(),
  reason: text("reason").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
}, (t) => [
  uniqueIndex("uq_invoice_reissues_source_active").on(t.sourceInvoiceId, t.isActive),
  uniqueIndex("uq_invoice_reissues_replacement").on(t.replacementInvoiceId),
  index("idx_invoice_reissues_source_invoice_id").on(t.sourceInvoiceId),
]);

export const insertInvoiceReissueSchema = createInsertSchema(invoiceReissuesTable).omit({ id: true, createdAt: true });
export type InsertInvoiceReissue = z.infer<typeof insertInvoiceReissueSchema>;
export type InvoiceReissue = typeof invoiceReissuesTable.$inferSelect;