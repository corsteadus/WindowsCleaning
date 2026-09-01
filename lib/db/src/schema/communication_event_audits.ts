import { createInsertSchema } from "drizzle-zod";
import { foreignKey, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { communicationEventDeliveriesTable } from "./communication_event_deliveries.ts";
import { communicationEventsTable } from "./communication_events.ts";

export const communicationEventAuditsTable = pgTable(
  "communication_event_audits",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    deliveryId: integer("delivery_id"),
    auditType: text("audit_type").notNull(),
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [communicationEventsTable.id],
      name: "communication_event_audits_event_fk",
    }),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [communicationEventDeliveriesTable.id],
      name: "communication_event_audits_delivery_fk",
    }),
    index("communication_event_audits_event_idx").on(table.eventId, table.id),
  ],
);

export const insertCommunicationEventAuditSchema = createInsertSchema(communicationEventAuditsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommunicationEventAudit = z.infer<typeof insertCommunicationEventAuditSchema>;
export type CommunicationEventAudit = typeof communicationEventAuditsTable.$inferSelect;