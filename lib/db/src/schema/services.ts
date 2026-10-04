import { pgTable, text, serial, timestamp, boolean, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("window_cleaning"),
  // Kyle (Testing Edits, 2026-10-01, #8): the catalogue holds a name and a
  // category. Price, pricing type and unit are no longer asked for — kept so a
  // service that already carries one does not lose it.
  pricingType: text("pricing_type"),
  basePrice: numeric("base_price", { precision: 10, scale: 2 }),
  unit: text("unit"),
  estimatedDuration: integer("estimated_duration"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;
