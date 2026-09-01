import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  invoicesTable,
  paymentAllocationsTable,
  paymentsTable,
} from "@workspace/db";
import {
  allocateExistingPaymentCore,
  createPaymentCore,
  PaymentValidationError,
  type PaymentAllocationInput,
  type PaymentMode,
} from "../lib/payment-core.js";
import { assertPaymentCustomer, createPaymentAdapter } from "../lib/payment-adapter.js";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyContext,
  idempotencyConflictMessage,
  idempotencyInProgressMessage,
  markIdempotencyReplay,
} from "../lib/idempotency.js";
import { requireFinancialCapability } from "../lib/financial-permissions.js";
import { enqueueCommunicationEvent } from "../lib/communication-outbox.js";

const router: IRouter = Router();

function getPerformedBy(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || String(req.user.id);
}

function normalizeAllocations(value: unknown): Array<{ invoiceId: number; amount: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      invoiceId: Number((entry as { invoiceId?: unknown }).invoiceId),
      amount: String((entry as { amount?: unknown }).amount ?? ""),
    }))
    .sort((a, b) => a.invoiceId - b.invoiceId);
}

function paymentView(payment: typeof paymentsTable.$inferSelect, allocations: Array<{
  id: number;
  invoiceId: number;
  invoiceNumber: string | null;
  amount: string;
  createdAt: Date;
  createdBy: string | null;
}>) {
  return {
    ...payment,
    allocations,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

export async function getPaymentDetails(paymentId: number) {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
  if (!payment) return null;
  const allocations = await db
    .select({
      id: paymentAllocationsTable.id,
      invoiceId: paymentAllocationsTable.invoiceId,
      invoiceNumber: invoicesTable.invoiceNumber,
      amount: paymentAllocationsTable.amount,
      createdAt: paymentAllocationsTable.createdAt,
      createdBy: paymentAllocationsTable.createdBy,
    })
    .from(paymentAllocationsTable)
    .leftJoin(invoicesTable, eq(invoicesTable.id, paymentAllocationsTable.invoiceId))
    .where(eq(paymentAllocationsTable.paymentId, paymentId))
    .orderBy(paymentAllocationsTable.id);
  return paymentView(payment, allocations);
}

function errorResponse(res: Response, err: unknown): void {
  if (err instanceof PaymentValidationError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof Error && err.message === "Customer not found") {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Failed to process payment" });
}

router.get("/payments", async (req, res): Promise<void> => {
  try {
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const invoiceId = req.query.invoiceId ? Number(req.query.invoiceId) : null;
    let paymentIds: number[] | null = null;
    if (invoiceId) {
      const rows = await db
        .select({ paymentId: paymentAllocationsTable.paymentId })
        .from(paymentAllocationsTable)
        .where(eq(paymentAllocationsTable.invoiceId, invoiceId));
      paymentIds = rows.map((row) => row.paymentId);
    }

    let payments = await db
      .select()
      .from(paymentsTable)
      .orderBy(desc(paymentsTable.paymentDate), desc(paymentsTable.id))
      .limit(200);
    if (customerId) payments = payments.filter((payment) => payment.customerId === customerId);
    if (paymentIds) payments = payments.filter((payment) => paymentIds!.includes(payment.id));

    const details = await Promise.all(payments.map((payment) => getPaymentDetails(payment.id)));
    res.json(details.filter(Boolean));
  } catch (err) {
    errorResponse(res, err);
  }
});

router.get("/payments/:id", async (req, res): Promise<void> => {
  try {
    const payment = await getPaymentDetails(Number(req.params.id));
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    res.json(payment);
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post("/payments", requireFinancialCapability("payments.record"), async (req, res): Promise<void> => {
  try {
    const body = req.body as {
      customerId?: unknown;
      amount?: unknown;
      paymentDate?: unknown;
      method?: unknown;
      reference?: unknown;
      note?: unknown;
      mode?: unknown;
      allocations?: unknown;
    };
    const allocations = normalizeAllocations(body.allocations);
    const normalized = {
      customerId: Number(body.customerId),
      amount: String(body.amount ?? ""),
      paymentDate: String(body.paymentDate ?? ""),
      method: String(body.method ?? ""),
      reference: body.reference == null ? null : String(body.reference),
      note: body.note == null ? null : String(body.note),
      mode: String(body.mode ?? ""),
      allocations,
    };
    const idempotency = getIdempotencyContext(req, "payments.create", normalized);
    const result = await db.transaction(async (tx) => {
      const claim = idempotency ? await claimIdempotencyKey(tx, idempotency) : null;
      if (claim && claim.kind !== "claimed") return claim;
      await assertPaymentCustomer(tx, normalized.customerId);
      const effect = await createPaymentCore({
        ...normalized,
        mode: normalized.mode as PaymentMode,
        allocations: allocations as PaymentAllocationInput[],
        createdBy: getPerformedBy(req),
      }, createPaymentAdapter(tx));
      await enqueueCommunicationEvent(tx, {
        eventType: "payment.received",
        aggregateType: "payment",
        aggregateId: effect.payment.id,
        payload: {
          customerId: effect.payment.customerId,
          paymentId: effect.payment.id,
          amount: effect.payment.amount,
          paymentDate: effect.payment.paymentDate,
        },
        source: "payments.create",
        actorId: getPerformedBy(req),
        idempotencyKey: idempotency?.clientKey ?? null,
        dedupeKey: `payment.received:${effect.payment.id}`,
      });
      if (claim) {
        await completeIdempotencyKey(tx, claim.record.id, {
          resourceType: "payment",
          resourceId: effect.payment.id,
          responseStatus: 201,
        });
      }
      return { kind: "created" as const, effect };
    });
    if (result.kind === "conflict") {
      res.status(409).json({ error: idempotencyConflictMessage() });
      return;
    }
    if (result.kind === "inProgress") {
      res.status(409).setHeader("Retry-After", "1").json({ error: idempotencyInProgressMessage() });
      return;
    }
    if (result.kind === "replay") {
      const payment = await getPaymentDetails(result.record.resourceId!);
      if (!payment) {
        res.status(404).json({ error: "The idempotent payment no longer exists" });
        return;
      }
      markIdempotencyReplay(res);
      res.status(result.record.responseStatus ?? 201).json(payment);
      return;
    }
    const payment = await getPaymentDetails(result.effect.payment.id);
    res.status(201).json(payment);
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post("/payments/:id/allocations", requireFinancialCapability("payments.record"), async (req, res): Promise<void> => {
  try {
    const paymentId = Number(req.params.id);
    const body = req.body as { mode?: unknown; allocations?: unknown };
    const allocations = normalizeAllocations(body.allocations);
    const normalized = {
      paymentId,
      mode: String(body.mode ?? ""),
      allocations,
    };
    const idempotency = getIdempotencyContext(req, "payments.allocate", normalized);
    const result = await db.transaction(async (tx) => {
      const claim = idempotency ? await claimIdempotencyKey(tx, idempotency) : null;
      if (claim && claim.kind !== "claimed") return claim;
      const effect = await allocateExistingPaymentCore(paymentId, {
        mode: normalized.mode as PaymentMode,
        allocations: allocations as PaymentAllocationInput[],
        createdBy: getPerformedBy(req),
      }, createPaymentAdapter(tx));
      if (claim) {
        await completeIdempotencyKey(tx, claim.record.id, {
          resourceType: "payment",
          resourceId: paymentId,
          responseStatus: 200,
        });
      }
      return { kind: "allocated" as const, effect };
    });
    if (result.kind === "conflict") {
      res.status(409).json({ error: idempotencyConflictMessage() });
      return;
    }
    if (result.kind === "inProgress") {
      res.status(409).setHeader("Retry-After", "1").json({ error: idempotencyInProgressMessage() });
      return;
    }
    if (result.kind === "replay") {
      const payment = await getPaymentDetails(result.record.resourceId!);
      if (!payment) {
        res.status(404).json({ error: "The idempotent payment no longer exists" });
        return;
      }
      markIdempotencyReplay(res);
      res.json(payment);
      return;
    }
    const payment = await getPaymentDetails(paymentId);
    res.json(payment);
  } catch (err) {
    errorResponse(res, err);
  }
});

export default router;