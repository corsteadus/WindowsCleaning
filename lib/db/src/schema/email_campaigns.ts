import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailCampaignsTable = pgTable("email_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // queued | processing | completed | partially_failed | failed | cancelled
  status: text("status").notNull().default("queued"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  queuedCount: integer("queued_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  permanentlyFailedCount: integer("permanently_failed_count").notNull().default(0),
  batchSize: integer("batch_size").notNull().default(50),
  // Template / content (rendered subject stored per-recipient; raw template here)
  templateId: integer("template_id"),
  templateName: text("template_name"),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  // Safety classification is fixed when the campaign is created and checked
  // again immediately before each provider invocation.
  classification: text("classification").notNull().default("transactional"),
  // Which automation rule created this (null for manual sends)
  automationRuleId: integer("automation_rule_id"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

export const insertEmailCampaignSchema = createInsertSchema(emailCampaignsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaignsTable.$inferSelect;
