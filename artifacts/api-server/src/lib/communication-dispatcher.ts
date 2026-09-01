import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  automationRulesTable,
  communicationEventAttemptsTable,
  communicationEventDeliveriesTable,
  communicationEventsTable,
  customersTable,
  invoicesTable,
  jobsTable,
  messageLogsTable,
  paymentsTable,
  quotesTable,
  recurringPlansTable,
} from "@workspace/db/schema";
import type { CommunicationEvent, AutomationRule } from "@workspace/db/schema";
import { createCampaignWithTransaction } from "./campaign-processor.js";
import {
  COMMUNICATION_LEASE_SECONDS,
  MAX_COMMUNICATION_DELIVERY_ATTEMPTS,
  communicationRetryDelaySeconds,
  communicationEventStatusFromDeliveryStatuses,
  eventAutomationTrigger,
} from "./communication-event-core.js";
import { parseCommunicationEventPayload } from "./communication-outbox.js";
import type { CommunicationTx } from "./communication-outbox-types.js";
import type { CommunicationEventType } from "./communication-event-types.js";
import { db } from "@workspace/db";
import {
  evaluateRecipientEligibility,
  maskCommunicationDestination,
} from "./communication-safety-store.js";
import { normalizeCommunicationDestination } from "./communication-safety-core.js";
import { businessDateStr } from "./date.ts";

type RawRow = Record<string, unknown>;

function rawRows(result: unknown): RawRow[] {
  if (Array.isArray(result)) return result as RawRow[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows: unknown[] }).rows ?? []) as RawRow[];
  }
  return [];
}

function asNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function today(): string {
  return businessDateStr();
}

function interpolate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    String(vars[key] ?? `{{${key}}}`),
  );
}

async function claimEventIds(
  tx: CommunicationTx,
  workerId: string,
  limit: number,
): Promise<number[]> {
  const result = await tx.execute(sql`
    WITH candidates AS (
      SELECT id
      FROM communication_events
      WHERE (
        status IN ('pending', 'retrying')
        AND available_at <= now()
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      ) OR (
        status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_at <= now() - interval '5 minutes'
      )
      ORDER BY id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE communication_events AS event
    SET status = 'processing',
        claimed_at = now(),
        claimed_by = ${workerId},
        attempt_count = event.attempt_count + 1,
        updated_at = now()
    FROM candidates
    WHERE event.id = candidates.id
    RETURNING event.id
  `);
  return rawRows(result)
    .map((row) => asNumber(row.id))
    .filter((id): id is number => id !== null);
}

export async function claimDelivery(
  tx: CommunicationTx,
  eventId: number,
  consumerKey: string,
  workerId: string,
): Promise<{ id: number; attemptNumber: number } | null> {
  await tx
    .insert(communicationEventDeliveriesTable)
    .values({ eventId, consumerKey, status: "pending", attemptCount: 0 })
    .onConflictDoNothing();

  const result = await tx.execute(sql`
    SELECT id, status, attempt_count, lease_until
    FROM communication_event_deliveries
    WHERE event_id = ${eventId} AND consumer_key = ${consumerKey}
    FOR UPDATE
  `);
  const row = rawRows(result)[0];
  if (!row) return null;
  const status = String(row.status);
  const leaseUntil = row.lease_until
    ? new Date(String(row.lease_until)).getTime()
    : 0;
  if (status === "succeeded" || status === "dead_letter") return null;
  if (status === "processing" && leaseUntil > Date.now()) return null;

  const attemptNumber = Number(row.attempt_count ?? 0) + 1;
  await tx
    .update(communicationEventDeliveriesTable)
    .set({
      status: "processing",
      attemptCount: attemptNumber,
      leaseUntil: new Date(Date.now() + COMMUNICATION_LEASE_SECONDS * 1000),
      claimedBy: workerId,
      lastError: null,
      retryAfterSeconds: null,
      updatedAt: new Date(),
    })
    .where(eq(communicationEventDeliveriesTable.id, Number(row.id)));
  await tx.insert(communicationEventAttemptsTable).values({
    deliveryId: Number(row.id),
    attemptNumber,
    status: "processing",
    startedAt: new Date(),
  });
  return { id: Number(row.id), attemptNumber };
}

async function getContext(tx: CommunicationTx, event: CommunicationEvent) {
  const payload = parseCommunicationEventPayload(event);
  let customerId = asNumber(payload.customerId);
  let relatedType = event.aggregateType;
  let relatedId = event.aggregateId;
  let related: Record<string, unknown> | null = null;

  if (event.aggregateType === "quote") {
    const [quote] = await tx
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.id, event.aggregateId));
    related = quote ?? null;
    customerId ??= quote?.customerId ?? null;
  } else if (event.aggregateType === "job") {
    const [job] = await tx
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, event.aggregateId));
    related = job ?? null;
    customerId ??= job?.customerId ?? null;
  } else if (event.aggregateType === "invoice") {
    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, event.aggregateId));
    related = invoice ?? null;
    customerId ??= invoice?.customerId ?? null;
  } else if (event.aggregateType === "payment") {
    const [payment] = await tx
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, event.aggregateId));
    related = payment ?? null;
    customerId ??= payment?.customerId ?? null;
  } else if (event.aggregateType === "recurring_plan") {
    const [plan] = await tx
      .select()
      .from(recurringPlansTable)
      .where(eq(recurringPlansTable.id, event.aggregateId));
    related = plan ?? null;
    customerId ??= plan?.customerId ?? null;
  }

  const [customer] = customerId
    ? await tx
        .select()
        .from(customersTable)
        .where(eq(customersTable.id, customerId))
    : [];
  const name = customer
    ? `${customer.firstName} ${customer.lastName}`
    : "Valued Customer";
  const vars: Record<string, string | number | null | undefined> = {
    customerName: name,
    quoteNumber:
      typeof related?.quoteNumber === "string"
        ? related.quoteNumber
        : undefined,
    jobNumber:
      typeof related?.jobNumber === "string" ? related.jobNumber : undefined,
    invoiceNumber:
      typeof related?.invoiceNumber === "string"
        ? related.invoiceNumber
        : undefined,
    scheduledDate:
      typeof related?.scheduledDate === "string"
        ? related.scheduledDate
        : (asString(payload.scheduledDate) ?? "TBD"),
    completedAt:
      typeof related?.completedAt === "string" ? related.completedAt : today(),
    serviceType:
      typeof related?.serviceType === "string"
        ? related.serviceType
        : "Window Cleaning",
    amount:
      typeof related?.amount === "string" || typeof related?.amount === "number"
        ? (related.amount as string | number)
        : undefined,
    paymentDate:
      typeof related?.paymentDate === "string"
        ? related.paymentDate
        : undefined,
    dueDate: typeof related?.dueDate === "string" ? related.dueDate : undefined,
    planName: typeof related?.name === "string" ? related.name : undefined,
    nextRunDate:
      typeof related?.nextRunDate === "string"
        ? related.nextRunDate
        : undefined,
  };

  return { customer, relatedType, relatedId, vars };
}

export async function executeRule(
  tx: CommunicationTx,
  event: CommunicationEvent,
  rule: AutomationRule,
): Promise<{ outcome: string; resultResourceId?: number | null }> {
  const context = await getContext(tx, event);
  const subject = rule.templateSubject
    ? interpolate(rule.templateSubject, context.vars)
    : null;
  const body = interpolate(rule.templateBody, context.vars);
  const customer = context.customer;
  const classification = [
    "days_after_last_service",
    "inactive_customer",
  ].includes(rule.triggerType)
    ? "marketing"
    : "transactional";
  const recipient =
    rule.channel === "email"
      ? (customer?.email ?? null)
      : rule.channel === "sms"
        ? (customer?.phone ?? null)
        : customer
          ? `customer_${customer.id}`
          : null;

  if (rule.channel === "email" && customer?.email) {
    const campaignId = await createCampaignWithTransaction(tx, {
      name: `[Auto] ${rule.name} — ${event.eventNumber}`,
      subject: subject ?? "Message from your window cleaning team",
      bodyHtml: body,
      templateId: rule.emailTemplateId ?? null,
      automationRuleId: rule.id,
      classification,
      createdBy: "communication-outbox",
      recipients: [
        {
          entityType: "customer",
          entityId: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          companyName: customer.companyName,
        },
      ],
    });
    return { outcome: "campaign_queued", resultResourceId: campaignId };
  }

  let safeRecipient = recipient;
  let safetyReasonCode: string | null = null;
  let status = recipient ? "not_dispatched" : "skipped";
  if (rule.channel === "sms") {
    const eligibility = await evaluateRecipientEligibility(tx, {
      customerId: customer?.id ?? null,
      channel: "sms",
      rawDestination: recipient,
      classification,
      requestedAt: new Date(),
      source: "communication_outbox",
      sourceEvent: `${event.eventType}:${event.id}:${rule.id}`,
    });
    safetyReasonCode = eligibility.reasonCode;
    status = eligibility.outcome === "eligible" ? "not_dispatched" : "skipped";
    if (recipient) {
      try {
        safeRecipient = maskCommunicationDestination(
          "sms",
          normalizeCommunicationDestination("sms", recipient).normalized,
        );
      } catch {
        safeRecipient = null;
      }
    }
  }

  const [log] = await tx
    .insert(messageLogsTable)
    .values({
      channel: rule.channel,
      triggerType: eventAutomationTrigger(
        event.eventType as CommunicationEventType,
      ),
      relatedType: context.relatedType,
      relatedId: context.relatedId,
      recipient: safeRecipient,
      subject,
      body: "[redacted]",
      status,
      safetyReasonCode,
      sentAt: null,
      runDate: today(),
    })
    .returning({ id: messageLogsTable.id });
  return {
    outcome: recipient ? "not_dispatched" : "missing_recipient",
    resultResourceId: log?.id ?? null,
  };
}

export async function completeDelivery(
  tx: CommunicationTx,
  deliveryId: number,
  attemptNumber: number,
  result: { outcome: string; resultResourceId?: number | null },
): Promise<void> {
  const now = new Date();
  await tx
    .update(communicationEventAttemptsTable)
    .set({
      status: "succeeded",
      finishedAt: now,
    })
    .where(
      and(
        eq(communicationEventAttemptsTable.deliveryId, deliveryId),
        eq(communicationEventAttemptsTable.attemptNumber, attemptNumber),
      ),
    );
  await tx
    .update(communicationEventDeliveriesTable)
    .set({
      status: "succeeded",
      leaseUntil: null,
      claimedBy: null,
      completedAt: now,
      outcome: result.outcome,
      resultResourceId: result.resultResourceId ?? null,
      updatedAt: now,
    })
    .where(eq(communicationEventDeliveriesTable.id, deliveryId));
}

export async function deferDelivery(
  tx: CommunicationTx,
  deliveryId: number,
  attemptNumber: number,
  allowedAt: Date,
  reasonCode: string,
): Promise<void> {
  const now = new Date();
  await tx
    .update(communicationEventAttemptsTable)
    .set({
      status: "skipped",
      finishedAt: now,
      error: `Deferred by communication safety: ${reasonCode}`.slice(0, 1000),
    })
    .where(
      and(
        eq(communicationEventAttemptsTable.deliveryId, deliveryId),
        eq(communicationEventAttemptsTable.attemptNumber, attemptNumber),
      ),
    );
  await tx
    .update(communicationEventDeliveriesTable)
    .set({
      status: "retrying",
      nextRetryAt: allowedAt,
      leaseUntil: null,
      claimedBy: null,
      lastError: null,
      retryAfterSeconds: null,
      outcome: `deferred:${reasonCode}`,
      updatedAt: now,
    })
    .where(eq(communicationEventDeliveriesTable.id, deliveryId));
}

export async function failDelivery(
  tx: CommunicationTx,
  deliveryId: number,
  attemptNumber: number,
  error: unknown,
): Promise<"retrying" | "dead_letter"> {
  const message =
    error instanceof Error ? error.message : "Automation consumer failed";
  const terminal = attemptNumber >= MAX_COMMUNICATION_DELIVERY_ATTEMPTS;
  const status = terminal ? "dead_letter" : "retrying";
  const retryAfterSeconds = terminal
    ? null
    : communicationRetryDelaySeconds(attemptNumber);
  const nextRetryAt = retryAfterSeconds
    ? new Date(Date.now() + retryAfterSeconds * 1000)
    : null;
  const now = new Date();
  await tx
    .update(communicationEventAttemptsTable)
    .set({
      status,
      finishedAt: now,
      error: message.slice(0, 1000),
      retryAfterSeconds,
    })
    .where(
      and(
        eq(communicationEventAttemptsTable.deliveryId, deliveryId),
        eq(communicationEventAttemptsTable.attemptNumber, attemptNumber),
      ),
    );
  await tx
    .update(communicationEventDeliveriesTable)
    .set({
      status,
      nextRetryAt,
      leaseUntil: null,
      claimedBy: null,
      lastError: message.slice(0, 1000),
      retryAfterSeconds,
      updatedAt: now,
    })
    .where(eq(communicationEventDeliveriesTable.id, deliveryId));
  return status;
}

async function processEvent(
  tx: CommunicationTx,
  event: CommunicationEvent,
  workerId: string,
): Promise<void> {
  const triggerType = eventAutomationTrigger(
    event.eventType as CommunicationEventType,
  );
  const rules = await tx
    .select()
    .from(automationRulesTable)
    .where(
      and(
        eq(automationRulesTable.active, true),
        eq(automationRulesTable.triggerType, triggerType),
      ),
    )
    .orderBy(automationRulesTable.id);

  if (!rules.length) {
    const claim = await claimDelivery(
      tx,
      event.id,
      "automation-rules",
      workerId,
    );
    if (claim)
      await completeDelivery(tx, claim.id, claim.attemptNumber, {
        outcome: "no_active_automation",
      });
    await tx
      .update(communicationEventsTable)
      .set({
        status: "succeeded",
        resultCode: "no_active_automation",
        completedAt: new Date(),
        claimedAt: null,
        claimedBy: null,
        nextRetryAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(communicationEventsTable.id, event.id));
    return;
  }

  const deliveryStatuses: Array<"succeeded" | "retrying" | "dead_letter"> = [];
  let nextRetryAt: Date | null = null;
  for (const rule of rules) {
    const claim = await claimDelivery(
      tx,
      event.id,
      `automation-rule:${rule.id}`,
      workerId,
    );
    if (!claim) continue;
    try {
      const context = await getContext(tx, event);
      const rawDestination =
        rule.channel === "email"
          ? context.customer?.email
          : rule.channel === "sms"
            ? (context.customer?.cellPhone ??
              context.customer?.homePhone ??
              context.customer?.phone)
            : null;
      if (rule.channel === "email" || rule.channel === "sms") {
        const classification =
          ["days_after_last_service", "inactive_customer"].includes(
            rule.triggerType,
          )
            ? "marketing"
            : "transactional";
        const eligibility = await evaluateRecipientEligibility(tx, {
          customerId: asNumber(context.customer?.id),
          channel: rule.channel,
          rawDestination,
          classification,
          requestedAt: new Date(),
          source: "communication-outbox",
          sourceEvent: event.eventType,
        });
        if (eligibility.outcome === "deferred" && eligibility.allowedAt) {
          await deferDelivery(
            tx,
            claim.id,
            claim.attemptNumber,
            eligibility.allowedAt,
            eligibility.reasonCode,
          );
          deliveryStatuses.push("retrying");
          if (!nextRetryAt || eligibility.allowedAt < nextRetryAt)
            nextRetryAt = eligibility.allowedAt;
          continue;
        }
        if (eligibility.outcome === "blocked") {
          await completeDelivery(tx, claim.id, claim.attemptNumber, {
            outcome: `eligibility_blocked:${eligibility.reasonCode}`,
          });
          deliveryStatuses.push("succeeded");
          continue;
        }
      }
      const result = await executeRule(tx, event, rule);
      await completeDelivery(tx, claim.id, claim.attemptNumber, result);
      deliveryStatuses.push("succeeded");
    } catch (error) {
      const status = await failDelivery(
        tx,
        claim.id,
        claim.attemptNumber,
        error,
      );
      deliveryStatuses.push(status);
      if (status === "retrying") {
        const retry = new Date(
          Date.now() +
            communicationRetryDelaySeconds(claim.attemptNumber) * 1000,
        );
        if (!nextRetryAt || retry < nextRetryAt) nextRetryAt = retry;
      }
    }
  }
  const eventStatus =
    communicationEventStatusFromDeliveryStatuses(deliveryStatuses);
  await tx
    .update(communicationEventsTable)
    .set({
      status: eventStatus,
      resultCode: eventStatus === "succeeded" ? "automation_processed" : null,
      completedAt: eventStatus === "succeeded" ? new Date() : null,
      nextRetryAt,
      claimedAt: null,
      claimedBy: null,
      lastError:
        eventStatus === "succeeded"
          ? null
          : "One or more automation consumers require attention",
      updatedAt: new Date(),
    })
    .where(eq(communicationEventsTable.id, event.id));
}

export async function processCommunicationOutbox(
  limit = 25,
  workerId = `worker-${randomUUID()}`,
): Promise<number> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const ids = await db.transaction((tx) =>
    claimEventIds(tx, workerId, safeLimit),
  );
  for (const eventId of ids) {
    await db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(communicationEventsTable)
        .where(eq(communicationEventsTable.id, eventId));
      if (event) await processEvent(tx, event, workerId);
    });
  }
  return ids.length;
}
