import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const automationRulesTable = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Trigger types:
  //   days_after_last_service  — fire N days after customer's last completed job
  //   inactive_customer        — fire if no service in last N days
  //   job_completed            — fire when a job is marked complete (hook-driven)
  //   job_created              — fire when a new job is created (hook-driven)
  triggerType: text("trigger_type").notNull(),
  active: boolean("active").notNull().default(true),
  channel: text("channel").notNull().default("email"),
  templateSubject: text("template_subject"),
  templateBody: text("template_body").notNull(),
  // Scheduling fields for time-based triggers
  delayDays: integer("delay_days"),          // how many days after/before the event
  emailTemplateId: integer("email_template_id"),  // optional: reference a saved template
  // Prevent duplicate sends: record last execution so engine skips already-fired recipients
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAutomationRuleSchema = createInsertSchema(automationRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationRule = typeof automationRulesTable.$inferSelect;
