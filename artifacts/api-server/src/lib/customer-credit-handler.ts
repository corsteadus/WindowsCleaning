import type { Request, Response } from "express";
// @ts-ignore Node's strip-types test runner executes this source module directly.
import { applyCustomerCreditCore, createCustomerCreditRefundCore, CustomerCreditValidationError } from "./customer-credit-core.ts";
import type { CustomerCreditAdapter, CustomerCreditApplyRequest, CustomerCreditRefundRequest } from "./customer-credit-core.js";
// @ts-ignore Node's strip-types test runner executes this source module directly.
import { hashIdempotencyRequest } from "./idempotency-core.ts";

type IdempotencyRecord = {
  id: number;
  requestHash: string;
  status: string;
  resourceId: number | null;
  responseStatus: number | null;
};

type IdempotencyClaim =
  | { kind: "claimed"; record: IdempotencyRecord }
  | { kind: "replay"; record: IdempotencyRecord }
  | { kind: "conflict"; record: IdempotencyRecord }
  | { kind: "inProgress"; record: IdempotencyRecord };

export type CustomerCreditRouteTransaction = {
  createCustomerCreditAdapter(): CustomerCreditAdapter;
  claimIdempotencyKey(input: {
    scope: string;
    operation: string;
    clientKey: string;
    requestHash: string;
  }): Promise<IdempotencyClaim>;
  completeIdempotencyKey(id: number, completion: {
    resourceType: string;
    resourceId: number;
    responseStatus: number;
  }): Promise<void>;
};

export type CustomerCreditRouteDependencies = {
  transaction<T>(callback: (tx: CustomerCreditRouteTransaction) => Promise<T>): Promise<T>;
  getPerformedBy(req: Request): string | null;
  createRefundNumber(customerId: number): string;
  getCustomerCreditSummary(customerId: number): Promise<unknown>;
  getRefundDetail(refundId: number): Promise<unknown | null>;
};

function requiredIdempotencyContext(req: Request, operation: string, normalized: unknown) {
  const clientKey = req.get("Idempotency-Key")?.trim() ?? "";
  if (!clientKey) throw new CustomerCreditValidationError("idempotency_key_required", "Idempotency-Key header is required for customer credit mutations");
  if (clientKey.length > 255) throw new CustomerCreditValidationError("idempotency_key_invalid", "Idempotency-Key must be 255 characters or fewer");
  return {
    scope: req.user?.id ? `user:${req.user.id}` : "anonymous",
    operation,
    clientKey,
    requestHash: hashIdempotencyRequest(normalized),
  };
}

function normalizeApply(req: Request): CustomerCreditApplyRequest {
  const body = req.body as { customerId?: unknown; amount?: unknown; mode?: unknown; allocations?: unknown };
  return {
    customerId: Number(body.customerId),
    amount: body.amount == null ? undefined : String(body.amount),
    mode: body.mode === "manual" ? "manual" : "oldest",
    allocations: Array.isArray(body.allocations)
      ? body.allocations.map((entry) => {
          const item = entry as { sourceKey?: unknown; invoiceId?: unknown; amount?: unknown };
          return { sourceKey: String(item.sourceKey ?? ""), invoiceId: Number(item.invoiceId), amount: String(item.amount ?? "") };
        })
      : undefined,
  };
}

function normalizeRefund(req: Request): CustomerCreditRefundRequest {
  const body = req.body as {
    customerId?: unknown; amount?: unknown; refundDate?: unknown; method?: unknown; reason?: unknown;
    reference?: unknown; note?: unknown; mode?: unknown; allocations?: unknown;
  };
  return {
    customerId: Number(body.customerId),
    amount: String(body.amount ?? ""),
    refundDate: String(body.refundDate ?? ""),
    method: String(body.method ?? ""),
    reason: String(body.reason ?? ""),
    reference: body.reference == null ? null : String(body.reference),
    note: body.note == null ? null : String(body.note),
    mode: body.mode === "manual" ? "manual" : "oldest",
    allocations: Array.isArray(body.allocations)
      ? body.allocations.map((entry) => {
          const item = entry as { sourceKey?: unknown; amount?: unknown };
          return { sourceKey: String(item.sourceKey ?? ""), amount: String(item.amount ?? "") };
        })
      : undefined,
  };
}

function errorResponse(res: Response, error: unknown): void {
  if (error instanceof CustomerCreditValidationError) {
    res.status(error.code === "customer_not_found" ? 404 : 400).json({ error: error.message, code: error.code });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Failed to process customer credit" });
}

async function runMutation(
  req: Request,
  res: Response,
  dependencies: CustomerCreditRouteDependencies,
  operation: string,
  normalized: unknown,
  perform: (tx: CustomerCreditRouteTransaction) => Promise<{ resourceId: number; responseStatus: number }>,
  respond: (resourceId: number, status: number, replayed: boolean) => Promise<void>,
): Promise<void> {
  try {
    const idempotency = requiredIdempotencyContext(req, operation, normalized);
    const result = await dependencies.transaction(async (tx) => {
      const claim = await tx.claimIdempotencyKey(idempotency);
      if (claim.kind !== "claimed") return claim;
      const effect = await perform(tx);
      await tx.completeIdempotencyKey(claim.record.id, {
        resourceType: "customer_credit",
        resourceId: effect.resourceId,
        responseStatus: effect.responseStatus,
      });
      return { kind: "completed" as const, effect };
    });
    if (result.kind === "conflict") {
      res.status(409).json({ error: "This Idempotency-Key was already used with a different request" });
      return;
    }
    if (result.kind === "inProgress") {
      res.status(409).setHeader("Retry-After", "1").json({ error: "An identical request is already in progress" });
      return;
    }
    if (result.kind === "replay") {
      res.setHeader("Idempotency-Replayed", "true");
      await respond(result.record.resourceId!, result.record.responseStatus ?? 200, true);
      return;
    }
    await respond(result.effect.resourceId, result.effect.responseStatus, false);
  } catch (error) {
    errorResponse(res, error);
  }
}

export function createCustomerCreditApplicationPostHandler(dependencies: CustomerCreditRouteDependencies) {
  return (req: Request, res: Response): Promise<void> => {
    const normalized = normalizeApply(req);
    return runMutation(req, res, dependencies, "customer_credits.apply", normalized, async (tx) => {
      const effect = await applyCustomerCreditCore({ ...normalized, createdBy: dependencies.getPerformedBy(req) }, tx.createCustomerCreditAdapter());
      return { resourceId: normalized.customerId, responseStatus: 200 };
    }, async (customerId, status) => {
      res.status(status).json(await dependencies.getCustomerCreditSummary(customerId));
    });
  };
}

export function createCustomerCreditRefundPostHandler(dependencies: CustomerCreditRouteDependencies) {
  return (req: Request, res: Response): Promise<void> => {
    const normalized = normalizeRefund(req);
    return runMutation(req, res, dependencies, "customer_credits.refund", normalized, async (tx) => {
      const effect = await createCustomerCreditRefundCore(
        { ...normalized, createdBy: dependencies.getPerformedBy(req) },
        dependencies.createRefundNumber(normalized.customerId),
        tx.createCustomerCreditAdapter(),
      );
      return { resourceId: effect.refundId, responseStatus: 201 };
    }, async (refundId, status, replayed) => {
      const detail = await dependencies.getRefundDetail(refundId);
      if (!detail) {
        res.status(404).json({ error: "The idempotent refund no longer exists" });
        return;
      }
      if (replayed) res.setHeader("Idempotency-Replayed", "true");
      res.status(status).json(detail);
    });
  };
}