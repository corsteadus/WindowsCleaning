import { pgTable, serial, text, numeric, boolean, timestamp, index, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const financialApprovalPoliciesTable = pgTable(
  "financial_approval_policies",
  {
    id: serial("id").primaryKey(),
    actionType: text("action_type").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    thresholdCents: numeric("threshold_cents", { precision: 18, scale: 0 }),
    distinctApprover: boolean("distinct_approver").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    changedBy: text("changed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "financial_approval_policies_action_check",
      sql`${table.actionType} IN ('refunds.record', 'invoices.credit', 'invoices.void', 'invoices.reissue', 'customer_credit.apply')`,
    ),
    check(
      "financial_approval_policies_threshold_check",
      sql`${table.thresholdCents} IS NULL OR ${table.thresholdCents} >= 0`,
    ),
    index("financial_approval_policies_action_idx").on(table.actionType),
    index("financial_approval_policies_active_idx").on(table.isActive),
    uniqueIndex("financial_approval_policies_one_active_action_idx")
      .on(table.actionType)
      .where(sql`${table.isActive} = true`),
  ],
);

export type FinancialApprovalPolicy = typeof financialApprovalPoliciesTable.$inferSelect;