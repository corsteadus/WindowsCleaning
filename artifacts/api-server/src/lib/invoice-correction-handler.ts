import type { Request, Response } from "express";
// @ts-ignore Node's strip-types test runner executes this source module directly.
import { createCreditNoteCore, InvoiceCorrectionValidationError, reissueInvoiceCore, voidInvoiceCore } from "./invoice-correction-core.ts";
import type { CreditLineInput, InvoiceCorrectionAdapter } from "./invoice-correction-core.js";
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

type IdempotencyCompletion = {
  resourceType: string;
  resourceId: number;
  responseStatus: number;
};

export type InvoiceCorrectionRouteTransaction = {
  createCorrectionAdapter(): InvoiceCorrectionAdapter;
  claimIdempotencyKey(input: {
    scope: string;
    operation: string;
    clientKey: string;
    requestHash: string;
  }): Promise<IdempotencyClaim>;
  completeIdempotencyKey(id: number, completion: IdempotencyCompletion): Promise<void>;
};

export type InvoiceCorrectionRouteDependencies = {
  transaction<T>(callback: (tx: InvoiceCorrectionRouteTransaction) => Promise<T>): Promise<T>;
  findInvoiceById(id: number): Promise<unknown | null>;
  enrichInvoices(invoices: unknown[]): Promise<unknown[]>;
  getPerformedBy(req: Request): string | null;
  createCreditNumber(invoiceId: number): string;
  createReissueNumber(invoiceId: number): string;
};

type CompletedCorrection = {
  resourceId: number;
  responseStatus: number;
};

function requiredIdempotencyContext(
  req: Request,
  operation: string,
  normalizedRequest: unknown,
): { scope: string; operation: string; clientKey: string; requestHash: string } {
  const clientKey = req.get("Idempotency-Key")?.trim() ?? "";
  if (!clientKey) {
    throw new InvoiceCorrectionValidationError(
      "idempotency_key_required",
      "Idempotency-Key header is required for invoice corrections",
    );
  }
  if (clientKey.length > 255) {
    throw new InvoiceCorrectionValidationError(
      "idempotency_key_invalid",
      "Idempotency-Key must be 255 characters or fewer",
    );
  }
  return {
    scope: req.user?.id ? `user:${req.user.id}` : "anonymous",
    operation,
    clientKey,
    requestHash: hashIdempotencyRequest(normalizedRequest),
  };
}

function idempotencyConflictMessage(): string {
  return "This Idempotency-Key was already used with a different request";
}

function idempotencyInProgressMessage(): string {
  return "An identical request is already in progress";
}

function markIdempotencyReplay(res: Response): void {
  res.setHeader("Idempotency-Replayed", "true");
}

function correctionErrorResponse(res: Response, err: unknown): boolean {
  if (!(err instanceof InvoiceCorrectionValidationError)) return false;
  const status = err.code === "invoice_not_found" ? 404 : 400;
  res.status(status).json({ error: err.message, code: err.code });
  return true;
}

async function respondWithInvoice(
  res: Response,
  dependencies: InvoiceCorrectionRouteDependencies,
  invoiceId: number,
  status: number,
  replayed = false,
): Promise<void> {
  const invoice = await dependencies.findInvoiceById(invoiceId);
  if (!invoice) {
    res.status(404).json({ error: "The idempotent invoice no longer exists" });
    return;
  }
  if (replayed) markIdempotencyReplay(res);
  const [enriched] = await dependencies.enrichInvoices([invoice]);
  res.status(status).json(enriched);
}

async function runCorrection(
  req: Request,
  res: Response,
  dependencies: InvoiceCorrectionRouteDependencies,
  operation: string,
  normalizedRequest: unknown,
  perform: (tx: InvoiceCorrectionRouteTransaction) => Promise<CompletedCorrection>,
): Promise<void> {
  try {
    const idempotency = requiredIdempotencyContext(req, operation, normalizedRequest);
    const result = await dependencies.transaction(async (tx) => {
      const claim = await tx.claimIdempotencyKey(idempotency);
      if (claim.kind !== "claimed") return claim;
      const effect = await perform(tx);
      await tx.completeIdempotencyKey(claim.record.id, {
        resourceType: "invoice",
        resourceId: effect.resourceId,
        responseStatus: effect.responseStatus,
      });
      return { kind: "completed" as const, effect };
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
      await respondWithInvoice(
        res,
        dependencies,
        result.record.resourceId!,
        result.record.responseStatus ?? 200,
        true,
      );
      return;
    }
    await respondWithInvoice(
      res,
      dependencies,
      result.effect.resourceId,
      result.effect.responseStatus,
    );
  } catch (err) {
    if (!correctionErrorResponse(res, err)) {
      console.error(err);
      res.status(500).json({ error: "Failed to process invoice correction" });
    }
  }
}

function normalizeReasonBody(req: Request): { invoiceId: number; reason: string } {
  return {
    invoiceId: Number(req.params.id),
    reason: String((req.body as { reason?: unknown }).reason ?? ""),
  };
}

function normalizeCreditLines(value: unknown): CreditLineInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = entry as { invoiceLineId?: unknown; amount?: unknown; description?: unknown };
    return {
      invoiceLineId: item.invoiceLineId == null ? null : Number(item.invoiceLineId),
      amount: String(item.amount ?? ""),
      description: item.description == null ? null : String(item.description),
    };
  });
}

export function createVoidInvoicePostHandler(dependencies: InvoiceCorrectionRouteDependencies) {
  return (req: Request, res: Response): Promise<void> => {
    const normalized = normalizeReasonBody(req);
    return runCorrection(req, res, dependencies, "invoices.void", normalized, async (tx) => {
      const effect = await voidInvoiceCore(
        normalized.invoiceId,
        normalized.reason,
        tx.createCorrectionAdapter(),
        dependencies.getPerformedBy(req),
      );
      return { resourceId: effect.invoice.id, responseStatus: 200 };
    });
  };
}

export function createInvoiceCreditNotePostHandler(dependencies: InvoiceCorrectionRouteDependencies) {
  return (req: Request, res: Response): Promise<void> => {
    const body = req.body as { reason?: unknown; lines?: unknown };
    const normalized = {
      invoiceId: Number(req.params.id),
      reason: String(body.reason ?? ""),
      lines: normalizeCreditLines(body.lines),
    };
    return runCorrection(req, res, dependencies, "invoices.credit_note", normalized, async (tx) => {
      const effect = await createCreditNoteCore(
        normalized.invoiceId,
        normalized.reason,
        normalized.lines,
        dependencies.createCreditNumber(normalized.invoiceId),
        tx.createCorrectionAdapter(),
        dependencies.getPerformedBy(req),
      );
      return { resourceId: effect.invoice.id, responseStatus: 201 };
    });
  };
}

export function createInvoiceReissuePostHandler(dependencies: InvoiceCorrectionRouteDependencies) {
  return (req: Request, res: Response): Promise<void> => {
    const normalized = normalizeReasonBody(req);
    return runCorrection(req, res, dependencies, "invoices.reissue", normalized, async (tx) => {
      const effect = await reissueInvoiceCore(
        normalized.invoiceId,
        normalized.reason,
        dependencies.createReissueNumber(normalized.invoiceId),
        tx.createCorrectionAdapter(),
        dependencies.getPerformedBy(req),
      );
      return { resourceId: effect.replacement.id, responseStatus: 201 };
    });
  };
}