import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import {
  db,
  financialApprovalEventsTable,
  financialApprovalPoliciesTable,
  financialApprovalRequestsTable,
} from "@workspace/db";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
} from "./idempotency.js";
import {
  actorName,
  type FinancialCapability,
} from "./financial-permissions.js";
import {
  approvalPayloadHash,
  approvalRequired,
  canonicalApprovalPayload,
  FinancialApprovalValidationError,
  FINANCIAL_APPROVAL_ACTIONS,
  parseApprovalAmountCents,
  stableApprovalValue,
  type FinancialApprovalAction,
  type ApprovalPolicySnapshot,
} from "./financial-approval-pure.js";

export {
  approvalPayloadHash,
  approvalRequired,
  canonicalApprovalPayload,
  FinancialApprovalValidationError,
  FINANCIAL_APPROVAL_ACTIONS,
  parseApprovalAmountCents,
  type FinancialApprovalAction,
  type ApprovalPolicySnapshot,
} from "./financial-approval-pure.js";

function policySnapshot(row: typeof financialApprovalPoliciesTable.$inferSelect): ApprovalPolicySnapshot {
  return {
    policyId: row.id,
    actionType: row.actionType as FinancialApprovalAction,
    enabled: row.enabled,
    thresholdCents: row.thresholdCents == null ? null : String(row.thresholdCents),
    distinctApprover: row.distinctApprover,
  };
}

export function serializeApprovalRequest(
  row: typeof financialApprovalRequestsTable.$inferSelect,
) {
  return {
    id: row.id,
    approvalNumber: row.approvalNumber,
    actionType: row.actionType,
    status: row.status,
    targetType: row.targetType,
    targetId: row.targetId,
    targetIds: row.targetIds,
    canonicalPayload: row.canonicalPayload,
    payloadHash: row.payloadHash,
    amountCents: String(row.amountCents),
    amount: `${BigInt(String(row.amountCents)) / 100n}.${(BigInt(String(row.amountCents)) % 100n).toString().padStart(2, "0")}`,
    requesterId: row.requesterId,
    requesterName: row.requesterName,
    reason: row.reason,
    policySnapshot: row.policySnapshot,
    expiresAt: row.expiresAt.toISOString(),
    decidedBy: row.decidedBy,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    executionResourceType: row.executionResourceType,
    executionResourceId: row.executionResourceId,
  };
}

export function serializeApprovalEvent(row: typeof financialApprovalEventsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

async function activePolicy(
  tx: typeof db,
  actionType: FinancialApprovalAction,
): Promise<ApprovalPolicySnapshot | null> {
  const [policy] = await tx
    .select()
    .from(financialApprovalPoliciesTable)
    .where(and(
      eq(financialApprovalPoliciesTable.actionType, actionType),
      eq(financialApprovalPoliciesTable.isActive, true),
    ))
    .orderBy(desc(financialApprovalPoliciesTable.id))
    .limit(1);
  return policy ? policySnapshot(policy) : null;
}

export async function getActiveFinancialApprovalPolicy(
  actionType: FinancialApprovalAction,
): Promise<ApprovalPolicySnapshot | null> {
  const [policy] = await db
    .select()
    .from(financialApprovalPoliciesTable)
    .where(and(
      eq(financialApprovalPoliciesTable.actionType, actionType),
      eq(financialApprovalPoliciesTable.isActive, true),
    ))
    .orderBy(desc(financialApprovalPoliciesTable.id))
    .limit(1);
  return policy ? policySnapshot(policy) : null;
}

export async function lockFinancialApprovalAction(
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  actionType: FinancialApprovalAction,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(4, hashtext(${actionType}))`);
}

export type SubmitApprovalInput = {
  req: Request;
  actionType: FinancialApprovalAction;
  targetType: string;
  targetIds: number[];
  canonicalPayload: unknown;
  amountCents: bigint;
  reason: string;
};

export type SubmitApprovalResult =
  | { kind: "not_required" }
  | { kind: "created"; request: ReturnType<typeof serializeApprovalRequest> }
  | { kind: "replay"; request: ReturnType<typeof serializeApprovalRequest> }
  | { kind: "conflict" }
  | { kind: "inProgress" };

export async function submitFinancialApproval(
  input: SubmitApprovalInput,
): Promise<SubmitApprovalResult> {
  if (!input.req.user) {
    throw new FinancialApprovalValidationError("unauthorized", "Authentication is required");
  }
  const user = input.req.user;
  const reason = input.reason.trim();
  if (!reason) {
    throw new FinancialApprovalValidationError("reason_required", "A reason is required");
  }

  const clientKey = input.req.get("Idempotency-Key")?.trim() ?? "";
  const payloadHash = approvalPayloadHash(input.canonicalPayload);
  const requestHash = approvalPayloadHash({
    actionType: input.actionType,
    targetType: input.targetType,
    targetIds: input.targetIds,
    payloadHash,
    amountCents: input.amountCents.toString(),
    reason,
  });

  return db.transaction(async (tx) => {
    await lockFinancialApprovalAction(tx, input.actionType);
    const policyRows = await tx
      .select()
      .from(financialApprovalPoliciesTable)
      .where(and(
        eq(financialApprovalPoliciesTable.actionType, input.actionType),
        eq(financialApprovalPoliciesTable.isActive, true),
      ))
      .orderBy(desc(financialApprovalPoliciesTable.id))
      .limit(1);
    const policy = policyRows[0] ? policySnapshot(policyRows[0]) : null;
    if (!approvalRequired(policy, input.amountCents)) return { kind: "not_required" as const };
    if (!clientKey) {
      throw new FinancialApprovalValidationError(
        "idempotency_key_required",
        "Idempotency-Key header is required when an action requires approval",
      );
    }
    if (clientKey.length > 255) {
      throw new FinancialApprovalValidationError(
        "idempotency_key_invalid",
        "Idempotency-Key must be 255 characters or fewer",
      );
    }

    const claim = await claimIdempotencyKey(tx, {
      scope: `user:${user.id}`,
      operation: `financial_approval.request.${input.actionType}`,
      clientKey,
      requestHash,
    });
    if (claim.kind === "conflict") return { kind: "conflict" as const };
    if (claim.kind === "inProgress") return { kind: "inProgress" as const };
    if (claim.kind === "replay") {
      const [existing] = await tx
        .select()
        .from(financialApprovalRequestsTable)
        .where(eq(financialApprovalRequestsTable.id, claim.record.resourceId!));
      if (!existing) {
        throw new FinancialApprovalValidationError(
          "approval_request_missing",
          "The idempotent approval request no longer exists",
        );
      }
      return { kind: "replay" as const, request: serializeApprovalRequest(existing) };
    }

    const now = new Date();
    const [request] = await tx
      .insert(financialApprovalRequestsTable)
      .values({
        approvalNumber: `APR-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
        actionType: input.actionType,
        status: "pending",
        targetType: input.targetType,
        targetId: input.targetIds[0] ?? null,
        targetIds: input.targetIds,
        canonicalPayload: stableApprovalValue(input.canonicalPayload),
        payloadHash,
        amountCents: input.amountCents.toString(),
        requesterId: user.id,
        requesterName: actorName(input.req),
        reason,
        policySnapshot: policy,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    await tx.insert(financialApprovalEventsTable).values({
      requestId: request.id,
      eventType: "requested",
      actorId: user.id,
      actorName: actorName(input.req),
      reason,
      outcome: "pending",
      createdAt: now,
    });
    await completeIdempotencyKey(tx, claim.record.id, {
      resourceType: "financial_approval_request",
      resourceId: request.id,
      responseStatus: 202,
    });
    return { kind: "created" as const, request: serializeApprovalRequest(request) };
  });
}

export function approvalCapabilityForAction(actionType: FinancialApprovalAction): FinancialCapability {
  return actionType === "customer_credit.apply"
    ? "customer_credit.apply"
    : actionType;
}