import { boolean, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { customersTable } from "./customers.ts";
import { contactsTable } from "./contacts.ts";

export const communicationPreferencesTable = pgTable("communication_preferences", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  normalizedDestination: text("normalized_destination").notNull(),
  destinationHash: text("destination_hash").notNull(),
  emailMarketingStatus: text("email_marketing_status"),
  smsConsentStatus: text("sms_consent_status"),
  smsConsentAt: timestamp("sms_consent_at", { withTimezone: true }),
  smsDisclosureSnapshot: text("sms_disclosure_snapshot"),
  smsConsentSource: text("sms_consent_source"),
  smsConsentActor: text("sms_consent_actor"),
  lastReason: text("last_reason"),
  lastSource: text("last_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("communication_preferences_channel_check", sql`${table.channel} IN ('email', 'sms')`),
  check("communication_preferences_email_status_check", sql`${table.emailMarketingStatus} IS NULL OR ${table.emailMarketingStatus} IN ('subscribed', 'unsubscribed', 'invalid', 'bounced', 'complained')`),
  check("communication_preferences_sms_status_check", sql`${table.smsConsentStatus} IS NULL OR ${table.smsConsentStatus} IN ('unknown', 'opted_in', 'opted_out', 'invalid')`),
  check("communication_preferences_owner_check", sql`${table.customerId} IS NOT NULL OR ${table.contactId} IS NOT NULL`),
  uniqueIndex("communication_preferences_channel_destination_idx").on(table.channel, table.destinationHash),
  index("communication_preferences_customer_idx").on(table.customerId, table.channel),
  index("communication_preferences_contact_idx").on(table.contactId, table.channel),
]);

export const insertCommunicationPreferenceSchema = createInsertSchema(communicationPreferencesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCommunicationPreference = z.infer<typeof insertCommunicationPreferenceSchema>;
export type CommunicationPreference = typeof communicationPreferencesTable.$inferSelect;

export const communicationPreferenceHistoryTable = pgTable("communication_preference_history", {
  id: serial("id").primaryKey(),
  preferenceId: integer("preference_id").references(() => communicationPreferencesTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  destinationHash: text("destination_hash").notNull(),
  action: text("action").notNull(),
  classification: text("classification"),
  emailMarketingStatus: text("email_marketing_status"),
  smsConsentStatus: text("sms_consent_status"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  disclosureSnapshot: text("disclosure_snapshot"),
  source: text("source").notNull(),
  actor: text("actor"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("communication_preference_history_channel_check", sql`${table.channel} IN ('email', 'sms')`),
  check("communication_preference_history_action_check", sql`${table.action} IN ('consent_recorded', 'opted_out', 'reconsented', 'status_changed', 'suppression_applied', 'suppression_removed')`),
  index("communication_preference_history_customer_created_idx").on(table.customerId, table.createdAt),
  index("communication_preference_history_destination_created_idx").on(table.destinationHash, table.createdAt),
]);

export const insertCommunicationPreferenceHistorySchema = createInsertSchema(communicationPreferenceHistoryTable).omit({ id: true, createdAt: true });
export type InsertCommunicationPreferenceHistory = z.infer<typeof insertCommunicationPreferenceHistorySchema>;
export type CommunicationPreferenceHistory = typeof communicationPreferenceHistoryTable.$inferSelect;

export const communicationSuppressionsTable = pgTable("communication_suppressions", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  normalizedDestination: text("normalized_destination").notNull(),
  destinationHash: text("destination_hash").notNull(),
  reason: text("reason").notNull(),
  scope: text("scope").notNull().default("global"),
  active: boolean("active").notNull().default(true),
  source: text("source").notNull(),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  deactivatedBy: text("deactivated_by"),
}, (table) => [
  check("communication_suppressions_channel_check", sql`${table.channel} IN ('email', 'sms')`),
  check("communication_suppressions_scope_check", sql`${table.scope} IN ('global', 'marketing', 'transactional')`),
  check("communication_suppressions_reason_check", sql`${table.reason} IN ('complaint', 'invalid', 'provider_permanent_failure', 'manual', 'marketing_unsubscribe')`),
  uniqueIndex("communication_suppressions_active_destination_idx")
    .on(table.channel, table.destinationHash, table.scope)
    .where(sql`${table.active} = true`),
  index("communication_suppressions_lookup_idx").on(table.channel, table.destinationHash, table.active),
  index("communication_suppressions_created_idx").on(table.createdAt),
]);

export const insertCommunicationSuppressionSchema = createInsertSchema(communicationSuppressionsTable).omit({ id: true, createdAt: true });
export type InsertCommunicationSuppression = z.infer<typeof insertCommunicationSuppressionSchema>;
export type CommunicationSuppression = typeof communicationSuppressionsTable.$inferSelect;