import { pgTable, serial, text, integer, numeric, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const financialApprovalRequestsTable = pgTable(
  "financial_approval_requests",
  {
    id: serial("id").primaryKey(),
    approvalNumber: text("approval_number").notNull(),
    actionType: text("action_type").notNull(),
    status: text("status").notNull().default("pending"),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id"),
    targetIds: jsonb("target_ids").notNull(),
    canonicalPayload: jsonb("canonical_payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    amountCents: numeric("amount_cents", { precision: 18, scale: 0 }).notNull().default("0"),
    requesterId: text("requester_id").notNull(),
    requesterName: text("requester_name"),
    reason: text("reason").notNull(),
    policySnapshot: jsonb("policy_snapshot").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    executionResourceType: text("execution_resource_type"),
    executionResourceId: integer("execution_resource_id"),
  },
  (table) => [
    check(
      "financial_approval_requests_action_check",
      sql`${table.actionType} IN ('refunds.record', 'invoices.credit', 'invoices.void', 'invoices.reissue', 'customer_credit.apply')`,
    ),
    check(
      "financial_approval_requests_status_check",
      sql`${table.status} IN ('pending', 'expired', 'cancelled', 'rejected', 'executed')`,
    ),
    check(
      "financial_approval_requests_target_type_check",
      sql`${table.targetType} IN ('invoice', 'customer')`,
    ),
    check(
      "financial_approval_requests_amount_check",
      sql`${table.amountCents} >= 0`,
    ),
    check(
      "financial_approval_requests_target_ids_check",
      sql`jsonb_typeof(${table.targetIds}) = 'array' AND jsonb_array_length(${table.targetIds}) > 0`,
    ),
    check(
      "financial_approval_requests_target_id_check",
      sql`${table.targetId} IS NOT NULL`,
    ),
    check(
      "financial_approval_requests_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    uniqueIndex("financial_approval_requests_number_idx").on(table.approvalNumber),
    index("financial_approval_requests_status_idx").on(table.status),
    index("financial_approval_requests_action_idx").on(table.actionType),
    index("financial_approval_requests_requester_idx").on(table.requesterId),
    index("financial_approval_requests_created_idx").on(table.createdAt),
  ],
);

export type FinancialApprovalRequest = typeof financialApprovalRequestsTable.$inferSelect;