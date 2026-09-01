import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailCampaignRecipientsTable = pgTable("email_campaign_recipients", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  entityType: text("entity_type"),   // "customer" | "lead"
  entityId: integer("entity_id"),
  email: text("email").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  companyName: text("company_name"),
  lastServiceType: text("last_service_type"),
  lastServiceDate: text("last_service_date"),
  // queued | sent | failed | permanently_failed | skipped
  status: text("status").notNull().default("queued"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  lastRetryAt: timestamp("last_retry_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  safetyReasonCode: text("safety_reason_code"),
  emailLogId: integer("email_log_id"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEmailCampaignRecipientSchema = createInsertSchema(emailCampaignRecipientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmailCampaignRecipient = z.infer<typeof insertEmailCampaignRecipientSchema>;
export type EmailCampaignRecipient = typeof emailCampaignRecipientsTable.$inferSelect;
