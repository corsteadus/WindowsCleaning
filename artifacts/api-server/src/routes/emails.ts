import { Router, type IRouter } from "express";
import { eq, desc, and, sql, or, ilike, isNull } from "drizzle-orm";
import { db, customersTable, leadsTable, jobsTable, invoicesTable, messageLogsTable, emailLogsTable, emailTemplatesTable, activityLogsTable } from "@workspace/db";
import { sendEmailTo, renderTemplate, type TemplateVars } from "../lib/email";
import { createCampaign } from "../lib/campaign-processor";
import {
  evaluateRecipientEligibility,
  maskCommunicationDestination,
} from "../lib/communication-safety-store";
import { normalizeCommunicationDestination } from "../lib/communication-safety-core";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyContext,
  markIdempotencyReplay,
} from "../lib/idempotency";
import { requireFinancialCapability } from "../lib/financial-permissions";
import { businessDateStr } from "../lib/date.ts";

const router: IRouter = Router();
const sendCommunication = requireFinancialCapability("communication.send");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function buildTemplateVars(record: {
  firstName: string;
  lastName: string;
  companyName?: string | null;
  lastServiceType?: string | null;
  lastServiceDate?: string | null;
}): TemplateVars {
  return {
    first_name: record.firstName,
    full_name: `${record.firstName} ${record.lastName}`.trim(),
    company_name: record.companyName ?? "",
    service_type: record.lastServiceType ?? "",
    last_service_date: record.lastServiceDate ? formatDate(record.lastServiceDate) : "",
  };
}

async function logEmailActivity(
  entityType: "customer" | "lead",
  entityId: number,
  subject: string,
  recipientEmail: string,
  status: string,
) {
  await db.insert(activityLogsTable).values({
    entityType,
    entityId,
    action: "email_sent",
    toValue: recipientEmail,
    note: subject,
    fromValue: status,
  });
}

async function resolveEmailEntityRecipient(input: {
  id?: unknown;
  entityId?: unknown;
  entityType?: unknown;
  email?: unknown;
}) {
  const entityType = input.entityType === "customer" || input.entityType === "lead"
    ? input.entityType
    : null;
  const entityId = Number(input.entityId ?? input.id);
  if (!entityType || !Number.isInteger(entityId) || entityId <= 0) {
    throw new Error("A valid customer or lead recipient is required");
  }
  const [record] = entityType === "customer"
    ? await db.select({
        id: customersTable.id,
        email: customersTable.email,
        firstName: customersTable.firstName,
        lastName: customersTable.lastName,
        companyName: customersTable.companyName,
      }).from(customersTable).where(eq(customersTable.id, entityId)).limit(1)
    : await db.select({
        id: leadsTable.id,
        email: leadsTable.email,
        firstName: leadsTable.firstName,
        lastName: leadsTable.lastName,
      }).from(leadsTable).where(eq(leadsTable.id, entityId)).limit(1);
  if (!record?.email) {
    throw new Error("Recipient record not found or has no email");
  }
  if (input.email != null) {
    const supplied = normalizeCommunicationDestination(
      "email",
      String(input.email),
    ).normalized;
    const canonical = normalizeCommunicationDestination(
      "email",
      record.email,
    ).normalized;
    if (supplied !== canonical) {
      throw new Error("Recipient email does not match the selected record");
    }
  }
  return {
    entityType,
    entityId,
    email: String(record.email),
    firstName: String(record.firstName ?? ""),
    lastName: String(record.lastName ?? ""),
    companyName:
      "companyName" in record && typeof record.companyName === "string"
        ? record.companyName
        : null,
  };
}

// ─── GET /emails/logs — all email logs (optionally filtered by entity) ────────
router.get("/emails/logs", async (req, res): Promise<void> => {
  const { entityType, entityId, batchId } = req.query;
  const conditions = [];
  if (entityType) conditions.push(eq(emailLogsTable.entityType, String(entityType)));
  if (entityId)   conditions.push(eq(emailLogsTable.entityId, parseInt(String(entityId), 10)));
  if (batchId)    conditions.push(eq(emailLogsTable.batchId, String(batchId)));

  const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await db
    .select()
    .from(emailLogsTable)
    .where(where)
    .orderBy(desc(emailLogsTable.createdAt))
    .limit(200);
  res.json({
    logs: rows.map(({ bodyHtml: _bodyHtml, recipientEmail, ...log }) => ({
      ...log,
      recipientEmail: recipientEmail
        ? (() => {
            try {
              const normalized = normalizeCommunicationDestination(
                "email",
                recipientEmail,
              ).normalized;
              return maskCommunicationDestination("email", normalized);
            } catch {
              return null;
            }
          })()
        : null,
    })),
  });
});

// ─── GET /emails/recipients — filtered recipient list ─────────────────────────
//
// Query params:
//   entityTypes  "customer" | "lead" | "both"   (default "both")
//   clientType   "residential" | "commercial"
//   status       "active" | "inactive"
//   city         text search on city field
//   state        text search on state field
//   serviceType  matches job service_type
//   noServiceDays  number — customers with no completed job in last N days
//   lastServiceBefore  ISO date string
//   lastServiceAfter   ISO date string
//   tags         comma-separated tags (customer must have at least one)
//   hasEmail     "true" to only return records with email addresses
router.get("/emails/recipients", async (req, res): Promise<void> => {
  const {
    entityTypes = "both",
    clientType,
    status,
    city,
    state,
    serviceType,
    noServiceDays,
    lastServiceBefore,
    lastServiceAfter,
    tags,
    hasEmail,
  } = req.query;

  const includeCustomers = entityTypes === "customer" || entityTypes === "both";
  const includeLeads     = entityTypes === "lead"     || entityTypes === "both";

  // ── Customer subquery: last completed job info per customer ─────────────────
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

  type Recipient = {
    id: number;
    entityType: "customer" | "lead";
    firstName: string;
    lastName: string;
    email: string | null;
    companyName: string | null;
    clientType: string | null;
    status: string | null;
    city: string | null;
    state: string | null;
    lastServiceDate: string | null;
    lastServiceType: string | null;
    tags: string | null;
  };

  const results: Recipient[] = [];

  // ── Customers ──────────────────────────────────────────────────────────────
  if (includeCustomers) {
    const conditions = [];

    if (hasEmail === "true") conditions.push(sql`${customersTable.email} IS NOT NULL AND ${customersTable.email} != ''`);
    if (clientType) conditions.push(eq(customersTable.clientType, String(clientType)));
    if (status)     conditions.push(eq(customersTable.status, String(status)));
    if (city)       conditions.push(ilike(customersTable.billingCity,  `%${String(city)}%`));
    if (state)      conditions.push(ilike(customersTable.billingState, `%${String(state)}%`));

    if (tags) {
      const tagList = String(tags).split(",").map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        const tagConditions = tagList.map((t) => ilike(customersTable.tags, `%${t}%`));
        conditions.push(or(...tagConditions)!);
      }
    }

    // Job-based filters — need to join
    const needsJobJoin = !!(serviceType || noServiceDays || lastServiceBefore || lastServiceAfter);

    if (needsJobJoin) {
      const baseWhere = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

      let rows = await db
        .select({
          id:              customersTable.id,
          firstName:       customersTable.firstName,
          lastName:        customersTable.lastName,
          email:           customersTable.email,
          companyName:     customersTable.companyName,
          clientType:      customersTable.clientType,
          status:          customersTable.status,
          city:            customersTable.billingCity,
          state:           customersTable.billingState,
          tags:            customersTable.tags,
          lastServiceDate: lastJobSq.lastServiceDate,
          lastServiceType: lastJobSq.lastServiceType,
        })
        .from(customersTable)
        .leftJoin(lastJobSq, eq(customersTable.id, lastJobSq.customerId))
        .where(baseWhere);

      // Post-join filters
      if (noServiceDays) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - parseInt(String(noServiceDays), 10));
        rows = rows.filter((r) => {
          if (!r.lastServiceDate) return true;
          return new Date(r.lastServiceDate) < cutoff;
        });
      }
      if (lastServiceBefore) {
        const cutoff = new Date(String(lastServiceBefore));
        rows = rows.filter((r) => {
          if (!r.lastServiceDate) return true;
          return new Date(r.lastServiceDate) < cutoff;
        });
      }
      if (lastServiceAfter) {
        const cutoff = new Date(String(lastServiceAfter));
        rows = rows.filter((r) => {
          if (!r.lastServiceDate) return false;
          return new Date(r.lastServiceDate) >= cutoff;
        });
      }
      if (serviceType) {
        const st = String(serviceType).toLowerCase();
        rows = rows.filter((r) => r.lastServiceType?.toLowerCase().includes(st));
      }

      for (const r of rows) {
        results.push({ ...r, entityType: "customer" });
      }
    } else {
      const baseWhere = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
      const rows = await db
        .select({
          id:              customersTable.id,
          firstName:       customersTable.firstName,
          lastName:        customersTable.lastName,
          email:           customersTable.email,
          companyName:     customersTable.companyName,
          clientType:      customersTable.clientType,
          status:          customersTable.status,
          city:            customersTable.billingCity,
          state:           customersTable.billingState,
          tags:            customersTable.tags,
          lastServiceDate: sql<string | null>`NULL`.as("last_service_date"),
          lastServiceType: sql<string | null>`NULL`.as("last_service_type"),
        })
        .from(customersTable)
        .where(baseWhere);
      for (const r of rows) {
        results.push({ ...r, entityType: "customer" });
      }
    }
  }

  // ── Leads ──────────────────────────────────────────────────────────────────
  if (includeLeads) {
    const conditions = [];
    if (hasEmail === "true") conditions.push(sql`${leadsTable.email} IS NOT NULL AND ${leadsTable.email} != ''`);
    if (clientType) conditions.push(eq(leadsTable.clientType, String(clientType)));
    if (city)       conditions.push(ilike(leadsTable.city, `%${String(city)}%`));
    if (state)      conditions.push(ilike(leadsTable.state, `%${String(state)}%`));
    if (status) {
      conditions.push(eq(leadsTable.status, String(status)));
    } else {
      conditions.push(sql`${leadsTable.status} NOT IN ('converted', 'lost')`);
    }

    const baseWhere = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
    const rows = await db
      .select({
        id:              leadsTable.id,
        firstName:       leadsTable.firstName,
        lastName:        leadsTable.lastName,
        email:           leadsTable.email,
        clientType:      leadsTable.clientType,
        status:          leadsTable.status,
        city:            leadsTable.city,
        state:           leadsTable.state,
      })
      .from(leadsTable)
      .where(baseWhere);

    for (const r of rows) {
      results.push({
        ...r,
        entityType:      "lead",
        companyName:     null,
        tags:            null,
        lastServiceDate: null,
        lastServiceType: null,
      });
    }
  }

  res.json({ recipients: results, total: results.length });
});

// ─── POST /emails/send — create an async campaign for one or more recipients ──
//
// For single-recipient sends from detail pages, use /emails/send-one instead.
// This endpoint always creates a campaign and returns immediately — the
// campaign processor handles actual delivery asynchronously.
//
// Body:
//   recipients: [{ id, entityType, email, firstName, lastName, companyName?, lastServiceDate?, lastServiceType? }]
//   templateId?: number    (if provided, subject/bodyHtml are fetched from DB)
//   subject?: string       (used if no templateId)
//   bodyHtml?: string      (used if no templateId)
//   campaignName?: string  (optional friendly name)
router.post("/emails/send", sendCommunication, async (req, res): Promise<void> => {
  const { recipients, templateId, subject: manualSubject, bodyHtml: manualBodyHtml, campaignName } = req.body;
  const classification =
    req.body.classification === undefined ? "marketing" : req.body.classification;
  if (classification !== "marketing" && classification !== "transactional") {
    res.status(400).json({ error: "classification must be marketing or transactional" });
    return;
  }

  if (!Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: "recipients must be a non-empty array" });
    return;
  }

  let templateSubject: string | null = null;
  let templateBodyHtml: string | null = null;
  let templateName: string | null = null;
  let resolvedTemplateId: number | null = null;

  if (templateId) {
    const [tpl] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.id, parseInt(String(templateId), 10)))
      .limit(1);
    if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }
    templateSubject    = tpl.subject;
    templateBodyHtml   = tpl.bodyHtml;
    templateName       = tpl.name;
    resolvedTemplateId = tpl.id;
  } else if (manualSubject && manualBodyHtml) {
    templateSubject  = manualSubject;
    templateBodyHtml = manualBodyHtml;
  } else {
    res.status(400).json({ error: "Provide either templateId or subject+bodyHtml" });
    return;
  }

  let validRecipients: Awaited<
    ReturnType<typeof resolveEmailEntityRecipient>
  >[];
  try {
    validRecipients = await Promise.all(
      recipients.map(resolveEmailEntityRecipient),
    );
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid recipient",
    });
    return;
  }

  const name = campaignName
    ?? (templateName ? `${templateName}` : `Bulk Send`)
    + ` — ${new Date().toLocaleDateString("en-US")}`;

  const campaignId = await createCampaign({
    name,
    subject:      templateSubject!,
    bodyHtml:     templateBodyHtml!,
    templateId:   resolvedTemplateId,
    templateName,
    classification,
    createdBy:    null,
    recipients: validRecipients.map((r) => ({
      entityType:      r.entityType,
      entityId:        r.entityId,
      email:           r.email,
      firstName:       r.firstName,
      lastName:        r.lastName,
      companyName:     r.companyName,
    })),
  });

  res.status(202).json({
    campaignId,
    queued:  validRecipients.length,
    skipped: 0,
    status:  "queued",
    message: `Campaign created with ${validRecipients.length} recipients. Processing starts within 30 seconds.`,
  });
});

// ─── POST /emails/send-one — send a single one-off email from detail pages ───
//
// Body: { entityType, entityId, email, firstName, lastName, subject, bodyHtml }
router.post("/emails/send-one", sendCommunication, async (req, res): Promise<void> => {
  const { entityType, entityId, email, firstName, lastName, subject, bodyHtml, relatedType, relatedId } = req.body;

  if (!email || !subject || !bodyHtml) {
    res.status(400).json({ error: "email, subject, and bodyHtml are required" });
    return;
  }

  const vars = buildTemplateVars({ firstName: firstName ?? "", lastName: lastName ?? "" });
  const renderedSubject  = renderTemplate(String(subject),  vars);
  const renderedBodyHtml = renderTemplate(String(bodyHtml), vars);

  let recipient: Awaited<ReturnType<typeof resolveEmailEntityRecipient>>;
  try {
    recipient = await resolveEmailEntityRecipient({
      entityType,
      entityId,
      email,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid recipient",
    });
    return;
  }
  let communicationRelation: { relatedType: "customer" | "invoice"; relatedId: number };
  if (relatedType === "invoice") {
    const invoiceId = Number(relatedId);
    const [invoice] = await db.select({ id: invoicesTable.id, customerId: invoicesTable.customerId })
      .from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
    if (!invoice || recipient.entityType !== "customer" || invoice.customerId !== recipient.entityId) {
      res.status(400).json({ error: "Invoice communication must belong to the resolved customer" });
      return;
    }
    communicationRelation = { relatedType: "invoice", relatedId: invoice.id };
  } else {
    communicationRelation = { relatedType: "customer", relatedId: recipient.entityId };
  }
  const idempotency = getIdempotencyContext(req, "emails.send-one", {
    entityType: recipient.entityType,
    entityId: recipient.entityId,
    subject: renderedSubject,
    bodyHtml: renderedBodyHtml,
    relatedType: communicationRelation.relatedType,
    relatedId: communicationRelation.relatedId,
  });
  if (!idempotency) {
    res.status(400).json({
      error: "Idempotency-Key header is required",
      code: "idempotency_key_required",
    });
    return;
  }

  const safety = await db.transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, idempotency);
    if (claim.kind !== "claimed") return { kind: claim.kind, claim };
    const eligibility = await evaluateRecipientEligibility(tx, {
      customerId:
        recipient.entityType === "customer"
          ? recipient.entityId
          : null,
      channel: "email",
      rawDestination: recipient.email,
      classification: "transactional",
      requestedAt: new Date(),
      source: "emails.send_one",
      sourceEvent: `email-send-one:${recipient.entityType}:${recipient.entityId}`,
    });
    if (eligibility.outcome !== "eligible") {
      await completeIdempotencyKey(tx, claim.record.id, {
        resourceType: "communication_safety_decision",
        resourceId: recipient.entityId,
        responseStatus: eligibility.outcome === "blocked" ? 422 : 409,
      });
      return {
        kind: "completed" as const,
        claim,
        eligibility,
        logRow: null,
      };
    }
    const [logRow] = await tx.insert(emailLogsTable).values({
      entityType:     recipient.entityType,
      entityId:       recipient.entityId,
      templateId:     null,
      templateName:   null,
      batchId:        null,
      recipientEmail: recipient.email,
      recipientName:  `${recipient.firstName} ${recipient.lastName}`.trim(),
      subject:        renderedSubject,
      bodyHtml:       renderedBodyHtml,
      status:         "pending",
    }).returning();
    return { kind: "claimed" as const, claim, eligibility, logRow };
  });

  if (safety.kind === "conflict") {
    res.status(409).json({
      error: "This Idempotency-Key was already used with a different request",
      code: "idempotency_conflict",
    });
    return;
  }
  if (safety.kind === "inProgress") {
    res.status(409).json({
      error: "A request with this Idempotency-Key is already in progress",
      code: "idempotency_in_progress",
    });
    return;
  }
  if (safety.kind === "replay") {
    markIdempotencyReplay(res);
    res.json({ status: "already_recorded" });
    return;
  }
  if (!("eligibility" in safety)) {
    res.status(500).json({ error: "Email safety decision could not be created" });
    return;
  }
  const eligibility = safety.eligibility;
  if (!eligibility) {
    res.status(500).json({ error: "Email safety decision could not be created" });
    return;
  }
  if (eligibility.outcome === "blocked") {
    res.status(422).json({
      sent: 0,
      failed: 0,
      skipped: 1,
      reasonCode: eligibility.reasonCode,
    });
    return;
  }
  if (eligibility.outcome === "deferred") {
    res.status(409).json({
      sent: 0,
      failed: 0,
      deferred: 1,
      reasonCode: eligibility.reasonCode,
      allowedAt: eligibility.allowedAt,
      message: "Quiet hours are active; no message was queued.",
    });
    return;
  }
  const logRow = safety.logRow;
  if (!logRow) {
    res.status(500).json({ error: "Email log could not be created" });
    return;
  }

  const result = await sendEmailTo(
    { email: recipient.email, name: `${recipient.firstName} ${recipient.lastName}`.trim() },
    renderedSubject,
    renderedBodyHtml,
  );

  await db.update(emailLogsTable).set({
    status:            result.success ? "sent" : "failed",
    provider:          result.provider,
    providerMessageId: result.messageId ?? null,
    errorMessage:      result.error ?? null,
    sentAt:            result.success ? new Date() : null,
  }).where(eq(emailLogsTable.id, logRow.id));

  await db.transaction(async (tx) => {
    await tx.insert(messageLogsTable).values({
      channel: "email",
      triggerType: "manual",
      relatedType: communicationRelation.relatedType,
      relatedId: communicationRelation.relatedId,
      recipient: maskCommunicationDestination("email", recipient.email),
      subject: renderedSubject,
      body: "[redacted]",
      status: result.success ? "sent" : "failed",
      sentAt: result.success ? new Date().toISOString() : null,
      runDate: businessDateStr(),
    });
    await completeIdempotencyKey(tx, safety.claim.record.id, {
      resourceType: "email_log",
      resourceId: logRow.id,
      responseStatus: result.success ? 200 : 500,
    });
  });

  if (recipient.entityType && recipient.entityId) {
    await logEmailActivity(
      recipient.entityType as "customer" | "lead",
      recipient.entityId,
      renderedSubject,
      recipient.email,
      result.success ? "sent" : "failed",
    );
  }

  if (!result.success) {
    res.status(500).json({ error: result.error ?? "Send failed" });
    return;
  }

  res.json({ sent: 1, failed: 0, provider: result.provider });
});

// ─── POST /emails/preview — render template vars without sending ──────────────
router.post("/emails/preview", async (req, res): Promise<void> => {
  const { templateId, subject: manualSubject, bodyHtml: manualBodyHtml, sampleRecipient } = req.body;

  let subject  = manualSubject  as string;
  let bodyHtml = manualBodyHtml as string;

  if (templateId) {
    const [tpl] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.id, parseInt(String(templateId), 10)))
      .limit(1);
    if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }
    subject  = tpl.subject;
    bodyHtml = tpl.bodyHtml;
  }

  const vars = buildTemplateVars(sampleRecipient ?? {
    firstName: "John",
    lastName: "Smith",
    companyName: "Smith Property Management",
    lastServiceType: "Window Cleaning",
    lastServiceDate: new Date().toISOString(),
  });

  res.json({
    subject:  renderTemplate(subject,  vars),
    bodyHtml: renderTemplate(bodyHtml, vars),
  });
});

export default router;
