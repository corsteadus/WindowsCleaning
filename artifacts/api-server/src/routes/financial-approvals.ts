import { Router, type Request, type Response } from "express";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import {
  db,
  financialApprovalEventsTable,
  financialApprovalPoliciesTable,
  financialApprovalRequestsTable,
} from "@workspace/db";
import {
  applyCustomerCreditCore,
  createCustomerCreditRefundCore,
} from "../lib/customer-credit-core.js";
import { createCustomerCreditAdapter } from "../lib/customer-credit-adapter.js";
import {
  createCreditNoteCore,
  reissueInvoiceCore,
  voidInvoiceCore,
} from "../lib/invoice-correction-core.js";
import { createInvoiceCorrectionAdapter } from "./invoices.js";
import { createPaymentAdapter } from "../lib/payment-adapter.js";
import {
  approvalPayloadHash,
  approvalRequired,
  FINANCIAL_APPROVAL_ACTIONS,
  FinancialApprovalValidationError,
  lockFinancialApprovalAction,
  parseApprovalAmountCents,
  serializeApprovalEvent,
  serializeApprovalRequest,
  type ApprovalPolicySnapshot,
  type FinancialApprovalAction,
} from "../lib/financial-approval-service.js";
import {
  actorName,
  getFinancialCapabilities,
  hasFinancialCapability,
  requireFinancialCapability,
} from "../lib/financial-permissions.js";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
} from "../lib/idempotency.js";
import { runFinancialApprovalDecision } from "../lib/financial-approval-decision-core.js";

const router = Router();
type ApprovalTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const FINANCIAL_APPROVAL_STATUSES = ["pending", "expired", "cancelled", "rejected", "executed"] as const;

function requireIdempotencyKey(req: Request): string {
  const key = req.get("Idempotency-Key")?.trim() ?? "";
  if (!key) {
    throw new FinancialApprovalValidationError(
      "idempotency_key_required",
      "Idempotency-Key header is required for approval actions",
    );
  }
  if (key.length > 255) {
    throw new FinancialApprovalValidationError(
      "idempotency_key_invalid",
      "Idempotency-Key must be 255 characters or fewer",
    );
  }
  return key;
}

function errorResponse(res: Response, error: unknown): void {
  if (error instanceof FinancialApprovalValidationError) {
    const status =
      error.code === "approval_not_found" ? 404 :
      error.code === "financial_capability_required" || error.code === "unauthorized" ? 403 :
      error.code.startsWith("approval_") || error.code === "policy_not_found" ? 409 : 400;
    res.status(status).json({ error: error.message, code: error.code });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Failed to process financial approval" });
}

function actionIsValid(value: unknown): value is FinancialApprovalAction {
  return typeof value === "string" &&
    (FINANCIAL_APPROVAL_ACTIONS as readonly string[]).includes(value);
}

function parsePage(value: unknown, fallback: number, maximum: number): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new FinancialApprovalValidationError("invalid_page", "Pagination value is invalid");
  }
  return parsed;
}

function parsePolicyBody(body: unknown): {
  actionType: FinancialApprovalAction;
  enabled: boolean;
  thresholdCents: string | null;
  distinctApprover: boolean;
} {
  const input = body as {
    actionType?: unknown;
    enabled?: unknown;
    threshold?: unknown;
    thresholdCents?: unknown;
    distinctApprover?: unknown;
  };
  if (!actionIsValid(input.actionType)) {
    throw new FinancialApprovalValidationError("invalid_action", "Unsupported financial approval action");
  }
  const rawThreshold = input.thresholdCents ?? input.threshold;
  const thresholdCents = rawThreshold == null || rawThreshold === ""
    ? null
    : parseApprovalAmountCents(rawThreshold).toString();
  return {
    actionType: input.actionType,
    enabled: input.enabled === true,
    thresholdCents,
    distinctApprover: input.distinctApprover === true,
  };
}

function serializePolicy(row: typeof financialApprovalPoliciesTable.$inferSelect) {
  return {
    id: row.id,
    actionType: row.actionType,
    enabled: row.enabled,
    thresholdCents: row.thresholdCents == null ? null : String(row.thresholdCents),
    threshold: row.thresholdCents == null
      ? null
      : `${BigInt(String(row.thresholdCents)) / 100n}.${(BigInt(String(row.thresholdCents)) % 100n).toString().padStart(2, "0")}`,
    distinctApprover: row.distinctApprover,
    isActive: row.isActive,
    changedBy: row.changedBy,
    createdAt: row.createdAt.toISOString(),
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  };
}

async function getRequest(tx: ApprovalTx, id: number, lock = false) {
  if (lock) {
    await tx.execute(sql`SELECT id FROM financial_approval_requests WHERE id = ${id} FOR UPDATE`);
  }
  const [request] = await tx
    .select()
    .from(financialApprovalRequestsTable)
    .where(eq(financialApprovalRequestsTable.id, id));
  return request ?? null;
}

async function currentPolicy(
  tx: ApprovalTx,
  actionType: FinancialApprovalAction,
): Promise<ApprovalPolicySnapshot | null> {
  await lockFinancialApprovalAction(tx, actionType);
  const [policy] = await tx
    .select()
    .from(financialApprovalPoliciesTable)
    .where(and(
      eq(financialApprovalPoliciesTable.actionType, actionType),
      eq(financialApprovalPoliciesTable.isActive, true),
    ))
    .orderBy(desc(financialApprovalPoliciesTable.id))
    .limit(1);
  if (!policy) return null;
  return {
    policyId: policy.id,
    actionType,
    enabled: policy.enabled,
    thresholdCents: policy.thresholdCents == null ? null : String(policy.thresholdCents),
    distinctApprover: policy.distinctApprover,
  };
}

function assertPolicyStillMatches(
  request: typeof financialApprovalRequestsTable.$inferSelect,
  policy: ApprovalPolicySnapshot | null,
): void {
  const snapshot = request.policySnapshot as unknown as ApprovalPolicySnapshot;
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

async function executeApprovedAction(
  tx: ApprovalTx,
  request: typeof financialApprovalRequestsTable.$inferSelect,
  actor: string,
) {
  const payload = request.canonicalPayload as Record<string, unknown>;
  const action = request.actionType as FinancialApprovalAction;
  if (action === "invoices.void") {
    const effect = await voidInvoiceCore(
      Number(request.targetId),
      String(payload.reason ?? request.reason),
      createInvoiceCorrectionAdapter(tx),
      actor,
    );
    return { resourceType: "invoice", resourceId: effect.invoice.id, metadata: null };
  }
  if (action === "invoices.credit") {
    const lines = Array.isArray(payload.lines) ? payload.lines as Array<{
      invoiceLineId?: number | null;
      amount: string | number;
      description?: string | null;
    }> : [];
    const effect = await createCreditNoteCore(
      Number(request.targetId),
      String(payload.reason ?? request.reason),
      lines,
      `CN-${Number(request.targetId)}-${Date.now()}`,
      createInvoiceCorrectionAdapter(tx),
      actor,
    );
    return { resourceType: "invoice_credit_note", resourceId: effect.creditNoteId, metadata: { invoiceId: effect.invoice.id } };
  }
  if (action === "invoices.reissue") {
    const effect = await reissueInvoiceCore(
      Number(request.targetId),
      String(payload.reason ?? request.reason),
      `INV-${Date.now()}-${Number(request.targetId)}`,
      createInvoiceCorrectionAdapter(tx),
      actor,
    );
    return { resourceType: "invoice", resourceId: effect.replacement.id, metadata: { sourceInvoiceId: effect.source.id } };
  }
  if (action === "customer_credit.apply") {
    const effect = await applyCustomerCreditCore(
      {
        customerId: Number(payload.customerId),
        mode: payload.mode === "manual" ? "manual" : "oldest",
        amount: payload.amount == null ? undefined : String(payload.amount),
        allocations: Array.isArray(payload.allocations)
          ? payload.allocations as Array<{ sourceKey: string; invoiceId: number; amount: string }>
          : undefined,
        createdBy: actor,
      },
      createCustomerCreditAdapter(tx),
    );
    return {
      resourceType: "customer_credit_application",
      resourceId: effect.applications[0]?.invoiceId ?? Number(payload.customerId),
      metadata: { customerId: payload.customerId, applications: effect.applications },
    };
  }
  if (action === "refunds.record") {
    const effect = await createCustomerCreditRefundCore(
      {
        customerId: Number(payload.customerId),
        amount: String(payload.amount),
        refundDate: String(payload.refundDate),
        method: String(payload.method),
        reason: String(payload.reason ?? request.reason),
        reference: payload.reference == null ? null : String(payload.reference),
        note: payload.note == null ? null : String(payload.note),
        mode: payload.mode === "manual" ? "manual" : "oldest",
        allocations: Array.isArray(payload.allocations)
          ? payload.allocations as Array<{ sourceKey: string; amount: string }>
          : undefined,
        createdBy: actor,
      },
      `REF-${Number(payload.customerId)}-${Date.now()}`,
      createCustomerCreditAdapter(tx),
    );
    return { resourceType: "customer_credit_refund", resourceId: effect.refundId, metadata: { allocations: effect.allocations } };
  }
  throw new FinancialApprovalValidationError("invalid_action", "Unsupported financial approval action");
}

async function decision(
  req: Request,
  res: Response,
  requestId: number,
  action: "approve" | "reject" | "cancel",
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
      return;
    }
    const key = requireIdempotencyKey(req);
    const note = String((req.body as { note?: unknown } | undefined)?.note ?? "").trim() || null;
    const result = await db.transaction(async (tx) => runFinancialApprovalDecision({
      tx: {
        claimIdempotency: ({ clientKey, requestHash }) => claimIdempotencyKey(tx, {
          scope: `user:${req.user!.id}`,
          operation: `financial_approval.${action}`,
          clientKey,
          requestHash,
        }),
        getRequestForUpdate: async (id) => {
          const request = await getRequest(tx, id, true);
          return request ? { ...request, actionType: request.actionType as FinancialApprovalAction } : null;
        },
        getCurrentPolicy: (actionType) => currentPolicy(tx, actionType),
        markExpired: async (request, actorId, actorNameValue) => {
          const now = new Date();
          await tx.update(financialApprovalRequestsTable)
            .set({ status: "expired", decidedAt: now, decidedBy: actorId, decisionNote: "Request expired" })
            .where(eq(financialApprovalRequestsTable.id, request.id));
          await tx.insert(financialApprovalEventsTable).values({
            requestId: request.id,
            eventType: "expired",
            actorId,
            actorName: actorNameValue,
            note: "Request expired",
            outcome: "expired",
          });
        },
        markCancelled: async (request, actorId, actorNameValue, decisionNote) => {
          const now = new Date();
          await tx.update(financialApprovalRequestsTable)
            .set({ status: "cancelled", decidedAt: now, decidedBy: actorId, decisionNote })
            .where(eq(financialApprovalRequestsTable.id, request.id));
          await tx.insert(financialApprovalEventsTable).values({
            requestId: request.id,
            eventType: "cancelled",
            actorId,
            actorName: actorNameValue,
            note: decisionNote,
            outcome: "cancelled",
          });
        },
        markRejected: async (request, actorId, actorNameValue, decisionNote) => {
          const now = new Date();
          await tx.update(financialApprovalRequestsTable)
            .set({ status: "rejected", decidedAt: now, decidedBy: actorId, decisionNote })
            .where(eq(financialApprovalRequestsTable.id, request.id));
          await tx.insert(financialApprovalEventsTable).values({
            requestId: request.id,
            eventType: "rejected",
            actorId,
            actorName: actorNameValue,
            note: decisionNote,
            outcome: "rejected",
          });
        },
        executeApproved: (request, actorNameValue) => executeApprovedAction(tx, request as typeof financialApprovalRequestsTable.$inferSelect, actorNameValue),
        markExecuted: async (request, actorId, actorNameValue, decisionNote, execution, now) => {
          await tx.update(financialApprovalRequestsTable)
            .set({
              status: "executed",
              decidedAt: now,
              decidedBy: actorId,
              decisionNote,
              executedAt: now,
              executionResourceType: execution.resourceType,
              executionResourceId: execution.resourceId,
            })
            .where(eq(financialApprovalRequestsTable.id, request.id));
          await tx.insert(financialApprovalEventsTable).values([
            {
              requestId: request.id,
              eventType: "approved",
              actorId,
              actorName: actorNameValue,
              note: decisionNote,
              outcome: "approved",
            },
            {
              requestId: request.id,
              eventType: "executed",
              actorId,
              actorName: actorNameValue,
              note: decisionNote,
              outcome: "executed",
              resourceType: execution.resourceType,
              resourceId: execution.resourceId,
              metadata: execution.metadata,
            },
          ]);
        },
        completeIdempotency: (id, completion) => completeIdempotencyKey(tx, id, completion),
      },
      requestId,
      action,
      actorId: req.user!.id,
      actorName: actorName(req),
      canManageCancellation: hasFinancialCapability(req.user!.role, "approvals.manage"),
      note,
      clientKey: key,
    }));

    if (result.kind === "conflict") {
      res.status(409).json({ error: "This Idempotency-Key was already used with a different request", code: "idempotency_conflict" });
      return;
    }
    if (result.kind === "inProgress") {
      res.status(409).setHeader("Retry-After", "1").json({ error: "An identical request is already in progress", code: "idempotency_in_progress" });
      return;
    }
    if (result.kind === "expired") {
      res.status(409).json({ error: "Approval request has expired", code: "approval_expired", requestId: result.requestId });
      return;
    }
    if (result.kind === "replay") {
      const [replayed] = await db.select().from(financialApprovalRequestsTable).where(eq(financialApprovalRequestsTable.id, result.record.resourceId!));
      if (!replayed) {
        res.status(404).json({ error: "The idempotent approval request no longer exists", code: "approval_not_found" });
        return;
      }
      res.setHeader("Idempotency-Replayed", "true");
      res.json(serializeApprovalRequest(replayed));
      return;
    }
    const [updated] = await db.select().from(financialApprovalRequestsTable).where(eq(financialApprovalRequestsTable.id, result.requestId));
    res.json(updated ? serializeApprovalRequest(updated) : { id: result.requestId });
  } catch (error) {
    errorResponse(res, error);
  }
}

router.get("/financial-permissions/capabilities", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }
  res.json({ role: req.user.role, capabilities: getFinancialCapabilities(req.user.role) });
});

router.get("/financial-approval-policies", requireFinancialCapability("approvals.view"), async (req, res) => {
  try {
    const action = req.query.actionType;
    if (action != null && !actionIsValid(action)) {
      throw new FinancialApprovalValidationError("invalid_action", "Unsupported financial approval action");
    }
    const rows = await db.select().from(financialApprovalPoliciesTable)
      .where(action ? eq(financialApprovalPoliciesTable.actionType, String(action)) : undefined)
      .orderBy(desc(financialApprovalPoliciesTable.id));
    res.json({ data: rows.map(serializePolicy) });
  } catch (error) {
    errorResponse(res, error);
  }
});

router.post("/financial-approval-policies", requireFinancialCapability("approvals.manage"), async (req, res) => {
  try {
    const key = requireIdempotencyKey(req);
    const parsed = parsePolicyBody(req.body);
    const result = await db.transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        scope: `user:${req.user!.id}`,
        operation: "financial_approval.policy_upsert",
        clientKey: key,
        requestHash: approvalPayloadHash(parsed),
      });
      if (claim.kind !== "claimed") return claim;
      await lockFinancialApprovalAction(tx, parsed.actionType);
      await tx.update(financialApprovalPoliciesTable)
        .set({ isActive: false, deactivatedAt: new Date() })
        .where(and(
          eq(financialApprovalPoliciesTable.actionType, parsed.actionType),
          eq(financialApprovalPoliciesTable.isActive, true),
        ));
      const [policy] = await tx.insert(financialApprovalPoliciesTable).values({
        actionType: parsed.actionType,
        enabled: parsed.enabled,
        thresholdCents: parsed.thresholdCents,
        distinctApprover: parsed.distinctApprover,
        isActive: true,
        changedBy: req.user!.id,
      }).returning();
      await tx.insert(financialApprovalEventsTable).values({
        policyId: policy.id,
        eventType: "policy_upserted",
        actorId: req.user!.id,
        actorName: actorName(req),
        note: "Approval policy configured",
        outcome: policy.enabled ? "enabled" : "disabled",
        metadata: serializePolicy(policy),
      });
      await completeIdempotencyKey(tx, claim.record.id, {
        resourceType: "financial_approval_policy",
        resourceId: policy.id,
        responseStatus: 201,
      });
      return { kind: "completed" as const, policy };
    });
    if (result.kind === "conflict") {
      res.status(409).json({ error: "This Idempotency-Key was already used with a different request", code: "idempotency_conflict" });
      return;
    }
    if (result.kind === "inProgress") {
      res.status(409).setHeader("Retry-After", "1").json({ error: "An identical request is already in progress", code: "idempotency_in_progress" });
      return;
    }
    if (result.kind === "replay") {
      const [policy] = await db.select().from(financialApprovalPoliciesTable).where(eq(financialApprovalPoliciesTable.id, result.record.resourceId!));
      if (!policy) {
        res.status(404).json({ error: "The idempotent policy no longer exists", code: "policy_not_found" });
        return;
      }
      res.setHeader("Idempotency-Replayed", "true");
      res.json(serializePolicy(policy));
      return;
    }
    res.status(201).json(serializePolicy(result.policy));
  } catch (error) {
    errorResponse(res, error);
  }
});

router.post("/financial-approval-policies/:actionType/deactivate", requireFinancialCapability("approvals.manage"), async (req, res) => {
  try {
    const key = requireIdempotencyKey(req);
    const actionType = req.params.actionType;
    if (!actionIsValid(actionType)) {
      throw new FinancialApprovalValidationError("invalid_action", "Unsupported financial approval action");
    }
    const result = await db.transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        scope: `user:${req.user!.id}`,
        operation: "financial_approval.policy_deactivate",
        clientKey: key,
        requestHash: approvalPayloadHash({ actionType }),
      });
      if (claim.kind !== "claimed") return claim;
      await lockFinancialApprovalAction(tx, actionType);
      const [policy] = await tx.select().from(financialApprovalPoliciesTable)
        .where(and(
          eq(financialApprovalPoliciesTable.actionType, actionType),
          eq(financialApprovalPoliciesTable.isActive, true),
        ))
        .orderBy(desc(financialApprovalPoliciesTable.id))
        .limit(1);
      if (!policy) throw new FinancialApprovalValidationError("policy_not_found", "No active approval policy exists for this action");
      const [updated] = await tx.update(financialApprovalPoliciesTable)
        .set({ isActive: false, deactivatedAt: new Date() })
        .where(eq(financialApprovalPoliciesTable.id, policy.id))
        .returning();
      await tx.insert(financialApprovalEventsTable).values({
        policyId: policy.id,
        eventType: "policy_deactivated",
        actorId: req.user!.id,
        actorName: actorName(req),
        note: "Approval policy deactivated",
        outcome: "disabled",
      });
      await completeIdempotencyKey(tx, claim.record.id, {
        resourceType: "financial_approval_policy",
        resourceId: updated.id,
        responseStatus: 200,
      });
      return { kind: "completed" as const, policy: updated };
    });
    if (result.kind === "conflict") {
      res.status(409).json({ error: "This Idempotency-Key was already used with a different request", code: "idempotency_conflict" });
      return;
    }
    if (result.kind === "inProgress") {
      res.status(409).setHeader("Retry-After", "1").json({ error: "An identical request is already in progress", code: "idempotency_in_progress" });
      return;
    }
    if (result.kind === "replay") {
      const [policy] = await db.select().from(financialApprovalPoliciesTable).where(eq(financialApprovalPoliciesTable.id, result.record.resourceId!));
      if (!policy) {
        res.status(404).json({ error: "The idempotent policy no longer exists", code: "policy_not_found" });
        return;
      }
      res.setHeader("Idempotency-Replayed", "true");
      res.json(serializePolicy(policy));
      return;
    }
    res.json(serializePolicy(result.policy));
  } catch (error) {
    errorResponse(res, error);
  }
});

router.get("/financial-approvals", requireFinancialCapability("approvals.view"), async (req, res) => {
  try {
    const page = parsePage(req.query.page, 1, 100000);
    const pageSize = parsePage(req.query.pageSize, 25, 100);
    const status = req.query.status == null ? null : String(req.query.status);
    const actionType = req.query.actionType == null ? null : String(req.query.actionType);
    if (status && !(FINANCIAL_APPROVAL_STATUSES as readonly string[]).includes(status)) {
      throw new FinancialApprovalValidationError("invalid_status", "Unsupported approval status");
    }
    if (actionType && !actionIsValid(actionType)) {
      throw new FinancialApprovalValidationError("invalid_action", "Unsupported financial approval action");
    }
    const conditions = [
      status ? eq(financialApprovalRequestsTable.status, status) : undefined,
      actionType ? eq(financialApprovalRequestsTable.actionType, actionType) : undefined,
      req.query.requesterId ? eq(financialApprovalRequestsTable.requesterId, String(req.query.requesterId)) : undefined,
      req.query.search ? ilike(financialApprovalRequestsTable.approvalNumber, `%${String(req.query.search)}%`) : undefined,
    ].filter(Boolean) as any[];
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db.select().from(financialApprovalRequestsTable)
      .where(where)
      .orderBy(desc(financialApprovalRequestsTable.createdAt), desc(financialApprovalRequestsTable.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    res.json({
      data: rows.map(serializeApprovalRequest),
      page,
      pageSize,
      hasMore: rows.length === pageSize,
    });
  } catch (error) {
    errorResponse(res, error);
  }
});

router.get("/financial-approvals/:id", requireFinancialCapability("approvals.view"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new FinancialApprovalValidationError("approval_not_found", "Approval request not found");
    const [request] = await db.select().from(financialApprovalRequestsTable).where(eq(financialApprovalRequestsTable.id, id));
    if (!request) {
      res.status(404).json({ error: "Approval request not found", code: "approval_not_found" });
      return;
    }
    const history = await db.select().from(financialApprovalEventsTable)
      .where(eq(financialApprovalEventsTable.requestId, id))
      .orderBy(financialApprovalEventsTable.id);
    res.json({ ...serializeApprovalRequest(request), history: history.map(serializeApprovalEvent) });
  } catch (error) {
    errorResponse(res, error);
  }
});

router.get("/financial-approvals/:id/history", requireFinancialCapability("approvals.view"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const history = await db.select().from(financialApprovalEventsTable)
      .where(eq(financialApprovalEventsTable.requestId, id))
      .orderBy(financialApprovalEventsTable.id);
    res.json({ data: history.map(serializeApprovalEvent) });
  } catch (error) {
    errorResponse(res, error);
  }
});

router.post("/financial-approvals/:id/approve", requireFinancialCapability("approvals.decide"), (req, res) => decision(req, res, Number(req.params.id), "approve"));
router.post("/financial-approvals/:id/reject", requireFinancialCapability("approvals.decide"), (req, res) => decision(req, res, Number(req.params.id), "reject"));
router.post("/financial-approvals/:id/cancel", requireFinancialCapability("approvals.view"), (req, res) => decision(req, res, Number(req.params.id), "cancel"));

export default router;