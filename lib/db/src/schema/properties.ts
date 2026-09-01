import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const propertiesTable = pgTable("properties", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  name: text("name"),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  county: text("county"),
  subdivision: text("subdivision"),
  directions: text("directions"),
  locationNotes: text("location_notes"),
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingZip: text("billing_zip"),
  propertyType: text("property_type").notNull().default("residential"),
  stories: integer("stories"),
  windowCount: integer("window_count"),
  accessNotes: text("access_notes"),
  gateCode: text("gate_code"),
  hasScreens: boolean("has_screens").notNull().default(false),
  hasHardWater: boolean("has_hard_water").notNull().default(false),
  hasTracks: boolean("has_tracks").notNull().default(false),
  riskNotes: text("risk_notes"),
  serviceNotes: text("service_notes"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isManualDefault: boolean("is_manual_default").notNull().default(false),
  isBillingAddress: boolean("is_billing_address").notNull().default(false),
  // Import tracking
  importSource: text("import_source"),
  importExternalId: text("import_external_id"),
  importBatchId: integer("import_batch_id"),
  isImported: boolean("is_imported").notNull().default(false),
  lastSeenImportAt: timestamp("last_seen_import_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: text("archived_by"),
  archiveReason: text("archive_reason"),
  migrationSource: text("migration_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  activePrimaryPerCustomer: uniqueIndex("properties_active_primary_customer_idx")
    .on(table.customerId)
    .where(sql`${table.archivedAt} IS NULL AND ${table.isPrimary} = true`),
}));

export const insertPropertySchema = createInsertSchema(propertiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof propertiesTable.$inferSelect;
