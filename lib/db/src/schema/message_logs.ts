import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messageLogsTable = pgTable("message_logs", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  triggerType: text("trigger_type").notNull(),
  relatedType: text("related_type"),
  relatedId: integer("related_id"),
  recipient: text("recipient"),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  safetyReasonCode: text("safety_reason_code"),
  sentAt: text("sent_at"),
  runDate: text("run_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMessageLogSchema = createInsertSchema(messageLogsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMessageLog = z.infer<typeof insertMessageLogSchema>;
export type MessageLog = typeof messageLogsTable.$inferSelect;
