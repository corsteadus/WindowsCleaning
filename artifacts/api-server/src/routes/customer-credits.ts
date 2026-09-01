import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  customerCreditApplicationsTable,
  customerCreditRefundAllocationsTable,
  customerCreditRefundsTable,
  customerCreditSourcesTable,
  invoiceCreditNotesTable,
  invoicesTable,
  paymentsTable,
} from "@workspace/db";
import { createCustomerCreditAdapter, assertCustomerExists } from "../lib/customer-credit-adapter.js";
import {
  createCustomerCreditApplicationPostHandler,
  createCustomerCreditRefundPostHandler,
  type CustomerCreditRouteDependencies,
} from "../lib/customer-credit-handler.js";
import { claimIdempotencyKey, completeIdempotencyKey } from "../lib/idempotency.js";
import {
  FinancialApprovalValidationError,
  parseApprovalAmountCents,
  submitFinancialApproval,
} from "../lib/financial-approval-service.js";
import { requireFinancialCapability } from "../lib/financial-permissions.js";

const router: IRouter = Router();

function getPerformedBy(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || String(req.user.id);
}

function amount(value: string | number): number {
  return Number(value);
}

async function getCustomerCreditSummary(customerId: number) {
  return db.transaction(async (tx) => {
    const adapter = createCustomerCreditAdapter(tx);
    const sources = await adapter.findSources(customerId);
    const sourceKeys = sources.map((source) => source.sourceKey);
    const applications = sourceKeys.length
      ? await tx.select({
          id: customerCreditApplicationsTable.id,
          sourceKey: customerCreditApplicationsTable.sourceKey,
          invoiceId: customerCreditApplicationsTable.invoiceId,
          invoiceNumber: invoicesTable.invoiceNumber,
          amount: customerCreditApplicationsTable.amount,
          origin: customerCreditApplicationsTable.origin,
          createdAt: customerCreditApplicationsTable.createdAt,
          createdBy: customerCreditApplicationsTable.createdBy,
        })
        .from(customerCreditApplicationsTable)
        .leftJoin(invoicesTable, eq(invoicesTable.id, customerCreditApplicationsTable.invoiceId))
        .where(and(
          eq(customerCreditApplicationsTable.customerId, customerId),
          inArray(customerCreditApplicationsTable.sourceKey, sourceKeys),
        ))
        .orderBy(desc(customerCreditApplicationsTable.id))
      : [];
    const refunds = await tx.select()
      .from(customerCreditRefundsTable)
      .where(eq(customerCreditRefundsTable.customerId, customerId))
      .orderBy(desc(customerCreditRefundsTable.id));
    const refundIds = refunds.map((refund) => refund.id);
    const refundAllocations = refundIds.length
      ? await tx.select()
        .from(customerCreditRefundAllocationsTable)
        .where(inArray(customerCreditRefundAllocationsTable.refundId, refundIds))
        .orderBy(asc(customerCreditRefundAllocationsTable.id))
      : [];
    const creditNoteIds = sources.filter((source) => source.sourceType === "credit_note").map((source) => source.sourceId);
    const paymentIds = sources.filter((source) => source.sourceType === "payment").map((source) => source.sourceId);
    const creditNotes = creditNoteIds.length
      ? await tx.select().from(invoiceCreditNotesTable).where(inArray(invoiceCreditNotesTable.id, creditNoteIds))
      : [];
    const payments = paymentIds.length
      ? await tx.select({ id: paymentsTable.id, reference: paymentsTable.reference, paymentDate: paymentsTable.paymentDate })
        .from(paymentsTable).where(inArray(paymentsTable.id, paymentIds))
      : [];
    const labels = new Map<string, string>();
    for (const source of sources) {
      const creditNote = creditNotes.find((note) => note.id === source.sourceId);
      const payment = payments.find((candidate) => candidate.id === source.sourceId);
      labels.set(
        source.sourceKey,
        creditNote ? `Credit note ${creditNote.creditNumber}` : payment ? `Payment #${payment.id}` : `${source.sourceType} #${source.sourceId}`,
      );
    }
    return {
      customerId,
      availableTotal: sources.reduce((sum, source) => sum + amount(source.availableAmount), 0),
      sources: sources.map((source) => ({
        ...source,
        originalAmount: amount(source.originalAmount),
        availableAmount: amount(source.availableAmount),
        label: labels.get(source.sourceKey) ?? source.sourceKey,
        createdAt: source.createdAt instanceof Date ? source.createdAt.toISOString() : source.createdAt,
      })),
      applications: applications.map((application) => ({
        ...application,
        amount: amount(application.amount),
        createdAt: application.createdAt.toISOString(),
        sourceLabel: labels.get(application.sourceKey) ?? application.sourceKey,
      })),
      refunds: refunds.map((refund) => ({
        ...refund,
        amount: amount(refund.amount),
        createdAt: refund.createdAt.toISOString(),
        allocations: refundAllocations
          .filter((allocation) => allocation.refundId === refund.id)
          .map((allocation) => ({
            ...allocation,
            amount: amount(allocation.amount),
          })),
      })),
    };
  });
}

async function getRefundDetail(refundId: number) {
  const [refund] = await db.select().from(customerCreditRefundsTable).where(eq(customerCreditRefundsTable.id, refundId));
  if (!refund) return null;
  const allocations = await db.select()
    .from(customerCreditRefundAllocationsTable)
    .where(eq(customerCreditRefundAllocationsTable.refundId, refundId))
    .orderBy(asc(customerCreditRefundAllocationsTable.id));
  return {
    ...refund,
    amount: amount(refund.amount),
    createdAt: refund.createdAt.toISOString(),
    allocations: allocations.map((allocation) => ({
      ...allocation,
      amount: amount(allocation.amount),
    })),
  };
}

const dependencies: CustomerCreditRouteDependencies = {
  transaction: (callback) => db.transaction((tx) => callback({
    createCustomerCreditAdapter: () => createCustomerCreditAdapter(tx),
    claimIdempotencyKey: (input) => claimIdempotencyKey(tx, input),
    completeIdempotencyKey: (id, completion) => completeIdempotencyKey(tx, id, completion),
  })),
  getPerformedBy,
  createRefundNumber: (customerId) => `REF-${customerId}-${Date.now()}`,
  getCustomerCreditSummary,
  getRefundDetail,
};

router.get("/customer-credits/refunds/:id", async (req, res): Promise<void> => {
  const detail = await getRefundDetail(Number(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "Refund not found" });
    return;
  }
  res.json(detail);
});

router.get("/customer-credits/refunds", async (req, res): Promise<void> => {
  const customerId = req.query.customerId ? Number(req.query.customerId) : null;
  const rows = await db.select().from(customerCreditRefundsTable)
    .where(customerId ? eq(customerCreditRefundsTable.customerId, customerId) : undefined)
    .orderBy(desc(customerCreditRefundsTable.id));
  res.json(rows.map((refund) => ({
    ...refund,
    amount: amount(refund.amount),
    createdAt: refund.createdAt.toISOString(),
  })));
});

router.get("/customer-credits", async (req, res): Promise<void> => {
  const customerId = Number(req.query.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    res.status(400).json({ error: "customerId is required" });
    return;
  }
  res.json(await getCustomerCreditSummary(customerId));
});

router.get("/customer-credits/:customerId", async (req, res): Promise<void> => {
  const customerId = Number(req.params.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    res.status(400).json({ error: "A valid customerId is required" });
    return;
  }
  res.json(await getCustomerCreditSummary(customerId));
});

function approvalResponse(res: any, result: Awaited<ReturnType<typeof submitFinancialApproval>>): boolean {
  if (result.kind === "not_required") return false;
  if (result.kind === "conflict") {
    res.status(409).json({ error: "This Idempotency-Key was already used with a different request", code: "idempotency_conflict" });
    return true;
  }
  if (result.kind === "inProgress") {
    res.status(409).setHeader("Retry-After", "1").json({ error: "An identical request is already in progress", code: "idempotency_in_progress" });
    return true;
  }
  if (result.kind === "replay") res.setHeader("Idempotency-Replayed", "true");
  res.status(202).json({ approvalRequired: true, approvalRequest: result.request });
  return true;
}

function approvalErrorResponse(res: any, error: unknown): void {
  if (error instanceof FinancialApprovalValidationError) {
    const status = error.code === "unauthorized" ? 401 : error.code.startsWith("approval_") ? 409 : 400;
    res.status(status).json({ error: error.message, code: error.code });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Failed to process financial approval" });
}

const applicationHandler = createCustomerCreditApplicationPostHandler(dependencies);
const refundHandler = createCustomerCreditRefundPostHandler(dependencies);

router.post("/customer-credits/applications", requireFinancialCapability("customer_credit.apply"), async (req, res): Promise<void> => {
  try {
    const body = req.body as { customerId?: unknown; amount?: unknown; mode?: unknown; allocations?: unknown; reason?: unknown };
    const allocations = Array.isArray(body.allocations)
      ? body.allocations.map((entry) => {
          const item = entry as { sourceKey?: unknown; invoiceId?: unknown; amount?: unknown };
          return { sourceKey: String(item.sourceKey ?? ""), invoiceId: Number(item.invoiceId), amount: String(item.amount ?? "") };
        })
      : undefined;
    const requestedAmount = body.amount == null
      ? (allocations ?? []).reduce((sum, item) => sum + parseApprovalAmountCents(item.amount), 0n)
      : parseApprovalAmountCents(body.amount);
    const result = await submitFinancialApproval({
      req,
      actionType: "customer_credit.apply",
      targetType: "customer",
      targetIds: [Number(body.customerId), ...(allocations ?? []).map((item) => item.invoiceId)],
      canonicalPayload: {
        customerId: Number(body.customerId),
        amount: body.amount == null ? null : String(body.amount),
        mode: body.mode === "manual" ? "manual" : "oldest",
        allocations,
        reason: String(body.reason ?? ""),
      },
      amountCents: requestedAmount,
      reason: String(body.reason ?? ""),
    });
    if (approvalResponse(res, result)) return;
    return applicationHandler(req, res);
  } catch (error) {
    approvalErrorResponse(res, error);
  }
});

router.post("/customer-credits/refunds", requireFinancialCapability("refunds.record"), async (req, res): Promise<void> => {
  try {
    const body = req.body as { customerId?: unknown; amount?: unknown; refundDate?: unknown; method?: unknown; reason?: unknown; reference?: unknown; note?: unknown; mode?: unknown; allocations?: unknown };
    const allocations = Array.isArray(body.allocations)
      ? body.allocations.map((entry) => {
          const item = entry as { sourceKey?: unknown; amount?: unknown };
          return { sourceKey: String(item.sourceKey ?? ""), amount: String(item.amount ?? "") };
        })
      : undefined;
    const result = await submitFinancialApproval({
      req,
      actionType: "refunds.record",
      targetType: "customer",
      targetIds: [Number(body.customerId)],
      canonicalPayload: {
        customerId: Number(body.customerId),
        amount: String(body.amount ?? ""),
        refundDate: String(body.refundDate ?? ""),
        method: String(body.method ?? ""),
        reason: String(body.reason ?? ""),
        reference: body.reference == null ? null : String(body.reference),
        note: body.note == null ? null : String(body.note),
        mode: body.mode === "manual" ? "manual" : "oldest",
        allocations,
      },
      amountCents: parseApprovalAmountCents(body.amount),
      reason: String(body.reason ?? ""),
    });
    if (approvalResponse(res, result)) return;
    return refundHandler(req, res);
  } catch (error) {
    approvalErrorResponse(res, error);
  }
});

export default router;