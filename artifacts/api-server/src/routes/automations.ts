import { Router } from "express";
import { db } from "@workspace/db";
import {
  automationRulesTable,
  messageLogsTable,
  jobsTable,
  invoicesTable,
  recurringPlansTable,
  customersTable,
} from "@workspace/db/schema";
import { eq, and, lte, gte, sql } from "drizzle-orm";
import { createCampaign } from "../lib/campaign-processor";
import {
  evaluateRecipientEligibility,
  maskCommunicationDestination,
} from "../lib/communication-safety-store";
import { normalizeCommunicationDestination } from "../lib/communication-safety-core";
import { addDaysToDateOnly, businessDateStr } from "../lib/date.ts";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today() {
  return businessDateStr();
}

function addDays(dateStr: string, n: number): string {
  return addDaysToDateOnly(dateStr, n);
}

function interpolate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
}

async function getCustomer(customerId: number) {
  const [c] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  return c ?? null;
}

function recipientFor(customer: typeof customersTable.$inferSelect | null, channel: string) {
  if (!customer) return null;
  if (channel === "email") return customer.email ?? null;
  if (channel === "sms") return customer.phone ?? null;
  return `customer_${customer.id}`;
}

async function alreadyLogged(triggerType: string, relatedType: string, relatedId: number, runDate: string) {
  const rows = await db
    .select({ id: messageLogsTable.id })
    .from(messageLogsTable)
    .where(
      and(
        eq(messageLogsTable.triggerType, triggerType),
        eq(messageLogsTable.relatedType, relatedType),
        sql`${messageLogsTable.relatedId} = ${relatedId}`,
        eq(messageLogsTable.runDate, runDate),
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function createLog(data: {
  channel: string; triggerType: string; relatedType: string;
  relatedId: number; recipient: string | null; subject: string | null;
  body: string; runDate: string; customerId: number | null;
}) {
  return db.transaction(async (tx) => {
    let status = data.recipient ? "not_dispatched" : "skipped";
    let safetyReasonCode: string | null = null;
    let safeRecipient = data.recipient;
    if (data.channel === "email" || data.channel === "sms") {
      const eligibility = await evaluateRecipientEligibility(tx, {
        customerId: data.customerId,
        channel: data.channel,
        rawDestination: data.recipient,
        classification: "transactional",
        requestedAt: new Date(),
        source: "legacy_automation_message_log",
        sourceEvent: `${data.triggerType}:${data.relatedType}:${data.relatedId}:${data.runDate}`,
      });
      status = eligibility.outcome === "eligible" ? "not_dispatched" : "skipped";
      safetyReasonCode = eligibility.reasonCode;
      if (data.recipient) {
        try {
          const normalized = normalizeCommunicationDestination(
            data.channel,
            data.recipient,
          ).normalized;
          safeRecipient = maskCommunicationDestination(
            data.channel,
            normalized,
          );
        } catch {
          safeRecipient = null;
        }
      }
    }
    const [row] = await tx
      .insert(messageLogsTable)
      .values({
        channel: data.channel,
        triggerType: data.triggerType,
        relatedType: data.relatedType,
        relatedId: data.relatedId,
        recipient: safeRecipient,
        subject: data.subject,
        body: "[redacted]",
        status,
        safetyReasonCode,
        sentAt: null,
        runDate: data.runDate,
      })
      .returning();
    return row;
  });
}

function privacySafeMessageLog(log: typeof messageLogsTable.$inferSelect) {
  const { body: _body, recipient, ...safeLog } = log;
  let maskedRecipient: string | null = recipient;
  if (recipient && (log.channel === "email" || log.channel === "sms")) {
    try {
      const normalized = normalizeCommunicationDestination(
        log.channel,
        recipient,
      ).normalized;
      maskedRecipient = maskCommunicationDestination(log.channel, normalized);
    } catch {
      maskedRecipient = null;
    }
  }
  return { ...safeLog, recipient: maskedRecipient, body: "[redacted]" };
}

// ─── Automation Rules CRUD ───────────────────────────────────────────────────

// List
router.get("/automations", async (req, res) => {
  try {
    const rules = await db.select().from(automationRulesTable).orderBy(automationRulesTable.createdAt);
    res.json(rules);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch automations" });
  }
});

// Get single
router.get("/automations/:id", async (req, res) => {
  try {
    const [rule] = await db.select().from(automationRulesTable).where(eq(automationRulesTable.id, Number(req.params.id)));
    if (!rule) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rule);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch automation" });
  }
});

// Create
router.post("/automations", async (req, res) => {
  try {
    const b = req.body;
    const [row] = await db.insert(automationRulesTable).values({
      name:            b.name,
      triggerType:     b.triggerType,
      active:          b.active ?? true,
      channel:         b.channel || "email",
      templateSubject: b.templateSubject || null,
      templateBody:    b.templateBody ?? "",
      delayDays:       b.delayDays != null ? parseInt(String(b.delayDays), 10) : null,
      emailTemplateId: b.emailTemplateId ? parseInt(String(b.emailTemplateId), 10) : null,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create automation" });
  }
});

// Update
router.patch("/automations/:id", async (req, res) => {
  try {
    const b = req.body;
    const update: Record<string, unknown> = {};
    if (b.name !== undefined)            update.name = b.name;
    if (b.triggerType !== undefined)     update.triggerType = b.triggerType;
    if (b.active !== undefined)          update.active = b.active;
    if (b.channel !== undefined)         update.channel = b.channel;
    if (b.templateSubject !== undefined) update.templateSubject = b.templateSubject || null;
    if (b.templateBody !== undefined)    update.templateBody = b.templateBody;
    if (b.delayDays !== undefined)       update.delayDays = b.delayDays != null ? parseInt(String(b.delayDays), 10) : null;
    if (b.emailTemplateId !== undefined) update.emailTemplateId = b.emailTemplateId ? parseInt(String(b.emailTemplateId), 10) : null;
    const [row] = await db.update(automationRulesTable).set(update).where(eq(automationRulesTable.id, Number(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update automation" });
  }
});

// Delete
router.delete("/automations/:id", async (req, res) => {
  try {
    await db.delete(automationRulesTable).where(eq(automationRulesTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete automation" });
  }
});

// ─── Message Logs ────────────────────────────────────────────────────────────

router.get("/message-logs", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const logs = await db
      .select()
      .from(messageLogsTable)
      .orderBy(sql`${messageLogsTable.createdAt} desc`)
      .limit(limit);
    res.json(logs.map(privacySafeMessageLog));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch message logs" });
  }
});

// ─── Run: Job Tomorrow ───────────────────────────────────────────────────────

router.post("/automations/run/job-tomorrow", async (req, res) => {
  try {
    const tomorrow = addDays(today(), 1);
    const runDate = today();

    const rules = await db.select().from(automationRulesTable).where(
      and(eq(automationRulesTable.active, true), eq(automationRulesTable.triggerType, "job_tomorrow"))
    );
    if (!rules.length) { res.json({ processed: 0, created: 0, skipped: 0, message: "No active job_tomorrow rules." }); return; }

    const jobs = await db.select().from(jobsTable).where(eq(jobsTable.scheduledDate, tomorrow));

    let created = 0, skipped = 0;
    for (const job of jobs) {
      for (const rule of rules) {
        const dup = await alreadyLogged("job_tomorrow", "job", job.id, runDate);
        if (dup) { skipped++; continue; }
        const customer = await getCustomer(job.customerId);
        const recipient = recipientFor(customer, rule.channel);
        const vars = {
          customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Valued Customer",
          jobNumber: job.jobNumber,
          scheduledDate: job.scheduledDate ?? tomorrow,
          serviceType: job.serviceType ?? "Window Cleaning",
          address: job.propertyId ? `Property #${job.propertyId}` : "your property",
        };
        const subject = rule.templateSubject ? interpolate(rule.templateSubject, vars) : null;
        const body = interpolate(rule.templateBody, vars);
        await createLog({ channel: rule.channel, triggerType: "job_tomorrow", relatedType: "job", relatedId: job.id, recipient, subject, body, runDate, customerId: customer?.id ?? null });
        created++;
      }
    }
    res.json({ processed: jobs.length, created, skipped, message: `Checked ${jobs.length} job(s) scheduled for ${tomorrow}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to run job-tomorrow check" });
  }
});

// ─── Run: Invoice Overdue ────────────────────────────────────────────────────

router.post("/automations/run/invoice-overdue", async (req, res) => {
  try {
    const runDate = today();

    const rules = await db.select().from(automationRulesTable).where(
      and(eq(automationRulesTable.active, true), eq(automationRulesTable.triggerType, "invoice_overdue"))
    );
    if (!rules.length) { res.json({ processed: 0, created: 0, skipped: 0, message: "No active invoice_overdue rules." }); return; }

    const invoices = await db.select().from(invoicesTable).where(
      and(
        sql`${invoicesTable.status} IN ('sent','pending')`,
        sql`${invoicesTable.dueDate} IS NOT NULL`,
        sql`${invoicesTable.dueDate} < ${runDate}`,
      )
    );

    let created = 0, skipped = 0;
    for (const invoice of invoices) {
      for (const rule of rules) {
        const dup = await alreadyLogged("invoice_overdue", "invoice", invoice.id, runDate);
        if (dup) { skipped++; continue; }
        const customer = await getCustomer(invoice.customerId);
        const recipient = recipientFor(customer, rule.channel);
        const vars = {
          customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Valued Customer",
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.totalAmount,
          dueDate: invoice.dueDate ?? "",
        };
        const subject = rule.templateSubject ? interpolate(rule.templateSubject, vars) : null;
        const body = interpolate(rule.templateBody, vars);
        await createLog({ channel: rule.channel, triggerType: "invoice_overdue", relatedType: "invoice", relatedId: invoice.id, recipient, subject, body, runDate, customerId: customer?.id ?? null });
        created++;
      }
    }
    res.json({ processed: invoices.length, created, skipped, message: `Found ${invoices.length} overdue invoice(s).` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to run invoice-overdue check" });
  }
});

// ─── Run: Recurring Plan Due ─────────────────────────────────────────────────

router.post("/automations/run/recurring-plan-due", async (req, res) => {
  try {
    const runDate = today();
    const lookAheadDate = addDays(today(), 7);

    const rules = await db.select().from(automationRulesTable).where(
      and(eq(automationRulesTable.active, true), eq(automationRulesTable.triggerType, "recurring_plan_due"))
    );
    if (!rules.length) { res.json({ processed: 0, created: 0, skipped: 0, message: "No active recurring_plan_due rules." }); return; }

    const plans = await db.select().from(recurringPlansTable).where(
      and(
        eq(recurringPlansTable.status, "active"),
        sql`${recurringPlansTable.nextRunDate} IS NOT NULL`,
        sql`${recurringPlansTable.nextRunDate} <= ${lookAheadDate}`,
      )
    );

    let created = 0, skipped = 0;
    for (const plan of plans) {
      for (const rule of rules) {
        const dup = await alreadyLogged("recurring_plan_due", "recurring_plan", plan.id, runDate);
        if (dup) { skipped++; continue; }
        const customer = await getCustomer(plan.customerId);
        const recipient = recipientFor(customer, rule.channel);
        const vars = {
          customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Valued Customer",
          planName: plan.name,
          nextRunDate: plan.nextRunDate ?? "",
          serviceType: plan.serviceType ?? "service",
          estimatedAmount: plan.estimatedAmount ?? "",
        };
        const subject = rule.templateSubject ? interpolate(rule.templateSubject, vars) : null;
        const body = interpolate(rule.templateBody, vars);
        await createLog({ channel: rule.channel, triggerType: "recurring_plan_due", relatedType: "recurring_plan", relatedId: plan.id, recipient, subject, body, runDate, customerId: customer?.id ?? null });
        created++;
      }
    }
    res.json({ processed: plans.length, created, skipped, message: `Found ${plans.length} plan(s) due within 7 days.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to run recurring-plan-due check" });
  }
});

// ─── Run: Job Created Hook (called internally) ───────────────────────────────

router.post("/automations/run/job-created", async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) { res.status(400).json({ error: "jobId required" }); return; }
    const runDate = today();

    const rules = await db.select().from(automationRulesTable).where(
      and(eq(automationRulesTable.active, true), eq(automationRulesTable.triggerType, "job_created"))
    );
    if (!rules.length) { res.json({ processed: 0, created: 0, message: "No active job_created rules." }); return; }

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, Number(jobId)));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    let created = 0;
    for (const rule of rules) {
      const dup = await alreadyLogged("job_created", "job", job.id, runDate);
      if (dup) continue;
      const customer = await getCustomer(job.customerId);
      const vars = {
        customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Valued Customer",
        jobNumber: job.jobNumber,
        scheduledDate: job.scheduledDate ?? "TBD",
        serviceType: job.serviceType ?? "Window Cleaning",
      };
      const subject = rule.templateSubject ? interpolate(rule.templateSubject, vars) : null;
      const body = interpolate(rule.templateBody, vars);

      if (rule.channel === "email" && customer?.email) {
        // Create a campaign so delivery goes through the async queue
        await createCampaign({
          name:             `[Auto] ${rule.name} — Job ${job.jobNumber}`,
          subject:          subject ?? "Job Created",
          bodyHtml:         body,
          templateId:       rule.emailTemplateId ?? null,
          automationRuleId: rule.id,
          createdBy:        "automation-engine",
          recipients: [{
            entityType: "customer",
            entityId:   customer.id,
            email:      customer.email,
            firstName:  customer.firstName,
            lastName:   customer.lastName,
            companyName: customer.companyName,
          }],
        });
      } else {
        // Non-email channel: use legacy message_logs
        const recipient = recipientFor(customer, rule.channel);
        await createLog({ channel: rule.channel, triggerType: "job_created", relatedType: "job", relatedId: job.id, recipient, subject, body, runDate, customerId: customer?.id ?? null });
      }
      created++;
    }
    res.json({ processed: 1, created, message: `Processed job_created for job #${jobId}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to run job-created hook" });
  }
});

// ─── Run: Job Completed Hook ─────────────────────────────────────────────────

router.post("/automations/run/job-completed", async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) { res.status(400).json({ error: "jobId required" }); return; }
    const runDate = today();

    const rules = await db.select().from(automationRulesTable).where(
      and(eq(automationRulesTable.active, true), eq(automationRulesTable.triggerType, "job_completed"))
    );
    if (!rules.length) { res.json({ processed: 0, created: 0, message: "No active job_completed rules." }); return; }

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, Number(jobId)));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    let created = 0;
    for (const rule of rules) {
      const dup = await alreadyLogged("job_completed", "job", job.id, runDate);
      if (dup) continue;
      const customer = await getCustomer(job.customerId);
      const vars = {
        customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Valued Customer",
        jobNumber: job.jobNumber,
        completedAt: job.completedAt ?? today(),
        serviceType: job.serviceType ?? "Window Cleaning",
      };
      const subject = rule.templateSubject ? interpolate(rule.templateSubject, vars) : null;
      const body = interpolate(rule.templateBody, vars);

      if (rule.channel === "email" && customer?.email) {
        await createCampaign({
          name:             `[Auto] ${rule.name} — Job ${job.jobNumber}`,
          subject:          subject ?? "Thank you for your business",
          bodyHtml:         body,
          templateId:       rule.emailTemplateId ?? null,
          automationRuleId: rule.id,
          createdBy:        "automation-engine",
          recipients: [{
            entityType: "customer",
            entityId:   customer.id,
            email:      customer.email,
            firstName:  customer.firstName,
            lastName:   customer.lastName,
            companyName: customer.companyName,
          }],
        });
      } else {
        const recipient = recipientFor(customer, rule.channel);
        await createLog({ channel: rule.channel, triggerType: "job_completed", relatedType: "job", relatedId: job.id, recipient, subject, body, runDate, customerId: customer?.id ?? null });
      }
      created++;
    }
    res.json({ processed: 1, created, message: `Processed job_completed for job #${jobId}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to run job-completed hook" });
  }
});

export default router;
