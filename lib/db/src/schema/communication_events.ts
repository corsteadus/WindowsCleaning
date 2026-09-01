import { createInsertSchema } from "drizzle-zod";
import { jsonb, integer, index, pgTable, serial, text, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const COMMUNICATION_EVENT_TYPES = [
  "quote.sent",
  "quote.accepted",
  "appointment.scheduled",
  "appointment.changed",
  "job.completed",
  "invoice.sent",
  "payment.received",
  "recurring_plan.due",
] as const;

export const COMMUNICATION_EVENT_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "retrying",
  "dead_letter",
] as const;

export const communicationEventsTable = pgTable(
  "communication_events",
  {
    id: serial("id").primaryKey(),
    eventNumber: text("event_number").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: integer("aggregate_id").notNull(),
    canonicalPayload: jsonb("canonical_payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    actorId: text("actor_id"),
    source: text("source").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    correlationKey: text("correlation_key"),
    causationKey: text("causation_key"),
    idempotencyKey: text("idempotency_key"),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    lastError: text("last_error"),
    resultCode: text("result_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("communication_events_number_idx").on(table.eventNumber),
    uniqueIndex("communication_events_dedupe_idx").on(table.dedupeKey),
    index("communication_events_status_available_idx").on(table.status, table.availableAt, table.id),
    index("communication_events_type_occurred_idx").on(table.eventType, table.occurredAt, table.id),
    index("communication_events_aggregate_idx").on(table.aggregateType, table.aggregateId, table.id),
    check(
      "communication_events_type_check",
      sql`${table.eventType} IN ('quote.sent', 'quote.accepted', 'appointment.scheduled', 'appointment.changed', 'job.completed', 'invoice.sent', 'payment.received', 'recurring_plan.due')`,
    ),
    check(
      "communication_events_version_check",
      sql`${table.eventVersion} > 0`,
    ),
    check(
      "communication_events_status_check",
      sql`${table.status} IN ('pending', 'processing', 'succeeded', 'retrying', 'dead_letter')`,
    ),
    check(
      "communication_events_attempt_check",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);

export const insertCommunicationEventSchema = createInsertSchema(communicationEventsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCommunicationEvent = z.infer<typeof insertCommunicationEventSchema>;
export type CommunicationEvent = typeof communicationEventsTable.$inferSelect;