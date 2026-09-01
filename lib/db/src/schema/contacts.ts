import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  alternatePhone: text("alternate_phone"),
  role: text("role"),
  isPrimary: boolean("is_primary").notNull().default(false),
  receiveSms: boolean("receive_sms").notNull().default(true),
  receiveEmail: boolean("receive_email").notNull().default(true),
  notes: text("notes"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: text("archived_by"),
  archiveReason: text("archive_reason"),
  migrationSource: text("migration_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  activePrimaryPerCustomer: uniqueIndex("contacts_active_primary_customer_idx")
    .on(table.customerId)
    .where(sql`${table.archivedAt} IS NULL AND ${table.isPrimary} = true`),
}));

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
