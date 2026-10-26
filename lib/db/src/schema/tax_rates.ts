import { pgTable, text, serial, timestamp, numeric, boolean } from "drizzle-orm/pg-core";

/**
 * Sales tax rates — phase 6, Kyle's answer #2: "the business sets up state and
 * county rates … base = state, county added when it applies; either rate alone or
 * both added together." An estimate freezes the rate it charges (quotes.tax_rate),
 * so changing a rate here never changes an estimate already made.
 */
export const taxRatesTable = pgTable("tax_rates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),          // state | county
  state: text("state").notNull(),        // two letters, e.g. MO
  county: text("county"),                // for a county rate
  rate: numeric("rate", { precision: 7, scale: 4 }).notNull(), // a percentage, e.g. 4.225
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaxRate = typeof taxRatesTable.$inferSelect;
