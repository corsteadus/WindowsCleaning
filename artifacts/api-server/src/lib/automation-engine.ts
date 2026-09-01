/**
 * Automation Engine
 *
 * Evaluates active automation rules and creates email campaigns for eligible
 * customers. Called by the in-process scheduler daily at 06:00.
 *
 * Supported trigger types:
 *   days_after_last_service  — customers whose last completed job was exactly
 *                              N days ago (within a ±1 day window).
 *   inactive_customer        — customers with no completed job in the last N days.
 *
 * Duplicate-send prevention:
 *   Before creating a campaign, the engine checks whether a campaign from the
 *   same automation rule already has a recipient for that customer created in
 *   the current calendar day. This prevents double-firing on server restarts.
 */

import { db, automationRulesTable, emailCampaignRecipientsTable, emailCampaignsTable, jobsTable, customersTable, emailTemplatesTable } from "@workspace/db";
import { eq, and, sql, lt, gte, isNotNull } from "drizzle-orm";
import { createCampaign } from "./campaign-processor";
import { logger } from "./logger";
import { businessDateStr } from "./date.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgoEnd(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(23, 59, 59, 999);
  return d;
}

function todayStr(): string {
  return businessDateStr();
}

/**
 * Check if a customer already received an automation campaign from this rule today.
 */
async function alreadySentToday(ruleId: number, customerId: number): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const rows = await db
    .select({ id: emailCampaignRecipientsTable.id })
    .from(emailCampaignRecipientsTable)
    .innerJoin(emailCampaignsTable, eq(emailCampaignRecipientsTable.campaignId, emailCampaignsTable.id))
    .where(
      and(
        eq(emailCampaignsTable.automationRuleId, ruleId),
        eq(emailCampaignRecipientsTable.entityType, "customer"),
        eq(emailCampaignRecipientsTable.entityId, customerId),
        gte(emailCampaignRecipientsTable.createdAt, todayStart),
      )
    )
    .limit(1);

  return rows.length > 0;
}

// ─── Trigger: days_after_last_service ────────────────────────────────────────

async function runDaysAfterLastService(rule: typeof automationRulesTable.$inferSelect): Promise<number> {
  const n = rule.delayDays ?? 30;

  // Last job subquery: most recent completed job per customer
  const lastJobSq = db
    .select({
      customerId:      jobsTable.customerId,
      lastServiceDate: sql<string>`MAX(${jobsTable.completedAt})`.as("last_service_date"),
      lastServiceType: sql<string>`(array_agg(${jobsTable.serviceType} ORDER BY ${jobsTable.completedAt} DESC NULLS LAST))[1]`.as("last_service_type"),
    })
    .from(jobsTable)
    .where(eq(jobsTable.status, "completed"))
    .groupBy(jobsTable.customerId)
    .as("last_job");

  // Customers whose last service was exactly N days ago (within a ±1 day window)
  const windowStart = daysAgo(n + 1);
  const windowEnd   = daysAgoEnd(n - 1);

  const rows = await db
    .select({
      id:              customersTable.id,
      firstName:       customersTable.firstName,
      lastName:        customersTable.lastName,
      email:           customersTable.email,
      companyName:     customersTable.companyName,
      lastServiceDate: lastJobSq.lastServiceDate,
      lastServiceType: lastJobSq.lastServiceType,
    })
    .from(customersTable)
    .innerJoin(lastJobSq, eq(customersTable.id, lastJobSq.customerId))
    .where(
      and(
        eq(customersTable.status, "active"),
        isNotNull(customersTable.email),
        sql`${customersTable.email} != ''`,
        gte(lastJobSq.lastServiceDate, windowStart.toISOString()),
        lt(lastJobSq.lastServiceDate, windowEnd.toISOString()),
      )
    );

  const eligible: typeof rows = [];
  for (const r of rows) {
    if (await alreadySentToday(rule.id, r.id)) continue;
    eligible.push(r);
  }

  if (eligible.length === 0) {
    logger.info({ ruleId: rule.id, trigger: "days_after_last_service", n }, "No eligible recipients");
    return 0;
  }

  // Resolve template content
  let subject  = rule.templateSubject  ?? `Follow-up from Superior Professional Window Cleaning`;
  let bodyHtml = rule.templateBody;
  if (rule.emailTemplateId) {
    const [tpl] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.id, rule.emailTemplateId))
      .limit(1);
    if (tpl) { subject = tpl.subject; bodyHtml = tpl.bodyHtml; }
  }

  const campaignId = await createCampaign({
    name:             `[Auto] ${rule.name} — ${todayStr()}`,
    subject,
    bodyHtml,
    templateId:       rule.emailTemplateId ?? null,
    templateName:     null,
    automationRuleId: rule.id,
    classification:   "marketing",
    createdBy:        "automation-engine",
    recipients: eligible.map((r) => ({
      entityType:      "customer",
      entityId:        r.id,
      email:           r.email!,
      firstName:       r.firstName,
      lastName:        r.lastName,
      companyName:     r.companyName,
      lastServiceType: r.lastServiceType,
      lastServiceDate: r.lastServiceDate,
    })),
  });

  logger.info({ ruleId: rule.id, campaignId, recipients: eligible.length }, "Automation campaign created (days_after_last_service)");
  return eligible.length;
}

// ─── Trigger: inactive_customer ───────────────────────────────────────────────

async function runInactiveCustomer(rule: typeof automationRulesTable.$inferSelect): Promise<number> {
  const n = rule.delayDays ?? 90;

  const lastJobSq = db
    .select({
      customerId:      jobsTable.customerId,
      lastServiceDate: sql<string>`MAX(${jobsTable.completedAt})`.as("last_service_date"),
      lastServiceType: sql<string>`(array_agg(${jobsTable.serviceType} ORDER BY ${jobsTable.completedAt} DESC NULLS LAST))[1]`.as("last_service_type"),
    })
    .from(jobsTable)
    .where(eq(jobsTable.status, "completed"))
    .groupBy(jobsTable.customerId)
    .as("last_job");

  const cutoff = daysAgo(n);

  const rows = await db
    .select({
      id:              customersTable.id,
      firstName:       customersTable.firstName,
      lastName:        customersTable.lastName,
      email:           customersTable.email,
      companyName:     customersTable.companyName,
      lastServiceDate: lastJobSq.lastServiceDate,
      lastServiceType: lastJobSq.lastServiceType,
    })
    .from(customersTable)
    .leftJoin(lastJobSq, eq(customersTable.id, lastJobSq.customerId))
    .where(
      and(
        eq(customersTable.status, "active"),
        isNotNull(customersTable.email),
        sql`${customersTable.email} != ''`,
        sql`(${lastJobSq.lastServiceDate} IS NULL OR ${lastJobSq.lastServiceDate} < ${cutoff.toISOString()})`,
      )
    );

  const eligible: typeof rows = [];
  for (const r of rows) {
    if (await alreadySentToday(rule.id, r.id)) continue;
    eligible.push(r);
  }

  if (eligible.length === 0) {
    logger.info({ ruleId: rule.id, trigger: "inactive_customer", n }, "No eligible recipients");
    return 0;
  }

  let subject  = rule.templateSubject ?? `We miss you!`;
  let bodyHtml = rule.templateBody;
  if (rule.emailTemplateId) {
    const [tpl] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.id, rule.emailTemplateId))
      .limit(1);
    if (tpl) { subject = tpl.subject; bodyHtml = tpl.bodyHtml; }
  }

  const campaignId = await createCampaign({
    name:             `[Auto] ${rule.name} — ${todayStr()}`,
    subject,
    bodyHtml,
    templateId:       rule.emailTemplateId ?? null,
    templateName:     null,
    automationRuleId: rule.id,
    classification:   "marketing",
    createdBy:        "automation-engine",
    recipients: eligible.map((r) => ({
      entityType:      "customer",
      entityId:        r.id,
      email:           r.email!,
      firstName:       r.firstName,
      lastName:        r.lastName,
      companyName:     r.companyName,
      lastServiceType: r.lastServiceType ?? null,
      lastServiceDate: r.lastServiceDate ?? null,
    })),
  });

  logger.info({ ruleId: rule.id, campaignId, recipients: eligible.length }, "Automation campaign created (inactive_customer)");
  return eligible.length;
}

// ─── Main engine tick ─────────────────────────────────────────────────────────

let _running = false;

export async function runAutomationEngine(): Promise<void> {
  if (_running) return;
  _running = true;

  try {
    const rules = await db
      .select()
      .from(automationRulesTable)
      .where(eq(automationRulesTable.active, true));

    logger.info({ count: rules.length }, "Automation engine: evaluating rules");

    for (const rule of rules) {
      try {
        let fired = 0;
        if (rule.triggerType === "days_after_last_service") {
          fired = await runDaysAfterLastService(rule);
        } else if (rule.triggerType === "inactive_customer") {
          fired = await runInactiveCustomer(rule);
        } else {
          // hook-driven types (job_created, job_completed) are fired on-demand via the automations route
          logger.debug({ ruleId: rule.id, triggerType: rule.triggerType }, "Skipping hook-driven rule in scheduler");
          continue;
        }

        // Update last_run_at on the rule
        await db
          .update(automationRulesTable)
          .set({ lastRunAt: new Date(), updatedAt: new Date() })
          .where(eq(automationRulesTable.id, rule.id));

        logger.info({ ruleId: rule.id, rule: rule.name, fired }, "Automation rule evaluated");
      } catch (err) {
        logger.error({ ruleId: rule.id, err }, "Error evaluating automation rule");
      }
    }
  } catch (err) {
    logger.error({ err }, "Automation engine tick failed");
  } finally {
    _running = false;
  }
}
