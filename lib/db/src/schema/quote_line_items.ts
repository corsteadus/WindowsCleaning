import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const quoteLineItemsTable = pgTable("quote_line_items", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  serviceId: integer("service_id"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull().default("0"),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull().default("0"),
  // Kyle (2026-10-24): a blank price is "not priced yet" and cannot be sent;
  // $0.00 is a real price. unit_price holds 0 for both, so this says which.
  // Added by migrations/kyle-answers-2026-10-24-v1.ts.
  pricePending: boolean("price_pending").notNull().default(false),
  // Phase 6: taxed when the estimate charges sales tax. From the service; editable per line.
  taxable: boolean("taxable").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertQuoteLineItemSchema = createInsertSchema(quoteLineItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuoteLineItem = z.infer<typeof insertQuoteLineItemSchema>;
export type QuoteLineItem = typeof quoteLineItemsTable.$inferSelect;
