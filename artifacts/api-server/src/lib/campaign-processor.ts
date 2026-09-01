/**
 * Campaign Processor
 *
 * Processes email campaigns in configurable batches.
 * Called by the in-process scheduler every CAMPAIGN_POLL_INTERVAL_MS
 * (default 30 s) to pick up queued campaigns and process failed recipients
 * that are eligible for retry.
 *
 * Architecture note:
 *   Replit runs a single persistent Node.js process. There are no separate
 *   background workers. This module runs inside the API server process via
 *   setInterval / node-cron. If the server restarts, in-flight campaigns are
 *   reset from 'processing' back to 'queued' on the next tick.
 */

import { db, emailCampaignsTable, emailCampaignRecipientsTable, emailLogsTable, activityLogsTable } from "@workspace/db";
import { eq, and, sql, lt, or, isNull } from "drizzle-orm";
import { sendEmailTo, renderTemplate, type TemplateVars } from "./email";
import { logger } from "./logger";
import { evaluateRecipientEligibility } from "./communication-safety-store";
import type { MessageClassification } from "./communication-safety-core";

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_BATCH_SIZE    = parseInt(process.env.EMAIL_BATCH_SIZE   ?? "50",  10);
const DEFAULT_MAX_RETRIES   = parseInt(process.env.EMAIL_MAX_RETRIES  ?? "3",   10);
const RETRY_COOLDOWN_MINUTES = parseInt(process.env.EMAIL_RETRY_COOLDOWN_MINUTES ?? "10", 10);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildVars(r: {
  firstName: string;
  lastName: string;
  companyName?: string | null;
  lastServiceType?: string | null;
  lastServiceDate?: string | null;
}): TemplateVars {
  return {
    first_name:        r.firstName,
    full_name:         `${r.firstName} ${r.lastName}`.trim(),
    company_name:      r.companyName ?? "",
    service_type:      r.lastServiceType ?? "",
    last_service_date: r.lastServiceDate
      ? new Date(r.lastServiceDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "",
  };
}

async function updateCampaignCounts(campaignId: number) {
  const [counts] = await db
    .select({
      queued:            sql<number>`COUNT(*) FILTER (WHERE status = 'queued')`,
      sent:              sql<number>`COUNT(*) FILTER (WHERE status = 'sent')`,
      failed:            sql<number>`COUNT(*) FILTER (WHERE status = 'failed')`,
      permanentlyFailed: sql<number>`COUNT(*) FILTER (WHERE status = 'permanently_failed')`,
    })
    .from(emailCampaignRecipientsTable)
    .where(eq(emailCampaignRecipientsTable.campaignId, campaignId));

  const q  = Number(counts.queued            ?? 0);
  const s  = Number(counts.sent              ?? 0);
  const f  = Number(counts.failed            ?? 0);
  const pf = Number(counts.permanentlyFailed ?? 0);
  const done = q === 0 && f === 0;

  let status: string;
  if (done && pf === 0) {
    status = "completed";
  } else if (done && pf > 0 && s > 0) {
    status = "partially_failed";
  } else if (done && s === 0 && pf > 0) {
    status = "failed";
  } else {
    status = "processing";
  }

  await db.update(emailCampaignsTable)
    .set({
      queuedCount:            q,
      sentCount:              s,
      failedCount:            f,
      permanentlyFailedCount: pf,
      status,
      completedAt: done ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(emailCampaignsTable.id, campaignId));

  return { status, queued: q, sent: s, failed: f, permanentlyFailed: pf };
}

// ─── Process a single campaign recipient ─────────────────────────────────────

async function processRecipient(
  recipientId: number,
  campaignId: number,
  campaign: {
    subject: string;
    bodyHtml: string;
    templateId: number | null;
    templateName: string | null;
    automationRuleId: number | null;
    classification: MessageClassification;
  },
  recipient: {
    email: string; firstName: string; lastName: string;
    companyName: string | null; lastServiceType: string | null;
    lastServiceDate: string | null; entityType: string | null;
    entityId: number | null; retryCount: number; maxRetries: number;
  },
) {
  const vars = buildVars(recipient);
  const renderedSubject  = renderTemplate(campaign.subject,  vars);
  const renderedBodyHtml = renderTemplate(campaign.bodyHtml, vars);
  const recipientName    = `${recipient.firstName} ${recipient.lastName}`.trim();

  const gate = await db.transaction(async (tx) => {
    const eligibility = await evaluateRecipientEligibility(tx, {
      customerId:
        recipient.entityType === "customer" ? recipient.entityId : null,
      channel: "email",
      rawDestination: recipient.email,
      classification: campaign.classification,
      requestedAt: new Date(),
      source: "email_campaign_processor",
      sourceEvent: `campaign:${campaignId}:recipient:${recipientId}`,
    });
    if (eligibility.outcome === "blocked") {
      await tx
        .update(emailCampaignRecipientsTable)
        .set({
          status: "skipped",
          safetyReasonCode: eligibility.reasonCode,
          errorMessage: `communication_safety:${eligibility.reasonCode}`,
          nextAttemptAt: null,
          updatedAt: new Date(),
        })
        .where(eq(emailCampaignRecipientsTable.id, recipientId));
      return { kind: "blocked" as const };
    }
    if (eligibility.outcome === "deferred") {
      await tx
        .update(emailCampaignRecipientsTable)
        .set({
          status: "queued",
          safetyReasonCode: eligibility.reasonCode,
          errorMessage: `communication_safety:${eligibility.reasonCode}`,
          nextAttemptAt: eligibility.allowedAt,
          updatedAt: new Date(),
        })
        .where(eq(emailCampaignRecipientsTable.id, recipientId));
      return { kind: "deferred" as const };
    }

    const [logRow] = await tx
      .insert(emailLogsTable)
      .values({
        entityType: recipient.entityType ?? null,
        entityId: recipient.entityId ?? null,
        templateId: campaign.templateId,
        templateName: campaign.templateName,
        campaignId,
        campaignRecipientId: recipientId,
        batchId: null,
        recipientEmail: recipient.email,
        recipientName,
        subject: renderedSubject,
        bodyHtml: renderedBodyHtml,
        status: "pending",
        retryCount: recipient.retryCount,
        maxRetries: recipient.maxRetries,
      })
      .returning();
    await tx
      .update(emailCampaignRecipientsTable)
      .set({
        status: "sending",
        safetyReasonCode: null,
        nextAttemptAt: null,
        emailLogId: logRow.id,
        updatedAt: new Date(),
      })
      .where(eq(emailCampaignRecipientsTable.id, recipientId));
    return { kind: "allowed" as const, logRow };
  });

  if (gate.kind !== "allowed") return gate;
  const { logRow } = gate;

  // Attempt send
  const result = await sendEmailTo(
    { email: recipient.email, name: recipientName },
    renderedSubject,
    renderedBodyHtml,
  );

  // Update log
  await db.update(emailLogsTable)
    .set({
      status:            result.success ? "sent" : "failed",
      provider:          result.provider,
      providerMessageId: result.messageId ?? null,
      errorMessage:      result.error ?? null,
      sentAt:            result.success ? new Date() : null,
    })
    .where(eq(emailLogsTable.id, logRow.id));

  // Determine recipient next status
  const nextRetryCount = recipient.retryCount + (result.success ? 0 : 1);
  const isPermanentlyFailed = !result.success && nextRetryCount >= recipient.maxRetries;

  await db.update(emailCampaignRecipientsTable)
    .set({
      status:       result.success ? "sent" : isPermanentlyFailed ? "permanently_failed" : "failed",
      retryCount:   nextRetryCount,
      lastRetryAt:  result.success ? null : new Date(),
      emailLogId:   logRow.id,
      errorMessage: result.error ?? null,
      safetyReasonCode: null,
      nextAttemptAt: null,
      updatedAt:    new Date(),
    })
    .where(eq(emailCampaignRecipientsTable.id, recipientId));

  // Write activity log entry if attached to an entity
  if (result.success && recipient.entityType && recipient.entityId) {
    const note = campaign.automationRuleId
      ? `[Auto] ${renderedSubject}`
      : renderedSubject;
    await db.insert(activityLogsTable).values({
      entityType: recipient.entityType as "customer" | "lead",
      entityId:   recipient.entityId,
      action:     "email_sent",
      toValue:    recipient.email,
      note,
      fromValue:  "sent",
    });
  }

  return result.success;
}

// ─── Main processing tick ─────────────────────────────────────────────────────

let _processing = false;

export async function processCampaigns(): Promise<void> {
  if (_processing) return;
  _processing = true;

  try {
    // Reset any campaigns stuck in 'processing' from a prior crash (re-queued by scheduler on startup)
    await db
      .update(emailCampaignRecipientsTable)
      .set({
        status: "failed",
        lastRetryAt: new Date(),
        errorMessage: "Recovered after campaign processor restart",
        updatedAt: new Date(),
      })
      .where(eq(emailCampaignRecipientsTable.status, "sending"));
    await db.update(emailCampaignsTable)
      .set({ status: "queued", updatedAt: new Date() })
      .where(
        and(
          eq(emailCampaignsTable.status, "processing"),
          // Only if no recipients are in 'sending' state (orphaned)
          sql`(
            SELECT COUNT(*) FROM email_campaign_recipients ecr
            WHERE ecr.campaign_id = email_campaigns.id AND ecr.status = 'sending'
          ) = 0`,
        )
      );

    // Find campaigns needing work
    const campaigns = await db
      .select()
      .from(emailCampaignsTable)
      .where(eq(emailCampaignsTable.status, "queued"))
      .limit(5);

    for (const campaign of campaigns) {
      // Mark processing
      await db.update(emailCampaignsTable)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(emailCampaignsTable.id, campaign.id));

      const batchSize = campaign.batchSize ?? DEFAULT_BATCH_SIZE;
      const retryDeadline = new Date(Date.now() - RETRY_COOLDOWN_MINUTES * 60 * 1000);

      // Get next batch: queued recipients, OR failed ones past cooldown window eligible for retry
      const batch = await db
        .select()
        .from(emailCampaignRecipientsTable)
        .where(
          and(
            eq(emailCampaignRecipientsTable.campaignId, campaign.id),
            or(
              and(
                eq(emailCampaignRecipientsTable.status, "queued"),
                or(
                  isNull(emailCampaignRecipientsTable.nextAttemptAt),
                  lt(emailCampaignRecipientsTable.nextAttemptAt, new Date()),
                ),
              ),
              and(
                eq(emailCampaignRecipientsTable.status, "failed"),
                sql`${emailCampaignRecipientsTable.retryCount} < ${emailCampaignRecipientsTable.maxRetries}`,
                or(
                  isNull(emailCampaignRecipientsTable.lastRetryAt),
                  lt(emailCampaignRecipientsTable.lastRetryAt, retryDeadline),
                ),
                or(
                  isNull(emailCampaignRecipientsTable.nextAttemptAt),
                  lt(emailCampaignRecipientsTable.nextAttemptAt, new Date()),
                ),
              ),
            ),
          )
        )
        .limit(batchSize);

      if (batch.length === 0) {
        // Nothing to do — finalize campaign
        await updateCampaignCounts(campaign.id);
        logger.info({ campaignId: campaign.id }, "Campaign finalized (no more recipients to process)");
        continue;
      }

      logger.info({ campaignId: campaign.id, batchSize: batch.length }, "Processing campaign batch");

      for (const r of batch) {
        try {
          await processRecipient(
            r.id,
            campaign.id,
            {
              subject:          campaign.subject,
              bodyHtml:         campaign.bodyHtml,
              templateId:       campaign.templateId,
              templateName:     campaign.templateName,
              automationRuleId: campaign.automationRuleId,
              classification: campaign.classification as MessageClassification,
            },
            {
              email:           r.email,
              firstName:       r.firstName,
              lastName:        r.lastName,
              companyName:     r.companyName,
              lastServiceType: r.lastServiceType,
              lastServiceDate: r.lastServiceDate,
              entityType:      r.entityType,
              entityId:        r.entityId,
              retryCount:      r.retryCount,
              maxRetries:      r.maxRetries ?? DEFAULT_MAX_RETRIES,
            },
          );
        } catch (err) {
          logger.error({ campaignId: campaign.id, recipientId: r.id, err }, "Error processing recipient");
          await db.update(emailCampaignRecipientsTable)
            .set({
              status:       "failed",
              retryCount:   r.retryCount + 1,
              lastRetryAt:  new Date(),
              errorMessage: err instanceof Error ? err.message : "Unknown error",
              updatedAt:    new Date(),
            })
            .where(eq(emailCampaignRecipientsTable.id, r.id));
        }
      }

      const counts = await updateCampaignCounts(campaign.id);
      logger.info({ campaignId: campaign.id, ...counts }, "Batch complete");

      // If still work to do, re-queue (next tick will pick it up)
      if (counts.queued > 0 || counts.failed > 0) {
        await db.update(emailCampaignsTable)
          .set({ status: "queued", updatedAt: new Date() })
          .where(eq(emailCampaignsTable.id, campaign.id));
      }
    }
  } catch (err) {
    logger.error({ err }, "Campaign processor tick failed");
  } finally {
    _processing = false;
  }
}

// ─── Create a campaign from a list of recipients ─────────────────────────────

export async function createCampaign(opts: {
  name: string;
  subject: string;
  bodyHtml: string;
  templateId?: number | null;
  templateName?: string | null;
  automationRuleId?: number | null;
  classification?: MessageClassification;
  createdBy?: string | null;
  batchSize?: number;
  maxRetries?: number;
  recipients: Array<{
    entityType?: string | null;
    entityId?: number | null;
    email: string;
    firstName: string;
    lastName: string;
    companyName?: string | null;
    lastServiceType?: string | null;
    lastServiceDate?: string | null;
  }>;
}): Promise<number> {
  return db.transaction((tx) => createCampaignWithTransaction(tx, opts));
}

export type CampaignTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function createCampaignWithTransaction(
  tx: CampaignTransaction,
  opts: {
    name: string;
    subject: string;
    bodyHtml: string;
    templateId?: number | null;
    templateName?: string | null;
    automationRuleId?: number | null;
    classification?: MessageClassification;
    createdBy?: string | null;
    batchSize?: number;
    maxRetries?: number;
    recipients: Array<{
      entityType?: string | null;
      entityId?: number | null;
      email: string;
      firstName: string;
      lastName: string;
      companyName?: string | null;
      lastServiceType?: string | null;
      lastServiceDate?: string | null;
    }>;
  },
): Promise<number> {
  const batchSize  = opts.batchSize  ?? DEFAULT_BATCH_SIZE;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  // Create campaign
  const [campaign] = await tx.insert(emailCampaignsTable).values({
    name:             opts.name,
    status:           "queued",
    totalRecipients:  opts.recipients.length,
    queuedCount:      opts.recipients.length,
    sentCount:        0,
    failedCount:      0,
    permanentlyFailedCount: 0,
    batchSize,
    templateId:       opts.templateId  ?? null,
    templateName:     opts.templateName ?? null,
    subject:          opts.subject,
    bodyHtml:         opts.bodyHtml,
    classification:   opts.classification ?? "transactional",
    automationRuleId: opts.automationRuleId ?? null,
    createdBy:        opts.createdBy ?? null,
  }).returning();

  // Insert recipients in chunks to avoid huge single inserts
  const chunkSize = 500;
  for (let i = 0; i < opts.recipients.length; i += chunkSize) {
    const chunk = opts.recipients.slice(i, i + chunkSize);
    await tx.insert(emailCampaignRecipientsTable).values(
      chunk.map((r) => ({
        campaignId:      campaign.id,
        entityType:      r.entityType ?? null,
        entityId:        r.entityId   ?? null,
        email:           r.email,
        firstName:       r.firstName,
        lastName:        r.lastName,
        companyName:     r.companyName     ?? null,
        lastServiceType: r.lastServiceType ?? null,
        lastServiceDate: r.lastServiceDate ?? null,
        status:          "queued",
        retryCount:      0,
        maxRetries,
      }))
    );
  }

  logger.info({ campaignId: campaign.id, total: opts.recipients.length }, "Campaign created");
  return campaign.id;
}
