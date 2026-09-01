import { Router, type Request } from "express";
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import {
  communicationEventAttemptsTable,
  communicationEventAuditsTable,
  communicationEventDeliveriesTable,
  communicationEventsTable,
} from "@workspace/db/schema";
import { db } from "@workspace/db";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyContext,
  idempotencyConflictMessage,
  idempotencyInProgressMessage,
  markIdempotencyReplay,
  releaseIdempotencyKey,
} from "../lib/idempotency.js";
import { requireFinancialCapability } from "../lib/financial-permissions.js";
import { safeCommunicationPayloadSummary } from "../lib/communication-event-core.js";

const router = Router();
const viewEvents = requireFinancialCapability("automation_events.view");
const manageEvents = requireFinancialCapability("automation_events.manage");

function getActorId(req: Request): string {
  return req.user?.id ? String(req.user.id) : "unknown";
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDateFilter(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventView(row: typeof communicationEventsTable.$inferSelect) {
  return {
    id: row.id,
    eventNumber: row.eventNumber,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payloadHash: row.payloadHash,
    payloadSummary: safeCommunicationPayloadSummary(row.canonicalPayload),
    source: row.source,
    occurredAt: row.occurredAt,
    availableAt: row.availableAt,
    correlationKey: row.correlationKey,
    causationKey: row.causationKey,
    status: row.status,
    attemptCount: row.attemptCount,
    nextRetryAt: row.nextRetryAt,
    lastError: row.lastError,
    resultCode: row.resultCode,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get("/automation-events", viewEvents, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize, 25));
    const from = parseDateFilter(req.query.from);
    const to = parseDateFilter(req.query.to);
    if ((req.query.from && !from) || (req.query.to && !to)) {
      res.status(400).json({ error: "from and to must be valid dates" });
      return;
    }
    if (from && to && from > to) {
      res.status(400).json({ error: "from must be before or equal to to" });
      return;
    }
    const filters = [];
    if (req.query.status) filters.push(eq(communicationEventsTable.status, String(req.query.status)));
    if (req.query.eventType) filters.push(eq(communicationEventsTable.eventType, String(req.query.eventType)));
    if (req.query.aggregateType) filters.push(eq(communicationEventsTable.aggregateType, String(req.query.aggregateType)));
    if (from) filters.push(gte(communicationEventsTable.occurredAt, from));
    if (to) filters.push(lte(communicationEventsTable.occurredAt, to));
    if (req.query.search) {
      const search = `%${String(req.query.search).slice(0, 80)}%`;
      filters.push(or(
        ilike(communicationEventsTable.eventNumber, search),
        ilike(communicationEventsTable.aggregateType, search),
        ilike(communicationEventsTable.source, search),
        ilike(communicationEventsTable.correlationKey, search),
      ));
    }
    const where = filters.length ? and(...filters) : undefined;
    const [rows, countResult, summary] = await Promise.all([
      db.select().from(communicationEventsTable)
        .where(where)
        .orderBy(desc(communicationEventsTable.occurredAt), desc(communicationEventsTable.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ count: sql<number>`count(*)::int` }).from(communicationEventsTable).where(where),
      db.select({
        status: communicationEventsTable.status,
        count: sql<number>`count(*)::int`,
      }).from(communicationEventsTable).where(where).groupBy(communicationEventsTable.status),
    ]);
    const total = Number(countResult[0]?.count ?? 0);
    res.json({
      data: rows.map(eventView),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      counts: Object.fromEntries(summary.map((item) => [item.status, Number(item.count)])),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list automation events" });
  }
});

router.get("/automation-events/:id", viewEvents, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const [event] = await db.select().from(communicationEventsTable).where(eq(communicationEventsTable.id, id));
    if (!event) {
      res.status(404).json({ error: "Automation event not found" });
      return;
    }
    const deliveries = await db.select().from(communicationEventDeliveriesTable)
      .where(eq(communicationEventDeliveriesTable.eventId, id))
      .orderBy(asc(communicationEventDeliveriesTable.id));
    const attempts = deliveries.length
      ? await db.select().from(communicationEventAttemptsTable)
        .where(sql`${communicationEventAttemptsTable.deliveryId} IN (${sql.join(deliveries.map((delivery) => sql`${delivery.id}`), sql`, `)})`)
        .orderBy(desc(communicationEventAttemptsTable.createdAt), desc(communicationEventAttemptsTable.id))
      : [];
    const audits = await db.select().from(communicationEventAuditsTable)
      .where(eq(communicationEventAuditsTable.eventId, id))
      .orderBy(desc(communicationEventAuditsTable.createdAt), desc(communicationEventAuditsTable.id));
    res.json({ event: eventView(event), deliveries, attempts, audits });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch automation event" });
  }
});

router.get("/automation-events/:eventId/deliveries/:deliveryId/attempts", viewEvents, async (req, res) => {
  try {
    const eventId = parsePositiveInt(req.params.eventId, 0);
    const deliveryId = parsePositiveInt(req.params.deliveryId, 0);
    const [delivery] = await db.select().from(communicationEventDeliveriesTable).where(and(
      eq(communicationEventDeliveriesTable.id, deliveryId),
      eq(communicationEventDeliveriesTable.eventId, eventId),
    ));
    if (!delivery) {
      res.status(404).json({ error: "Automation delivery not found" });
      return;
    }
    const attempts = await db.select().from(communicationEventAttemptsTable)
      .where(eq(communicationEventAttemptsTable.deliveryId, deliveryId))
      .orderBy(desc(communicationEventAttemptsTable.attemptNumber), desc(communicationEventAttemptsTable.id));
    res.json({ delivery, attempts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list delivery attempts" });
  }
});

router.get("/automation-event-attempts/:id", viewEvents, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id, 0);
    const [attempt] = await db.select().from(communicationEventAttemptsTable).where(eq(communicationEventAttemptsTable.id, id));
    if (!attempt) {
      res.status(404).json({ error: "Automation attempt not found" });
      return;
    }
    res.json(attempt);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch automation attempt" });
  }
});

router.post("/automation-events/:id/retry", manageEvents, async (req, res) => {
  try {
    const eventId = parsePositiveInt(req.params.id, 0);
    const deliveryId = parsePositiveInt(req.body?.deliveryId, 0);
    if (!deliveryId) {
      res.status(400).json({ error: "deliveryId is required; retry-all is not supported" });
      return;
    }
    const idempotency = getIdempotencyContext(req, "automation_events.retry", { eventId, deliveryId });
    if (!idempotency) {
      res.status(400).json({ error: "Idempotency-Key is required for retry" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, idempotency);
      if (claim.kind !== "claimed") return claim;
      const [event] = await tx.select().from(communicationEventsTable).where(eq(communicationEventsTable.id, eventId));
      const [delivery] = await tx.select().from(communicationEventDeliveriesTable).where(and(
        eq(communicationEventDeliveriesTable.id, deliveryId),
        eq(communicationEventDeliveriesTable.eventId, eventId),
      ));
      if (!event || !delivery) {
        await releaseIdempotencyKey(tx, claim.record.id);
        return { kind: "notFound" as const };
      }
      if (!["retrying", "dead_letter"].includes(delivery.status)) {
        await releaseIdempotencyKey(tx, claim.record.id);
        return { kind: "invalidState" as const, status: delivery.status };
      }
      const now = new Date();
      await tx.update(communicationEventDeliveriesTable).set({
        status: "pending",
        nextRetryAt: now,
        leaseUntil: null,
        claimedBy: null,
        lastError: null,
        retryAfterSeconds: null,
        completedAt: null,
        updatedAt: now,
      }).where(eq(communicationEventDeliveriesTable.id, deliveryId));
      await tx.update(communicationEventsTable).set({
        status: "pending",
        availableAt: now,
        nextRetryAt: null,
        claimedAt: null,
        claimedBy: null,
        lastError: null,
        completedAt: null,
        updatedAt: now,
      }).where(eq(communicationEventsTable.id, eventId));
      await tx.insert(communicationEventAuditsTable).values({
        eventId,
        deliveryId,
        auditType: "retry_requested",
        actorId: getActorId(req),
        idempotencyKey: idempotency.clientKey,
        note: "Single consumer delivery manually requeued",
      });
      await completeIdempotencyKey(tx, claim.record.id, {
        resourceType: "communication_event",
        resourceId: eventId,
        responseStatus: 202,
      });
      return { kind: "queued" as const };
    });

    if (result.kind === "conflict") {
      res.status(409).json({ error: idempotencyConflictMessage() });
      return;
    }
    if (result.kind === "inProgress") {
      res.status(409).setHeader("Retry-After", "1").json({ error: idempotencyInProgressMessage() });
      return;
    }
    if (result.kind === "replay") {
      markIdempotencyReplay(res);
      res.status(result.record.responseStatus ?? 202).json({ queued: true, eventId });
      return;
    }
    if (result.kind === "notFound") {
      res.status(404).json({ error: "Automation event or delivery not found" });
      return;
    }
    if (result.kind === "invalidState") {
      res.status(409).json({ error: `Delivery is not retryable from ${result.status}` });
      return;
    }
    res.status(202).json({ queued: true, eventId, deliveryId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to retry automation delivery" });
  }
});

export default router;