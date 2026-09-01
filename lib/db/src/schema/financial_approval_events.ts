import { pgTable, serial, text, integer, timestamp, jsonb, index, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { financialApprovalPoliciesTable } from "./financial_approval_policies.ts";
import { financialApprovalRequestsTable } from "./financial_approval_requests.ts";

export const financialApprovalEventsTable = pgTable(
  "financial_approval_events",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id"),
    policyId: integer("policy_id"),
    eventType: text("event_type").notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name"),
    reason: text("reason"),
    note: text("note"),
    outcome: text("outcome"),
    resourceType: text("resource_type"),
    resourceId: integer("resource_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.requestId],
      foreignColumns: [financialApprovalRequestsTable.id],
      name: "financial_approval_events_request_fk",
    }),
    foreignKey({
      columns: [table.policyId],
      foreignColumns: [financialApprovalPoliciesTable.id],
      name: "financial_approval_events_policy_fk",
    }),
    check(
      "financial_approval_events_type_check",
      sql`${table.eventType} IN ('requested', 'policy_upserted', 'policy_deactivated', 'expired', 'cancelled', 'rejected', 'approved', 'executed')`,
    ),
    index("financial_approval_events_request_idx").on(table.requestId, table.id),
    index("financial_approval_events_policy_idx").on(table.policyId, table.id),
  ],
);

export type FinancialApprovalEvent = typeof financialApprovalEventsTable.$inferSelect;