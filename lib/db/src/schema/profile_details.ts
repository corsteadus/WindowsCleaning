import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const profileCatalogItemsTable = pgTable("profile_catalog_items", {
  id: serial("id").primaryKey(),
  catalogType: text("catalog_type").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  pricingType: text("pricing_type"),
  defaultPrice: numeric("default_price", { precision: 10, scale: 2 }),
  unit: text("unit"),
  estimatedDuration: integer("estimated_duration"),
  daysUntilDue: integer("days_until_due"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("profile_catalog_items_type_code_idx").on(table.catalogType, table.code),
  index("profile_catalog_items_type_active_order_idx").on(table.catalogType, table.isActive, table.sortOrder),
]);

export const accountProfileSettingsTable = pgTable("account_profile_settings", {
  customerId: integer("customer_id").primaryKey(),
  profileTypeId: integer("profile_type_id"),
  profileGroupId: integer("profile_group_id"),
  paymentTermsId: integer("payment_terms_id"),
  marketingSourceId: integer("marketing_source_id"),
  paymentTermsOverride: text("payment_terms_override"),
  preferredContactMethod: text("preferred_contact_method"),
  sendingPreferences: text("sending_preferences"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const contactChannelsTable = pgTable("contact_channels", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  contactId: integer("contact_id"),
  channelType: text("channel_type").notNull(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  notes: text("notes"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: text("archived_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("contact_channels_customer_active_idx").on(table.customerId, table.archivedAt),
  index("contact_channels_contact_active_idx").on(table.contactId, table.archivedAt),
]);

export const contactChannelPurposesTable = pgTable("contact_channel_purposes", {
  channelId: integer("channel_id").notNull(),
  purpose: text("purpose").notNull(),
}, (table) => [
  primaryKey({ name: "contact_channel_purposes_pk", columns: [table.channelId, table.purpose] }),
  index("contact_channel_purposes_purpose_idx").on(table.purpose),
]);

export const customFieldDefinitionsTable = pgTable("custom_field_definitions", {
  id: serial("id").primaryKey(),
  fieldKey: text("field_key").notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").notNull().default("text"),
  scope: text("scope").notNull().default("account"),
  template: text("template").notNull().default("all"),
  isRequired: boolean("is_required").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("custom_field_definitions_key_idx").on(table.fieldKey),
  index("custom_field_definitions_active_order_idx").on(table.isActive, table.sortOrder),
]);

export const customFieldValuesTable = pgTable("custom_field_values", {
  customerId: integer("customer_id").notNull(),
  definitionId: integer("definition_id").notNull(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  primaryKey({ name: "custom_field_values_pk", columns: [table.customerId, table.definitionId] }),
  index("custom_field_values_definition_idx").on(table.definitionId),
]);

export const insertProfileCatalogItemSchema = createInsertSchema(profileCatalogItemsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProfileCatalogItem = z.infer<typeof insertProfileCatalogItemSchema>;
export type ProfileCatalogItem = typeof profileCatalogItemsTable.$inferSelect;
export type AccountProfileSettings = typeof accountProfileSettingsTable.$inferSelect;
export type ContactChannel = typeof contactChannelsTable.$inferSelect;
export type ContactChannelPurpose = typeof contactChannelPurposesTable.$inferSelect;
export type CustomFieldDefinition = typeof customFieldDefinitionsTable.$inferSelect;
export type CustomFieldValue = typeof customFieldValuesTable.$inferSelect;