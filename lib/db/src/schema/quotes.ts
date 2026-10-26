import { pgTable, text, serial, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const quotesTable = pgTable("quotes", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id"),
  leadId: integer("lead_id"),
  propertyId: integer("property_id"),
  quoteNumber: text("quote_number").notNull(),
  status: text("status").notNull().default("draft"),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 10, scale: 2 }).notNull().default("0"),
  // Phase 6: the sales tax rate this estimate charges, frozen when chosen (null: no tax),
  // and how it reads, e.g. "Missouri 4.225% + Jackson County 1.25%".
  taxRate: numeric("tax_rate", { precision: 7, scale: 4 }),
  taxLabel: text("tax_label"),
  // Which of the business's rates were chosen, so the estimate screen shows the choice.
  taxStateRateId: integer("tax_state_rate_id"),
  taxCountyRateId: integer("tax_county_rate_id"),
  discountTotal: numeric("discount_total", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  terms: text("terms"),
  validUntil: text("valid_until"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_quotes_customer_id").on(t.customerId),
  index("idx_quotes_lead_id").on(t.leadId),
  index("idx_quotes_status").on(t.status),
  index("idx_quotes_created_at").on(t.createdAt),
]);

export const insertQuoteSchema = createInsertSchema(quotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotesTable.$inferSelect;
