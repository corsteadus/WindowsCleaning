import {
  approvalPayloadHash,
  approvalRequired,
  FinancialApprovalValidationError,
} from "./financial-approval-pure.ts";
import type {
  ApprovalPolicySnapshot,
  FinancialApprovalAction,
} from "./financial-approval-pure.ts";

export type ApprovalDecisionRequest = {
  id: number;
  status: string;
  actionType: FinancialApprovalAction;
  requesterId: string;
  amountCents: string | number | bigint;
  expiresAt: Date;
  policySnapshot: unknown;
};

export type ApprovalDecisionExecution = {
  resourceType: string;
  resourceId: number;
  metadata: unknown;
};

export type ApprovalDecisionClaim =
  | { kind: "claimed"; record: { id: number } }
  | { kind: "replay"; record: { resourceId: number | null } }
  | { kind: "conflict" }
  | { kind: "inProgress" };

export type ApprovalDecisionIdempotencyCompletion = {
  resourceType: string;
  resourceId: number;
  responseStatus: number;
};

export type ApprovalDecisionTx = {
  claimIdempotency: (input: {
    clientKey: string;
    requestHash: string;
  }) => Promise<ApprovalDecisionClaim>;
  getRequestForUpdate: (requestId: number) => Promise<ApprovalDecisionRequest | null>;
  getCurrentPolicy: (actionType: FinancialApprovalAction) => Promise<ApprovalPolicySnapshot | null>;
  markExpired: (request: ApprovalDecisionRequest, actorId: string, actorName: string) => Promise<void>;
  markCancelled: (request: ApprovalDecisionRequest, actorId: string, actorName: string, note: string | null) => Promise<void>;
  markRejected: (request: ApprovalDecisionRequest, actorId: string, actorName: string, note: string | null) => Promise<void>;
  executeApproved: (request: ApprovalDecisionRequest, actorName: string) => Promise<ApprovalDecisionExecution>;
  markExecuted: (
    request: ApprovalDecisionRequest,
    actorId: string,
    actorName: string,
    note: string | null,
    execution: ApprovalDecisionExecution,
    now: Date,
  ) => Promise<void>;
  completeIdempotency: (id: number, completion: ApprovalDecisionIdempotencyCompletion) => Promise<void>;
};

export type ApprovalDecisionResult =
  | { kind: "expired"; requestId: number }
  | { kind: "completed"; requestId: number }
  | { kind: "replay"; record: { resourceId: number | null } }
  | { kind: "conflict" }
  | { kind: "inProgress" };

export async function runFinancialApprovalDecision(input: {
  tx: ApprovalDecisionTx;
  requestId: number;
  action: "approve" | "reject" | "cancel";
  actorId: string;
  actorName: string;
  canManageCancellation: boolean;
  note: string | null;
  clientKey: string;
  now?: Date;
}): Promise<ApprovalDecisionResult> {
  const claim = await input.tx.claimIdempotency({
    clientKey: input.clientKey,
    requestHash: approvalPayloadHash({
      requestId: input.requestId,
      action: input.action,
      note: input.note,
    }),
  });
  if (claim.kind !== "claimed") return claim;
  const idempotencyId = claim.record.id;

  const request = await input.tx.getRequestForUpdate(input.requestId);
  if (!request) {
    throw new FinancialApprovalValidationError("approval_not_found", "Approval request not found");
  }
  if (request.status !== "pending") {
    throw new FinancialApprovalValidationError(
      `approval_${request.status}`,
      `Approval request is already ${request.status}`,
    );
  }

  const now = input.now ?? new Date();
  if (request.expiresAt <= now) {
    await input.tx.markExpired(request, input.actorId, input.actorName);
    await input.tx.completeIdempotency(idempotencyId, {
      resourceType: "financial_approval_request",
      resourceId: request.id,
      responseStatus: 409,
    });
    return { kind: "expired", requestId: request.id };
  }

  if (input.action === "cancel") {
    throwIfUnauthorizedCancellation(request, input.actorId, input.canManageCancellation);
    await input.tx.markCancelled(request, input.actorId, input.actorName, input.note);
    await input.tx.completeIdempotency(idempotencyId, {
      resourceType: "financial_approval_request",
      resourceId: request.id,
      responseStatus: 200,
    });
    return { kind: "completed", requestId: request.id };
  }

  if (input.action === "reject") {
    await input.tx.markRejected(request, input.actorId, input.actorName, input.note);
    await input.tx.completeIdempotency(idempotencyId, {
      resourceType: "financial_approval_request",
      resourceId: request.id,
      responseStatus: 200,
    });
    return { kind: "completed", requestId: request.id };
  }

  const policy = await input.tx.getCurrentPolicy(request.actionType);
  assertPolicyStillMatches(request, policy);
  if (policy!.distinctApprover && request.requesterId === input.actorId) {
    throw new FinancialApprovalValidationError(
      "approval_self_decision",
      "The requester cannot approve their own request",
    );
  }

  const execution = await input.tx.executeApproved(request, input.actorName);
  await input.tx.markExecuted(request, input.actorId, input.actorName, input.note, execution, now);
  await input.tx.completeIdempotency(idempotencyId, {
    resourceType: "financial_approval_request",
    resourceId: request.id,
    responseStatus: 200,
  });
  return { kind: "completed", requestId: request.id };
}

function throwIfUnauthorizedCancellation(
  request: ApprovalDecisionRequest,
  actorId: string,
  canManageCancellation: boolean,
): void {
  if (request.requesterId !== actorId && !canManageCancellation) {
    throw new FinancialApprovalValidationError(
      "approval_unauthorized",
      "Only the requester or an approval manager can cancel this request",
    );
  }
}

function assertPolicyStillMatches(
  request: ApprovalDecisionRequest,
  policy: ApprovalPolicySnapshot | null,
): void {
  const snapshot = request.policySnapshot as ApprovalPolicySnapshot;
  if (!policy ||
      snapshot.policyId !== policy.policyId ||
      snapshot.enabled !== policy.enabled ||
      snapshot.thresholdCents !== policy.thresholdCents ||
      snapshot.distinctApprover !== policy.distinctApprover ||
      !approvalRequired(policy, BigInt(String(request.amountCents)))) {
    throw new FinancialApprovalValidationError(
      "approval_policy_stale",
      "The approval policy changed after this request was created",
    );
  }
}