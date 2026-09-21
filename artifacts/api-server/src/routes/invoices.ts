import { Router, type IRouter, type Request } from "express";
import { eq, inArray, desc, or, ilike, and, sql } from "drizzle-orm";
import {
  db,
  invoicesTable,
  customersTable,
  jobsTable,
  propertiesTable,
  activityLogsTable,
  invoiceJobsTable,
  invoiceLinesTable,
  invoiceVoidsTable,
  invoiceCreditNotesTable,
  invoiceCreditLinesTable,
  invoiceReissuesTable,
  paymentAllocationsTable,
  customerCreditSourcesTable,
  messageLogsTable,
} from "@workspace/db";
import {
  type InvoiceCreateAdapter,
} from "../lib/invoice-core.js";
import {
  createInvoicePostHandler,
  type InvoiceCreateRouteDependencies,
} from "../lib/invoice-create-handler.js";
import {
  createPaymentCore,
  PaymentValidationError,
} from "../lib/payment-core.js";
import { assertPaymentCustomer, createPaymentAdapter } from "../lib/payment-adapter.js";
import {
  type InvoiceCorrectionAdapter,
} from "../lib/invoice-correction-core.js";
import {
  createInvoiceCreditNotePostHandler,
  createInvoiceReissuePostHandler,
  createVoidInvoicePostHandler,
  type InvoiceCorrectionRouteDependencies,
} from "../lib/invoice-correction-handler.js";
import { serializeInvoiceCorrectionHistory } from "../lib/invoice-correction-history.js";
import { correctedInvoiceDeleteError, correctedInvoicePatchError } from "../lib/invoice-legacy-protection.js";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyContext,
  idempotencyConflictMessage,
  idempotencyInProgressMessage,
  markIdempotencyReplay,
  releaseIdempotencyKey,
} from "../lib/idempotency.js";
import {
  approvalRequired,
  getActiveFinancialApprovalPolicy,
  parseApprovalAmountCents,
  submitFinancialApproval,
  FinancialApprovalValidationError,
} from "../lib/financial-approval-service.js";
import { requireFinancialCapability } from "../lib/financial-permissions.js";
import { enqueueCommunicationEvent } from "../lib/communication-outbox.js";
import {
  AccountRelationError,
  effectiveDefaultPropertyIdForCustomer,
  normalizeOptionalPropertyId,
  requireActivePropertyForCustomer,
} from "../lib/account-relations.js";
import { maskCommunicationDestination } from "../lib/communication-safety-store.js";
import { normalizeCommunicationDestination } from "../lib/communication-safety-core.js";
import { businessDateStr } from "../lib/date.ts";

function getPerformedBy(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || String((req.user as { id: string }).id);
}

const router: IRouter = Router();
type DrizzleTX = Parameters<Parameters<typeof db.transaction>[0]>[0];
const INVOICE_FINANCIAL_PATCH_FIELDS = ["subtotal", "taxAmount", "totalAmount", "amountPaid", "lineItems"] as const;

function requireInvoicePatchCapability(req: Request, res: import("express").Response, next: import("express").NextFunction): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetStatus = body.status == null ? null : String(body.status);
  const financialFieldChanged = INVOICE_FINANCIAL_PATCH_FIELDS.some((field) => body[field] !== undefined);
  const capability = targetStatus === "voided"
    ? "invoices.void"
    : targetStatus === "credited" || targetStatus === "partially_credited"
      ? "invoices.credit"
      : targetStatus === "paid" || financialFieldChanged
        ? "payments.record"
        : null;
  if (!capability) {
    next();
    return;
  }
  requireFinancialCapability(capability)(req, res, next);
}

function createInvoiceAdapter(tx: DrizzleTX): InvoiceCreateAdapter {
  return {
    acquireJobLocks: async (jobIds) => {
      if (!jobIds.length) return;
      const ids = sql.join(jobIds.map((jobId) => sql`${jobId}`), sql`, `);
      await tx.execute(sql`
        SELECT id FROM jobs
        WHERE id IN (${ids})
        ORDER BY id
        FOR UPDATE
      `);
    },
    findJobsByIds: async (jobIds) => {
      if (!jobIds.length) return [];
      return tx.select({
        id: jobsTable.id,
        customerId: jobsTable.customerId,
        jobNumber: jobsTable.jobNumber,
        propertyId: jobsTable.propertyId,
        scheduledDate: jobsTable.scheduledDate,
        totalAmount: jobsTable.totalAmount,
        status: jobsTable.status,
      }).from(jobsTable).where(inArray(jobsTable.id, jobIds));
    },
    insertInvoice: async (values) => {
      const [invoice] = await tx.insert(invoicesTable).values(values).returning();
      return invoice;
    },
    insertInvoiceJob: async (values) => {
      await tx.insert(invoiceJobsTable).values(values);
    },
    insertInvoiceLine: async (values) => {
      await tx.insert(invoiceLinesTable).values(values);
    },
  };
}

async function resolveInvoicePropertyId(
  tx: DrizzleTX,
  customerId: number,
  requestedPropertyId: number | null | undefined,
): Promise<number | null> {
  const propertyId = requestedPropertyId === undefined
    ? await effectiveDefaultPropertyIdForCustomer(tx, customerId)
    : requestedPropertyId;
  if (propertyId == null) return null;
  await requireActivePropertyForCustomer(tx, customerId, propertyId);
  return propertyId;
}

export function createInvoiceCorrectionAdapter(tx: DrizzleTX): InvoiceCorrectionAdapter {
  return {
    acquireInvoiceLock: async (invoiceId) => {
      await tx.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`);
    },
    findInvoiceById: async (invoiceId) => {
      const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
      return invoice ?? null;
    },
    hasPaymentAllocations: async (invoiceId) => {
      const [allocation] = await tx
        .select({ id: paymentAllocationsTable.id })
        .from(paymentAllocationsTable)
        .where(eq(paymentAllocationsTable.invoiceId, invoiceId))
        .limit(1);
      return Boolean(allocation);
    },
    findInvoiceLines: async (invoiceId) => tx
      .select()
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, invoiceId))
      .orderBy(invoiceLinesTable.sortOrder, invoiceLinesTable.id),
    findCreditLines: async (invoiceId) => tx
      .select({
        invoiceLineId: invoiceCreditLinesTable.invoiceLineId,
        creditAmount: invoiceCreditLinesTable.creditAmount,
      })
      .from(invoiceCreditLinesTable)
      .innerJoin(invoiceCreditNotesTable, eq(invoiceCreditNotesTable.id, invoiceCreditLinesTable.creditNoteId))
      .where(eq(invoiceCreditNotesTable.invoiceId, invoiceId)),
    insertVoid: async (values) => {
      const [record] = await tx.insert(invoiceVoidsTable).values(values).returning({ id: invoiceVoidsTable.id });
      return record;
    },
    insertCreditNote: async (values) => {
      const [record] = await tx.insert(invoiceCreditNotesTable).values(values).returning({ id: invoiceCreditNotesTable.id });
      return record;
    },
    insertCustomerCreditSource: async (values) => {
      await tx.insert(customerCreditSourcesTable).values(values).onConflictDoNothing({ target: customerCreditSourcesTable.sourceKey });
    },
    insertCreditLine: async (values) => {
      await tx.insert(invoiceCreditLinesTable).values(values);
    },
    updateInvoice: async (invoiceId, values) => {
      const [invoice] = await tx.update(invoicesTable).set(values).where(eq(invoicesTable.id, invoiceId)).returning();
      if (!invoice) throw new Error("Invoice disappeared during correction");
      return invoice;
    },
    findLinkedJobIds: async (invoiceId, legacyJobId) => {
      const associations = await tx
        .select({ jobId: invoiceJobsTable.jobId })
        .from(invoiceJobsTable)
        .where(eq(invoiceJobsTable.invoiceId, invoiceId))
        .orderBy(invoiceJobsTable.jobId);
      const ids = associations.map((row) => row.jobId);
      return ids.length ? ids : (legacyJobId ? [legacyJobId] : []);
    },
    findActiveReissue: async (sourceInvoiceId) => {
      const [record] = await tx
        .select({ id: invoiceReissuesTable.id, replacementInvoiceId: invoiceReissuesTable.replacementInvoiceId })
        .from(invoiceReissuesTable)
        .where(and(
          eq(invoiceReissuesTable.sourceInvoiceId, sourceInvoiceId),
          eq(invoiceReissuesTable.isActive, true),
        ));
      return record ?? null;
    },
    insertReplacementInvoice: async (values) => {
      const [invoice] = await tx.insert(invoicesTable).values(values).returning();
      return invoice;
    },
    insertReplacementJob: async (values) => {
      await tx.insert(invoiceJobsTable).values(values);
    },
    insertReplacementLine: async (values) => {
      await tx.insert(invoiceLinesTable).values({
        invoiceId: values.invoiceId,
        jobId: values.jobId,
        description: values.description,
        quantity: values.quantity,
        unitPrice: values.unitPrice,
        discountAmount: values.discountAmount,
        taxAmount: values.taxAmount,
        lineTotal: values.creditAmount,
        sortOrder: values.sortOrder,
      });
    },
    insertReissue: async (values) => {
      const [record] = await tx.insert(invoiceReissuesTable).values(values).returning({ id: invoiceReissuesTable.id });
      return record;
    },
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function serialize(i: typeof invoicesTable.$inferSelect) {
  return {
    ...i,
    subtotal: Number(i.subtotal),
    taxAmount: Number(i.taxAmount),
    totalAmount: Number(i.totalAmount),
    amountPaid: Number(i.amountPaid),
    balanceDue: Number(i.balanceDue),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

async function enrichInvoices(invoices: (typeof invoicesTable.$inferSelect)[]) {
  if (!invoices.length) return [];

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const customerIds = [...new Set(invoices.map((i) => i.customerId))];
  const legacyJobIds = [...new Set(invoices.map((i) => i.jobId).filter(Boolean) as number[])];

  const customers = customerIds.length
    ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds))
    : [];
  const associations = await db
    .select()
    .from(invoiceJobsTable)
    .where(inArray(invoiceJobsTable.invoiceId, invoiceIds));
  const jobIds = [...new Set([
    ...legacyJobIds,
    ...associations.map((association) => association.jobId),
  ])];
  const jobs = jobIds.length
    ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
    : [];
  const propertyIds = [...new Set([
    ...invoices.map((invoice) => invoice.propertyId),
    ...jobs.map((job) => job.propertyId),
  ].filter(Boolean) as number[])];
  const properties = propertyIds.length
    ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
    : [];
  const lines = await db
    .select()
    .from(invoiceLinesTable)
    .where(inArray(invoiceLinesTable.invoiceId, invoiceIds))
    .orderBy(invoiceLinesTable.sortOrder, invoiceLinesTable.id);
  const voids = await db
    .select()
    .from(invoiceVoidsTable)
    .where(inArray(invoiceVoidsTable.invoiceId, invoiceIds));
  const creditNotes = await db
    .select()
    .from(invoiceCreditNotesTable)
    .where(inArray(invoiceCreditNotesTable.invoiceId, invoiceIds))
    .orderBy(invoiceCreditNotesTable.id);
  const creditNoteIds = creditNotes.map((note) => note.id);
  const creditLines = creditNoteIds.length
    ? await db.select().from(invoiceCreditLinesTable)
      .where(inArray(invoiceCreditLinesTable.creditNoteId, creditNoteIds))
      .orderBy(invoiceCreditLinesTable.sortOrder, invoiceCreditLinesTable.id)
    : [];
  const reissues = await db
    .select()
    .from(invoiceReissuesTable)
    .where(or(
      inArray(invoiceReissuesTable.sourceInvoiceId, invoiceIds),
      inArray(invoiceReissuesTable.replacementInvoiceId, invoiceIds),
    ));
  const communications = await db.select().from(messageLogsTable)
    .where(and(eq(messageLogsTable.relatedType, "invoice"), inArray(messageLogsTable.relatedId, invoiceIds)))
    .orderBy(desc(messageLogsTable.createdAt));

  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c]));
  const jobMap = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const propertyMap = Object.fromEntries(properties.map((property) => [property.id, property]));
  const associationMap = new Map<number, number[]>();
  for (const association of associations) {
    const current = associationMap.get(association.invoiceId) ?? [];
    current.push(association.jobId);
    associationMap.set(association.invoiceId, current);
  }
  const lineMap = new Map<number, typeof lines>();
  for (const line of lines) {
    const current = lineMap.get(line.invoiceId) ?? [];
    current.push(line);
    lineMap.set(line.invoiceId, current);
  }
  const voidMap = new Map(voids.map((record) => [record.invoiceId, record]));
  const creditLineMap = new Map<number, typeof creditLines>();
  for (const line of creditLines) {
    const current = creditLineMap.get(line.creditNoteId) ?? [];
    current.push(line);
    creditLineMap.set(line.creditNoteId, current);
  }
  const notesMap = new Map<number, typeof creditNotes>();
  for (const note of creditNotes) {
    const current = notesMap.get(note.invoiceId) ?? [];
    current.push(note);
    notesMap.set(note.invoiceId, current);
  }

  return invoices.map((inv) => {
    const c = customerMap[inv.customerId];
    const linkedJobIds = associationMap.get(inv.id) ?? (inv.jobId ? [inv.jobId] : []);
    const linkedJobs = linkedJobIds
      .map((jobId) => jobMap[jobId])
      .filter(Boolean)
      .map((job) => {
        const property = job.propertyId ? propertyMap[job.propertyId] : null;
        return {
          id: job.id,
          jobNumber: job.jobNumber,
          customerId: job.customerId,
          propertyId: job.propertyId,
          propertyName: property?.name ?? null,
          propertyAddress: property
            ? [property.address, property.city, property.state, property.zip].filter(Boolean).join(", ")
            : null,
          scheduledDate: job.scheduledDate,
        };
      });
    const j = inv.jobId ? jobMap[inv.jobId] : linkedJobs[0];
    const property = inv.propertyId ? propertyMap[inv.propertyId] : null;
    return {
      ...serialize(inv),
      customerName: c ? `${c.firstName} ${c.lastName}` : `Customer #${inv.customerId}`,
      jobNumber: j?.jobNumber ?? null,
      propertyName: property?.name ?? null,
      propertyAddress: property
        ? [property.address, property.city, property.state, property.zip].filter(Boolean).join(", ")
        : null,
      linkedJobs,
      invoiceLines: (lineMap.get(inv.id) ?? []).map((line) => ({
        id: line.id,
        invoiceId: line.invoiceId,
        jobId: line.jobId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
        sortOrder: line.sortOrder,
        createdAt: line.createdAt.toISOString(),
      })),
      correctionHistory: serializeInvoiceCorrectionHistory({
        voidRecord: voidMap.get(inv.id) ?? null,
        creditNotes: (notesMap.get(inv.id) ?? []).map((note) => ({
          ...note,
          lines: creditLineMap.get(note.id) ?? [],
        })),
        reissue: reissues.find((candidate) => candidate.sourceInvoiceId === inv.id) ?? null,
        replacementOf: reissues.find((candidate) => candidate.replacementInvoiceId === inv.id) ?? null,
      }),
      communications: communications
        .filter((message) => message.relatedId === inv.id)
        .map((message) => {
          let recipient: string | null = null;
          if (message.recipient && (message.channel === "email" || message.channel === "sms")) {
            if (message.recipient.includes("*")) {
              recipient = message.recipient;
            } else try {
              recipient = maskCommunicationDestination(
                message.channel,
                normalizeCommunicationDestination(message.channel, message.recipient).normalized,
              );
            } catch {
              recipient = null;
            }
          }
          return { ...message, recipient, body: "[redacted]", createdAt: message.createdAt.toISOString(), updatedAt: message.updatedAt.toISOString() };
        }),
    };
  });
}

const productionInvoiceCreateDependencies: InvoiceCreateRouteDependencies = {
  transaction: (callback) => db.transaction((tx) => callback({
    createInvoiceAdapter: () => createInvoiceAdapter(tx),
    resolvePropertyId: (customerId, requestedPropertyId) =>
      resolveInvoicePropertyId(tx, customerId, requestedPropertyId),
    enqueueCommunicationEvent: (input) => enqueueCommunicationEvent(tx, input),
    claimIdempotencyKey: (input) => claimIdempotencyKey(tx, input),
    completeIdempotencyKey: (id, completion) => completeIdempotencyKey(tx, id, completion),
  })),
  findInvoiceById: async (id) => {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    return invoice;
  },
  enrichInvoices: (invoices) => enrichInvoices(invoices as (typeof invoicesTable.$inferSelect)[]),
  recordInvoiceCreation: async (req, customerId, invoice) => {
    await db.insert(activityLogsTable).values({
      entityType:  "customer",
      entityId:    customerId,
      action:      "invoice_created",
      toValue:     invoice.invoiceNumber,
      note:        `Invoice ${invoice.invoiceNumber} created for $${Number(invoice.totalAmount).toFixed(2)}`,
      performedBy: getPerformedBy(req),
    }).catch(() => {});
  },
};

// ─── routes ──────────────────────────────────────────────────────────────────

// ─── GET /invoices/stats — status counts (lightweight) ───────────────────────
router.get("/invoices/stats", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        status: invoicesTable.status,
        count:  sql<number>`COUNT(*)::int`,
      })
      .from(invoicesTable)
      .groupBy(invoicesTable.status);

    const stats: Record<string, number> = {
      all: 0, draft: 0, sent: 0, paid: 0, overdue: 0,
      partial: 0, voided: 0, credited: 0, partially_credited: 0,
    };
    for (const r of rows) {
      stats[r.status] = r.count;
      stats.all += r.count;
    }
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/invoices", async (req, res): Promise<void> => {
  try {
     const { customerId, status, jobId, search, page, limit: limitParam } = req.query;
    const isPaginated = page !== undefined || search !== undefined;
    const pageNum  = Math.max(1, parseInt(String(page  ?? "1"), 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(String(limitParam ?? "50"), 10)));
    const offset   = (pageNum - 1) * pageSize;

    // Build base conditions (filter by customerId / jobId / status)
    const baseConditions = [];
    if (jobId) {
      const linked = await db
        .select({ invoiceId: invoiceJobsTable.invoiceId })
        .from(invoiceJobsTable)
        .where(eq(invoiceJobsTable.jobId, Number(jobId)));
      const linkedInvoiceIds = linked.map((row) => row.invoiceId);
      baseConditions.push(
        linkedInvoiceIds.length
          ? or(eq(invoicesTable.jobId, Number(jobId)), inArray(invoicesTable.id, linkedInvoiceIds))
          : eq(invoicesTable.jobId, Number(jobId)),
      );
    }
    if (customerId) baseConditions.push(eq(invoicesTable.customerId, Number(customerId)));
    if (status && String(status) !== "all") {
      baseConditions.push(eq(invoicesTable.status, String(status)));
    }

    let invoices;
    if (search) {
      const term = `%${String(search).trim()}%`;

      // Find customers matching the search term
      const matchingCustomers = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(or(
          ilike(customersTable.firstName, term),
          ilike(customersTable.lastName,  term),
        ));
      const matchingCustomerIds = matchingCustomers.map((c) => c.id);

      // Search: invoice number OR matching customer id
      const searchCond = matchingCustomerIds.length > 0
        ? or(ilike(invoicesTable.invoiceNumber, term), inArray(invoicesTable.customerId, matchingCustomerIds))
        : ilike(invoicesTable.invoiceNumber, term);

      const where = baseConditions.length > 0
        ? and(...baseConditions, searchCond)
        : searchCond;

      invoices = await db.select().from(invoicesTable).where(where)
        .orderBy(desc(invoicesTable.createdAt)).limit(pageSize).offset(offset);
    } else if (baseConditions.length > 0) {
      const where = baseConditions.length === 1 ? baseConditions[0] : and(...baseConditions);
      if (isPaginated) {
        invoices = await db.select().from(invoicesTable).where(where)
          .orderBy(desc(invoicesTable.createdAt)).limit(pageSize).offset(offset);
      } else {
        invoices = await db.select().from(invoicesTable).where(where)
          .orderBy(desc(invoicesTable.createdAt));
      }
    } else {
      if (isPaginated) {
        invoices = await db.select().from(invoicesTable)
          .orderBy(desc(invoicesTable.createdAt)).limit(pageSize).offset(offset);
      } else {
        // Legacy: no filters, cap at 50 newest for performance (old clients)
        invoices = await db.select().from(invoicesTable)
          .orderBy(desc(invoicesTable.createdAt)).limit(50);
      }
    }

    const enriched = await enrichInvoices(invoices);

    // Paginated mode: return { data, page, pageSize, hasMore }
    if (isPaginated) {
      res.json({ data: enriched, page: pageNum, pageSize, hasMore: enriched.length === pageSize });
    } else {
      res.json(enriched);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

router.post("/invoices", createInvoicePostHandler(productionInvoiceCreateDependencies));

const productionInvoiceCorrectionDependencies: InvoiceCorrectionRouteDependencies = {
  transaction: (callback) => db.transaction((tx) => callback({
    createCorrectionAdapter: () => createInvoiceCorrectionAdapter(tx),
    claimIdempotencyKey: (input) => claimIdempotencyKey(tx, input),
    completeIdempotencyKey: (id, completion) => completeIdempotencyKey(tx, id, completion),
  })),
  findInvoiceById: async (id) => {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    return invoice ?? null;
  },
  enrichInvoices: (invoices) => enrichInvoices(invoices as (typeof invoicesTable.$inferSelect)[]),
  getPerformedBy,
  createCreditNumber: (id) => `CN-${id}-${Date.now()}`,
  createReissueNumber: (id) => `INV-${Date.now()}-${id}`,
};

// Corrections are separate, immutable workflows. The legacy PATCH/DELETE paths
// remain available for existing non-accounting administration behavior.
function correctionApprovalError(res: any, error: unknown): boolean {
  if (!(error instanceof FinancialApprovalValidationError)) return false;
  const status = error.code === "unauthorized" ? 401 : error.code.startsWith("approval_") ? 409 : 400;
  res.status(status).json({ error: error.message, code: error.code });
  return true;
}

async function submitCorrectionApproval(
  req: Request,
  res: any,
  action: "invoices.void" | "invoices.credit" | "invoices.reissue",
  targetId: number,
  payload: unknown,
  amountCents: bigint,
  reason: string,
): Promise<boolean> {
  const policy = await getActiveFinancialApprovalPolicy(action);
  if (!approvalRequired(policy, amountCents)) return false;
  try {
    const result = await submitFinancialApproval({
      req,
      actionType: action,
      targetType: "invoice",
      targetIds: [targetId],
      canonicalPayload: payload,
      amountCents,
      reason,
    });
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
  } catch (error) {
    if (correctionApprovalError(res, error)) return true;
    throw error;
  }
}

const voidInvoiceHandler = createVoidInvoicePostHandler(productionInvoiceCorrectionDependencies);
const creditNoteHandler = createInvoiceCreditNotePostHandler(productionInvoiceCorrectionDependencies);
const reissueInvoiceHandler = createInvoiceReissuePostHandler(productionInvoiceCorrectionDependencies);

router.post("/invoices/:id/void", requireFinancialCapability("invoices.void"), async (req, res): Promise<void> => {
  const invoiceId = Number(req.params.id);
  const reason = String((req.body as { reason?: unknown }).reason ?? "");
  const [invoice] = await db.select({ totalAmount: invoicesTable.totalAmount }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (invoice) {
    const handled = await submitCorrectionApproval(req, res, "invoices.void", invoiceId, { invoiceId, reason }, parseApprovalAmountCents(invoice.totalAmount), reason);
    if (handled) return;
  }
  return voidInvoiceHandler(req, res);
});

router.post("/invoices/:id/credit-notes", requireFinancialCapability("invoices.credit"), async (req, res): Promise<void> => {
  const invoiceId = Number(req.params.id);
  const body = req.body as { reason?: unknown; lines?: unknown };
  const lines = Array.isArray(body.lines) ? body.lines : [];
  let amountCents = 0n;
  try {
    amountCents = lines.reduce((sum, entry) => sum + parseApprovalAmountCents((entry as { amount?: unknown }).amount), 0n);
  } catch {
    return creditNoteHandler(req, res);
  }
  const handled = await submitCorrectionApproval(
    req,
    res,
    "invoices.credit",
    invoiceId,
    { invoiceId, reason: String(body.reason ?? ""), lines },
    amountCents,
    String(body.reason ?? ""),
  );
  if (handled) return;
  return creditNoteHandler(req, res);
});

router.post("/invoices/:id/reissue", requireFinancialCapability("invoices.reissue"), async (req, res): Promise<void> => {
  const invoiceId = Number(req.params.id);
  const reason = String((req.body as { reason?: unknown }).reason ?? "");
  const [invoice] = await db.select({ totalAmount: invoicesTable.totalAmount }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (invoice) {
    const handled = await submitCorrectionApproval(req, res, "invoices.reissue", invoiceId, { invoiceId, reason }, parseApprovalAmountCents(invoice.totalAmount), reason);
    if (handled) return;
  }
  return reissueInvoiceHandler(req, res);
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invoice id must be a positive integer" });
      return;
    }
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    const [enriched] = await enrichInvoices([invoice]);
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

router.patch("/invoices/:id", requireInvoicePatchCapability, async (req, res): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const body = req.body;

    if (body.status === "paid") {
      const idempotency = getIdempotencyContext(req, "invoices.mark_paid", {
        invoiceId: id,
        status: "paid",
      });
      const result = await db.transaction(async (tx) => {
        const claim = idempotency ? await claimIdempotencyKey(tx, idempotency) : null;
        if (claim && claim.kind !== "claimed") return claim;
        const [current] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id));
        if (!current) {
          if (claim) await releaseIdempotencyKey(tx, claim.record.id);
          return { kind: "notFound" as const };
        }
        if (current.status === "voided" || current.status === "credited") {
          if (claim) await releaseIdempotencyKey(tx, claim.record.id);
          throw new PaymentValidationError("invoice_not_payable", "Voided and fully credited invoices cannot receive payments");
        }
        if (current.status === "paid" || current.balanceDue === "0" || current.balanceDue === "0.00") {
          if (claim) {
            await completeIdempotencyKey(tx, claim.record.id, {
              resourceType: "invoice",
              resourceId: current.id,
              responseStatus: 200,
            });
          }
          return { kind: "existing" as const, invoice: current };
        }
        await assertPaymentCustomer(tx, current.customerId);
        const effect = await createPaymentCore({
          customerId: current.customerId,
          amount: current.balanceDue,
          paymentDate: businessDateStr(),
          method: "manual",
          reference: `Invoice ${current.invoiceNumber}`,
          note: "Marked paid from the CRM invoice action",
          mode: "manual",
          allocations: [{ invoiceId: id, amount: current.balanceDue }],
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
          source: "invoices.mark_paid",
          actorId: getPerformedBy(req),
          idempotencyKey: idempotency?.clientKey ?? null,
          dedupeKey: `payment.received:${effect.payment.id}`,
        });
        if (claim) {
          await completeIdempotencyKey(tx, claim.record.id, {
            resourceType: "invoice",
            resourceId: current.id,
            responseStatus: 200,
          });
        }
        return { kind: "payment" as const, effect, previous: current };
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
        const [replayedInvoice] = await db
          .select()
          .from(invoicesTable)
          .where(eq(invoicesTable.id, result.record.resourceId!));
        if (!replayedInvoice) {
          res.status(404).json({ error: "The idempotent invoice no longer exists" });
          return;
        }
        markIdempotencyReplay(res);
        const [enrichedReplay] = await enrichInvoices([replayedInvoice]);
        res.status(result.record.responseStatus ?? 200).json(enrichedReplay);
        return;
      }

      if (result.kind === "notFound") {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      if (result.kind === "payment") {
        await db.insert(activityLogsTable).values({
          entityType: "customer",
          entityId: result.previous.customerId,
          action: "invoice_status_changed",
          fromValue: result.previous.status,
          toValue: "paid",
          note: `Invoice ${result.previous.invoiceNumber} marked as paid`,
          performedBy: getPerformedBy(req),
        }).catch(() => {});
      }

      const [paidInvoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
      const [enriched] = await enrichInvoices(paidInvoice ? [paidInvoice] : []);
      res.json(enriched);
      return;
    }

    const result = await db.transaction(async (tx) => {
      const updateData: Record<string, unknown> = {};
      if (body.status !== undefined) {
        updateData.status = body.status;
        if (body.status === "paid") updateData.paidAt = new Date().toISOString();
        else if (body.paidAt === undefined) updateData.paidAt = null;
      }
      if (body.subtotal !== undefined) updateData.subtotal = String(body.subtotal);
      if (body.taxAmount !== undefined) updateData.taxAmount = String(body.taxAmount);
      if (body.totalAmount !== undefined) updateData.totalAmount = String(body.totalAmount);
      if (body.amountPaid !== undefined) {
        updateData.amountPaid = String(body.amountPaid);
        const total = Number(body.totalAmount ?? 0);
        updateData.balanceDue = String(total - Number(body.amountPaid));
      }
      if (body.dueDate !== undefined) updateData.dueDate = body.dueDate;
      if (body.paidAt !== undefined) updateData.paidAt = body.paidAt;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.lineItems !== undefined) updateData.lineItems = body.lineItems;

      const [current] = await tx.select({
        status: invoicesTable.status,
        invoiceNumber: invoicesTable.invoiceNumber,
        customerId: invoicesTable.customerId,
      }).from(invoicesTable).where(eq(invoicesTable.id, id));
      if (!current) return { kind: "notFound" as const };
      const correctionError = correctedInvoicePatchError(current.status, body);
      if (correctionError) return { kind: "invalid" as const, error: correctionError };
      if (body.propertyId !== undefined) {
        const propertyId = normalizeOptionalPropertyId(body.propertyId);
        if (propertyId !== null) {
          await requireActivePropertyForCustomer(tx, current.customerId, propertyId);
        }
        updateData.propertyId = propertyId;
      }
      const [invoice] = await tx.update(invoicesTable).set(updateData).where(eq(invoicesTable.id, id)).returning();
      if (!invoice) return { kind: "notFound" as const };

      const statusChanged = body.status !== undefined && body.status !== current.status;
      if (statusChanged) {
        await tx.insert(activityLogsTable).values({
          entityType: "customer",
          entityId: current.customerId,
          action: "invoice_status_changed",
          fromValue: current.status,
          toValue: body.status,
          note: `Invoice ${current.invoiceNumber} marked as ${body.status}`,
          performedBy: getPerformedBy(req),
        }).catch(() => {});
      }
      if (statusChanged && body.status === "sent") {
        await enqueueCommunicationEvent(tx, {
          eventType: "invoice.sent",
          aggregateType: "invoice",
          aggregateId: invoice.id,
          payload: { customerId: invoice.customerId, invoiceId: invoice.id, status: invoice.status },
          source: "invoices.patch",
          actorId: getPerformedBy(req),
          dedupeKey: `invoice.sent:${invoice.id}:${invoice.updatedAt.toISOString()}`,
        });
      }
      return { kind: "updated" as const, invoice };
    });
    if (result.kind === "notFound") { res.status(404).json({ error: "Invoice not found" }); return; }
    if (result.kind === "invalid") { res.status(400).json(result.error); return; }
    const [enriched] = await enrichInvoices([result.invoice]);
    res.json(enriched);
  } catch (err) {
    console.error(err);
    if (err instanceof AccountRelationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof PaymentValidationError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: "Failed to update invoice" });
  }
});

router.delete("/invoices/:id", requireFinancialCapability("invoices.void"), async (req, res): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [current] = await db.select({ status: invoicesTable.status }).from(invoicesTable).where(eq(invoicesTable.id, id));
    const correctionError = current ? correctedInvoiceDeleteError(current.status) : null;
    if (correctionError) {
      res.status(400).json(correctionError);
      return;
    }
    // The invoice_jobs rows have no foreign key, so they used to survive the
    // invoice. DELETE /jobs/:id then refused for ever with invoice_linked_job,
    // naming an invoice that no longer existed.
    const invoice = await db.transaction(async (tx) => {
      await tx.delete(invoiceJobsTable).where(eq(invoiceJobsTable.invoiceId, id));
      const [deleted] = await tx.delete(invoicesTable).where(eq(invoicesTable.id, id)).returning();
      return deleted ?? null;
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

export default router;
