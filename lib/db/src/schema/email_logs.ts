import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  // Which record this email is attached to (for timeline display)
  entityType: text("entity_type"),          // "customer" | "lead" | null for bulk-only
  entityId: integer("entity_id"),
  // Template reference (nullable — one-off emails may have no template)
  templateId: integer("template_id"),
  templateName: text("template_name"),
  // Batch id (legacy bulk sends)
  batchId: text("batch_id"),
  // Campaign reference (async bulk sends)
  campaignId: integer("campaign_id"),
  campaignRecipientId: integer("campaign_recipient_id"),
  // Recipient
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  // Content (rendered)
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  // Send result
  status: text("status").notNull().default("pending"), // "pending" | "sent" | "failed"
  provider: text("provider"),               // "sendgrid" | "mailgun" | "smtp" | "mock"
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  // Retry tracking
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  lastRetryAt: timestamp("last_retry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogsTable.$inferSelect;
