import { createInsertSchema } from "drizzle-zod";
import { foreignKey, index, integer, pgTable, serial, text, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { communicationEventDeliveriesTable } from "./communication_event_deliveries.ts";

export const communicationEventAttemptsTable = pgTable(
  "communication_event_attempts",
  {
    id: serial("id").primaryKey(),
    deliveryId: integer("delivery_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    retryAfterSeconds: integer("retry_after_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [communicationEventDeliveriesTable.id],
      name: "communication_event_attempts_delivery_fk",
    }),
    uniqueIndex("communication_event_attempts_delivery_number_idx").on(table.deliveryId, table.attemptNumber),
    index("communication_event_attempts_delivery_created_idx").on(table.deliveryId, table.createdAt, table.id),
    check(
      "communication_event_attempts_status_check",
      sql`${table.status} IN ('processing', 'succeeded', 'retrying', 'dead_letter', 'skipped')`,
    ),
    check(
      "communication_event_attempts_number_check",
      sql`${table.attemptNumber} > 0`,
    ),
  ],
);

export const insertCommunicationEventAttemptSchema = createInsertSchema(communicationEventAttemptsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommunicationEventAttempt = z.infer<typeof insertCommunicationEventAttemptSchema>;
export type CommunicationEventAttempt = typeof communicationEventAttemptsTable.$inferSelect;