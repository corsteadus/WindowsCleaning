import { createInsertSchema } from "drizzle-zod";
import { foreignKey, index, integer, pgTable, serial, text, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { communicationEventsTable } from "./communication_events.ts";

export const COMMUNICATION_DELIVERY_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "retrying",
  "dead_letter",
] as const;

export const communicationEventDeliveriesTable = pgTable(
  "communication_event_deliveries",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    consumerKey: text("consumer_key").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    lastError: text("last_error"),
    retryAfterSeconds: integer("retry_after_seconds"),
    outcome: text("outcome"),
    resultResourceId: integer("result_resource_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [communicationEventsTable.id],
      name: "communication_event_deliveries_event_fk",
    }),
    uniqueIndex("communication_event_deliveries_event_consumer_idx").on(table.eventId, table.consumerKey),
    index("communication_event_deliveries_status_retry_idx").on(table.status, table.nextRetryAt, table.id),
    index("communication_event_deliveries_event_idx").on(table.eventId, table.id),
    check(
      "communication_event_deliveries_status_check",
      sql`${table.status} IN ('pending', 'processing', 'succeeded', 'retrying', 'dead_letter')`,
    ),
    check(
      "communication_event_deliveries_attempt_check",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);

export const insertCommunicationEventDeliverySchema = createInsertSchema(communicationEventDeliveriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCommunicationEventDelivery = z.infer<typeof insertCommunicationEventDeliverySchema>;
export type CommunicationEventDelivery = typeof communicationEventDeliveriesTable.$inferSelect;