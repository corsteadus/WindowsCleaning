import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const propertyAccountRelationshipsTable = pgTable("property_account_relationships", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  customerId: integer("customer_id").notNull(),
  relationshipType: text("relationship_type").notNull().default("owner"),
  isPrimary: boolean("is_primary").notNull().default(true),
  startDate: text("start_date"),
  endDate: text("end_date"),
  notes: text("notes"),
  importBatchId: integer("import_batch_id"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: text("archived_by"),
  archiveReason: text("archive_reason"),
  migrationSource: text("migration_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  activeAccountProperty: uniqueIndex("property_account_relationships_active_account_property_idx")
    .on(table.propertyId, table.customerId)
    .where(sql`${table.archivedAt} IS NULL`),
}));

export type PropertyAccountRelationship = typeof propertyAccountRelationshipsTable.$inferSelect;
export type InsertPropertyAccountRelationship = typeof propertyAccountRelationshipsTable.$inferInsert;
