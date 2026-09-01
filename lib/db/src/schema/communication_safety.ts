import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { customersTable } from "./customers.ts";
import { contactsTable } from "./contacts.ts";

export const communicationEligibilityDecisionsTable = pgTable("communication_eligibility_decisions", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  destinationHash: text("destination_hash").notNull(),
  classification: text("classification").notNull(),
  outcome: text("outcome").notNull(),
  reasonCode: text("reason_code").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  allowedAt: timestamp("allowed_at", { withTimezone: true }),
  source: text("source").notNull(),
  sourceEvent: text("source_event"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("communication_eligibility_channel_check", sql`${table.channel} IN ('email', 'sms')`),
  check("communication_eligibility_classification_check", sql`${table.classification} IN ('marketing', 'transactional')`),
  check("communication_eligibility_outcome_check", sql`${table.outcome} IN ('eligible', 'blocked', 'deferred')`),
  uniqueIndex("communication_eligibility_decisions_id_idx").on(table.id),
  index("communication_eligibility_decisions_customer_created_idx").on(table.customerId, table.createdAt),
  index("communication_eligibility_decisions_destination_created_idx").on(table.destinationHash, table.createdAt),
  index("communication_eligibility_decisions_outcome_created_idx").on(table.outcome, table.createdAt),
]);

export const insertCommunicationEligibilityDecisionSchema = createInsertSchema(communicationEligibilityDecisionsTable).omit({ id: true, createdAt: true });
export type InsertCommunicationEligibilityDecision = z.infer<typeof insertCommunicationEligibilityDecisionSchema>;
export type CommunicationEligibilityDecision = typeof communicationEligibilityDecisionsTable.$inferSelect;

export const communicationQuietHoursTable = pgTable("communication_quiet_hours", {
  id: serial("id").primaryKey(),
  organizationKey: text("organization_key").notNull().default("default"),
  timezone: text("timezone").notNull(),
  emailStart: text("email_start"),
  emailEnd: text("email_end"),
  smsStart: text("sms_start"),
  smsEnd: text("sms_end"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("communication_quiet_hours_timezone_check", sql`length(${table.timezone}) BETWEEN 1 AND 128`),
  check("communication_quiet_hours_time_format_check", sql`(${table.emailStart} IS NULL OR ${table.emailStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND (${table.emailEnd} IS NULL OR ${table.emailEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND (${table.smsStart} IS NULL OR ${table.smsStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND (${table.smsEnd} IS NULL OR ${table.smsEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`),
  check("communication_quiet_hours_email_pair_check", sql`(${table.emailStart} IS NULL AND ${table.emailEnd} IS NULL) OR (${table.emailStart} IS NOT NULL AND ${table.emailEnd} IS NOT NULL)`),
  check("communication_quiet_hours_sms_pair_check", sql`(${table.smsStart} IS NULL AND ${table.smsEnd} IS NULL) OR (${table.smsStart} IS NOT NULL AND ${table.smsEnd} IS NOT NULL)`),
  uniqueIndex("communication_quiet_hours_org_idx").on(table.organizationKey),
]);

export const insertCommunicationQuietHoursSchema = createInsertSchema(communicationQuietHoursTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCommunicationQuietHours = z.infer<typeof insertCommunicationQuietHoursSchema>;
export type CommunicationQuietHours = typeof communicationQuietHoursTable.$inferSelect;