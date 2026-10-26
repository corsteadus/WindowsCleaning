import { pgTable, text, serial, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";
import { customersTable } from "./customers.ts";
import { quotesTable } from "./quotes.ts";

/**
 * Discounts — phase 5, Kyle's Video 5. A profile's own discounts ("if you had a
 * senior citizen discount, obviously that person is always going to be a senior
 * citizen going forward") are copied onto each new estimate for it, where they
 * can be removed. An estimate's discounts are named, $ or %, and stack; `amount`
 * is what each took off, worked out by the server (api-server lib/discounts.ts).
 */
export const customerDiscountsTable = pgTable("customer_discounts", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),                 // amount | percent
  value: numeric("value", { precision: 10, scale: 2 }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("customer_discounts_customer_idx").on(t.customerId)]);

export const quoteDiscountsTable = pgTable("quote_discounts", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull().references(() => quotesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),                 // amount | percent
  value: numeric("value", { precision: 10, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  customerDiscountId: integer("customer_discount_id").references(() => customerDiscountsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("quote_discounts_quote_idx").on(t.quoteId)]);

export type CustomerDiscount = typeof customerDiscountsTable.$inferSelect;
export type QuoteDiscount = typeof quoteDiscountsTable.$inferSelect;
