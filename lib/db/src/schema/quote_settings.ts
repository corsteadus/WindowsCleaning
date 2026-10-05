import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * What the business decided about its own quotes.
 *
 * Kyle (Testing Edits, 2026-10-01):
 *
 * - **#11** *"Do not require the user to manually enter a specific Valid Until
 *   date on every quote. Add a company-level Admin setting where the business
 *   chooses how many days a quote remains valid."* `validity_days` is that
 *   setting, and every quote's expiry is calculated from it.
 * - **#13** *"Do not provide any default Corstead terms and conditions. Leave
 *   Terms & Conditions blank by default."* So `terms` is nullable with **no
 *   default** — a company that has not written any has none, and Corstead never
 *   supplies wording of its own.
 *
 * A singleton per organization, like the communication settings beside it.
 */
export const quoteSettingsTable = pgTable("quote_settings", {
  id: serial("id").primaryKey(),
  organizationKey: text("organization_key").notNull().default("default"),
  /** How many days a quote stays valid. Kyle's examples: 15, 30, 60, 90. */
  validityDays: integer("validity_days").notNull().default(30),
  /** The company's own customer-facing terms. Null until somebody writes them. */
  terms: text("terms"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // A year is the outer bound. Kyle's longest example is 90 days; the ceiling is
  // here so a typed number cannot push a quote's expiry out of living memory.
  check("quote_settings_validity_days_check", sql`${table.validityDays} BETWEEN 1 AND 365`),
  check("quote_settings_terms_length_check", sql`${table.terms} IS NULL OR length(${table.terms}) <= 20000`),
  uniqueIndex("quote_settings_org_idx").on(table.organizationKey),
]);

export const insertQuoteSettingsSchema = createInsertSchema(quoteSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertQuoteSettings = z.infer<typeof insertQuoteSettingsSchema>;
export type QuoteSettings = typeof quoteSettingsTable.$inferSelect;
