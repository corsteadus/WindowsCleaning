import type { Request, Response } from "express";
import {
  createInvoiceCore,
  InvoiceValidationError,
  normalizeLegacyInvoiceLines,
  // @ts-ignore Node's strip-types test runner executes this source module directly.
} from "./invoice-core.ts";
// @ts-ignore Node's strip-types test runner executes this source module directly.
import { hashIdempotencyRequest } from "./idempotency-core.ts";
import type { InvoiceCreateAdapter } from "./invoice-core.js";
import type { CommunicationEventInput } from "./communication-outbox.js";
// @ts-ignore Node's strip-types test runner executes this source module directly.
import { AccountRelationError } from "./account-relations.ts";

export type InvoiceCreateStoredInvoice = {
  id: number;
  customerId: number;
  jobId: number | null;
  invoiceNumber: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  paidAt: string | Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InvoiceCreateIdempotencyRecord = {
  id: number;
  requestHash: string;
  status: string;
  resourceId: number | null;
  responseStatus: number | null;
};

export type InvoiceCreateIdempotencyClaim =
  | { kind: "claimed"; record: InvoiceCreateIdempotencyRecord }
  | { kind: "replay"; record: InvoiceCreateIdempotencyRecord }
  | { kind: "conflict"; record: InvoiceCreateIdempotencyRecord }
  | { kind: "inProgress"; record: InvoiceCreateIdempotencyRecord };

export type InvoiceCreateIdempotencyCompletion = {
  resourceType: string;
  resourceId: number;
  responseStatus: number;
};

export type InvoiceCreateTransaction = {
  createInvoiceAdapter(): InvoiceCreateAdapter;
  resolvePropertyId?(
    customerId: number,
    requestedPropertyId: number | null | undefined,
  ): Promise<number | null>;
  enqueueCommunicationEvent(input: CommunicationEventInput): Promise<unknown>;
  claimIdempotencyKey(input: {
    scope: string;
    operation: string;
    clientKey: string;
    requestHash: string;
  }): Promise<InvoiceCreateIdempotencyClaim>;
  completeIdempotencyKey(id: number, completion: InvoiceCreateIdempotencyCompletion): Promise<void>;
};

export type InvoiceCreateRouteDependencies = {
  transaction<T>(callback: (tx: InvoiceCreateTransaction) => Promise<T>): Promise<T>;
  findInvoiceById(id: number): Promise<InvoiceCreateStoredInvoice | undefined>;
  enrichInvoices(invoices: InvoiceCreateStoredInvoice[]): Promise<unknown[]>;
  recordInvoiceCreation?(req: Request, customerId: number, invoice: { invoiceNumber: string; totalAmount: string }): Promise<void>;
};

function getIdempotencyContext(
  req: Request,
  operation: string,
  normalizedRequest: unknown,
): { scope: string; operation: string; clientKey: string; requestHash: string } | null {
  const rawKey = req.get("Idempotency-Key");
  const clientKey = rawKey?.trim() ?? "";
  if (!clientKey) return null;
  if (clientKey.length > 255) throw new Error("Idempotency-Key must be 255 characters or fewer");
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

export function createInvoicePostHandler(
  dependencies: InvoiceCreateRouteDependencies,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body;
      if (!body.customerId) {
        res.status(400).json({ error: "customerId is required" });
        return;
      }
      const legacyJobId = body.jobId == null ? null : Number(body.jobId);
      const requestedJobIds = Array.isArray(body.jobIds)
        ? body.jobIds.map(Number)
        : legacyJobId == null ? [] : [legacyJobId];
      const lines = Array.isArray(body.lines)
        ? body.lines
        : normalizeLegacyInvoiceLines(
            body.lineItems,
            legacyJobId,
            body.totalAmount ?? body.subtotal ?? 0,
          );
      const normalizedRequest = {
        customerId: Number(body.customerId),
        propertyId: body.propertyId === undefined
          ? undefined
          : body.propertyId === null || body.propertyId === ""
            ? null
            : Number(body.propertyId),
        jobIds: requestedJobIds,
        lines,
        status: body.status ?? "draft",
        amountPaid: String(body.amountPaid ?? 0),
        dueDate: body.dueDate ?? null,
        notes: body.notes ?? null,
      };
      const idempotency = getIdempotencyContext(req, "invoices.create", normalizedRequest);
      const result = await dependencies.transaction(async (tx) => {
        const claim = idempotency ? await tx.claimIdempotencyKey(idempotency) : null;
        if (claim && claim.kind !== "claimed") return claim;
        const propertyId = tx.resolvePropertyId
          ? await tx.resolvePropertyId(normalizedRequest.customerId, normalizedRequest.propertyId)
          : normalizedRequest.propertyId ?? null;
        const created = await createInvoiceCore({
          customerId: normalizedRequest.customerId,
          propertyId,
          jobIds: normalizedRequest.jobIds,
          lines: normalizedRequest.lines,
          status: normalizedRequest.status,
          amountPaid: normalizedRequest.amountPaid,
          dueDate: normalizedRequest.dueDate,
          notes: normalizedRequest.notes,
        }, tx.createInvoiceAdapter());
        if (created.invoice.status === "sent") {
          await tx.enqueueCommunicationEvent({
            eventType: "invoice.sent",
            aggregateType: "invoice",
            aggregateId: created.invoice.id,
            payload: {
              customerId: created.invoice.customerId,
              invoiceId: created.invoice.id,
              status: created.invoice.status,
            },
            source: "invoices.create",
            idempotencyKey: idempotency?.clientKey ?? null,
            dedupeKey: `invoice.sent:${created.invoice.id}:${
              typeof created.invoice.updatedAt === "string"
                ? created.invoice.updatedAt
                : created.invoice.updatedAt.toISOString()
            }`,
          });
        }
        if (claim) {
          await tx.completeIdempotencyKey(claim.record.id, {
            resourceType: "invoice",
            resourceId: created.invoice.id,
            responseStatus: 201,
          });
        }
        return { kind: "created" as const, ...created };
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
        const replayed = await dependencies.findInvoiceById(result.record.resourceId!);
        if (!replayed) {
          res.status(404).json({ error: "The idempotent invoice no longer exists" });
          return;
        }
        markIdempotencyReplay(res);
        const [enrichedReplay] = await dependencies.enrichInvoices([replayed]);
        res.status(result.record.responseStatus ?? 201).json(enrichedReplay);
        return;
      }
      const invoice = result.invoice;
      await dependencies.recordInvoiceCreation?.(req, normalizedRequest.customerId, invoice);
      const [enriched] = await dependencies.enrichInvoices([
        invoice as InvoiceCreateStoredInvoice,
      ]);
      res.status(201).json(enriched);
    } catch (err) {
      if (err instanceof InvoiceValidationError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      if (err instanceof AccountRelationError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  };
}