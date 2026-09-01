import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import {
  communicationEventsTable,
  type CommunicationEvent,
} from "@workspace/db";
import type { CommunicationTx } from "./communication-outbox-types.ts";
import type { CommunicationEventType } from "./communication-event-types.ts";
import {
  canonicalCommunicationPayload,
  communicationPayloadHash,
  CommunicationEventValidationError,
  stableCommunicationValue,
} from "./communication-event-core.ts";

export type CommunicationEventInput = {
  eventType: CommunicationEventType;
  aggregateType: string;
  aggregateId: number;
  payload: Record<string, unknown>;
  source: string;
  actorId?: string | null;
  occurredAt?: Date;
  availableAt?: Date;
  correlationKey?: string | null;
  causationKey?: string | null;
  idempotencyKey?: string | null;
  dedupeKey?: string;
};

export function communicationEventDedupeKey(input: CommunicationEventInput): string {
  return input.dedupeKey
    ?? `${input.eventType}:${input.aggregateType}:${input.aggregateId}:${input.causationKey ?? input.idempotencyKey ?? communicationPayloadHash(input.payload)}`;
}

export async function enqueueCommunicationEvent(
  tx: CommunicationTx,
  input: CommunicationEventInput,
): Promise<CommunicationEvent> {
  if (!Number.isInteger(input.aggregateId) || input.aggregateId <= 0) {
    throw new CommunicationEventValidationError("invalid_aggregate_id", "Communication events require a positive aggregate id");
  }
  const payload = stableCommunicationValue(input.payload);
  const dedupeKey = communicationEventDedupeKey(input);
  const [inserted] = await tx
    .insert(communicationEventsTable)
    .values({
      eventNumber: `CE-${randomUUID()}`,
      eventType: input.eventType,
      eventVersion: 1,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      canonicalPayload: payload,
      payloadHash: communicationPayloadHash(payload),
      actorId: input.actorId ?? null,
      source: input.source,
      occurredAt: input.occurredAt ?? new Date(),
      availableAt: input.availableAt ?? new Date(),
      correlationKey: input.correlationKey ?? null,
      causationKey: input.causationKey ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      dedupeKey,
      status: "pending",
      attemptCount: 0,
    })
    .onConflictDoNothing({ target: communicationEventsTable.dedupeKey })
    .returning();

  if (inserted) return inserted;
  const [existing] = await tx
    .select()
    .from(communicationEventsTable)
    .where(eq(communicationEventsTable.dedupeKey, dedupeKey))
    .limit(1);
  if (!existing) throw new Error("Communication event disappeared after dedupe conflict");
  return existing;
}

export function parseCommunicationEventPayload(event: CommunicationEvent): Record<string, unknown> {
  const payload = event.canonicalPayload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

export function communicationEventPayloadJson(event: CommunicationEvent): string {
  return canonicalCommunicationPayload(parseCommunicationEventPayload(event));
}

export async function recoverExpiredCommunicationLeases(
  tx: CommunicationTx,
  now: Date = new Date(),
): Promise<number> {
  const result = await tx
    .update(communicationEventsTable)
    .set({
      status: "retrying",
      nextRetryAt: now,
      claimedAt: null,
      claimedBy: null,
      lastError: "Dispatcher lease expired; event returned to retry queue",
      updatedAt: now,
    })
    .where(and(
      eq(communicationEventsTable.status, "processing"),
      lte(communicationEventsTable.claimedAt, new Date(now.getTime() - 300_000)),
    ));
  return Number((result as unknown as { rowCount?: number }).rowCount ?? 0);
}