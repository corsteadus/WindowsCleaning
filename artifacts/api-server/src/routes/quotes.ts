import { Router, type IRouter, type Request } from "express";
import { eq, inArray, asc, isNotNull, ilike, or, desc, and, sql } from "drizzle-orm";
import {
  db, quotesTable, quoteLineItemsTable, jobsTable, customersTable, propertiesTable, leadsTable,
  estimateLineMetadataTable,
  activityLogsTable, estimateAppointmentsTable, estimateLocationsTable, estimateActivitiesTable, usersTable,
  estimateRevisionsTable, estimatePublicLinksTable,
} from "@workspace/db";
import {
  buildJobLineItemsJson,
  convertQuoteCore,
  quoteAdvisoryLockKey,
  type ConvertAdapter,
  type JobInsertValues,
} from "../lib/quote-convert.js";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyContext,
  idempotencyConflictMessage,
  idempotencyInProgressMessage,
  markIdempotencyReplay,
  releaseIdempotencyKey,
} from "../lib/idempotency.js";
import { enqueueCommunicationEvent } from "../lib/communication-outbox.js";
import { assertStaffWritableQuoteStatus, isTerminalEstimateStatus } from "../lib/estimate-lifecycle.js";
import {
  AccountRelationError,
  normalizeOptionalPropertyId,
  requireActivePropertyForCustomer,
} from "../lib/account-relations.js";
import { hasCapability } from "../lib/authorization.js";
import { quotePurgeStatements } from "../lib/customer-purge.js";
import { deriveQuoteStatuses } from "../lib/estimate-status-batch.js";
import {
  CORRECTION_REASON_MIN_LENGTH, correctionRequiresReason,
  isManuallyCorrectableStatus, MANUALLY_CORRECTABLE_STATUSES,
} from "../lib/estimate-lifecycle.js";
import { normalizeAuthorizationRole } from "../lib/role-normalization.js";
import { persistScheduledQuoteCore } from "../lib/quote-scheduled-create.js";
import { quoteExpiryFor, validateQuoteSettingsInput, normaliseValidityDays, normaliseQuoteTerms, QUOTE_VALIDITY_PRESETS } from "../lib/quote-settings.js";
import { readQuoteSettings, writeQuoteSettings } from "../lib/quote-settings-store.js";
import { priceOf, shownPrice } from "../lib/estimate-pricing.ts";
import { discountsOf, type DiscountInput } from "../lib/discounts.ts";
import { copyProfileDiscountsTx, readQuoteDiscounts, replaceQuoteDiscountsTx, serializeDiscounts, serviceTaxability, taxChoiceOf, writeQuoteTotalsTx } from "../lib/quote-totals.ts";

function getPerformedBy(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || String((req.user as { id: string }).id);
}

async function logQuoteActivity(
  quote: { customerId: number | null; leadId: number | null },
  action: string,
  fromValue?: string | null,
  toValue?: string | null,
  note?: string | null,
  performedBy?: string | null,
) {
  if (quote.customerId) {
    await db.insert(activityLogsTable).values({ entityType: "customer", entityId: quote.customerId, action, fromValue: fromValue ?? null, toValue: toValue ?? null, note: note ?? null, performedBy: performedBy ?? null });
  }
  if (quote.leadId) {
    await db.insert(activityLogsTable).values({ entityType: "lead", entityId: quote.leadId, action, fromValue: fromValue ?? null, toValue: toValue ?? null, note: note ?? null, performedBy: performedBy ?? null });
  }
}

// ── DrizzleTxAdapter ─────────────────────────────────────────────────────────
// Implements ConvertAdapter using a Drizzle transaction so that every method
// shares the same connection and the pg_advisory_xact_lock is held for the
// entire operation.  Created inside db.transaction(); never used directly
// outside the convert route.

type DrizzleTX = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function logQuoteActivityTx(
  tx: DrizzleTX,
  quote: { customerId: number | null; leadId: number | null },
  action: string,
  fromValue?: string | null,
  toValue?: string | null,
  note?: string | null,
  performedBy?: string | null,
) {
  if (quote.customerId) {
    await tx.insert(activityLogsTable).values({
      entityType: "customer", entityId: quote.customerId, action,
      fromValue: fromValue ?? null, toValue: toValue ?? null,
      note: note ?? null, performedBy: performedBy ?? null,
    });
  }
  if (quote.leadId) {
    await tx.insert(activityLogsTable).values({
      entityType: "lead", entityId: quote.leadId, action,
      fromValue: fromValue ?? null, toValue: toValue ?? null,
      note: note ?? null, performedBy: performedBy ?? null,
    });
  }
}

class DrizzleTxAdapter implements ConvertAdapter {
  constructor(private readonly tx: DrizzleTX) {}

  async acquireAdvisoryLock(quoteId: number): Promise<void> {
    // Transaction-scoped exclusive lock: released automatically on commit/rollback.
    // Blocks competing callers until this transaction ends; never bypassed — a
    // failed pool connection causes db.transaction() to throw before this runs.
    // Uses quoteAdvisoryLockKey() — same key as DrizzleTxJobAdapter in jobs.ts —
    // so POST /quotes/:id/convert and POST /jobs cannot race each other.
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteAdvisoryLockKey(quoteId)})`);
  }

  async findJobByQuoteId(quoteId: number) {
    const [job] = await this.tx
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.quoteId, quoteId));
    return job ?? null;
  }

  async findQuoteById(quoteId: number) {
    const [quote] = await this.tx
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.id, quoteId));
    return quote ?? null;
  }

  async findLeadById(leadId: number) {
    const [lead] = await this.tx
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.id, leadId));
    return lead ?? null;
  }

  async fetchLineItems(quoteId: number) {
    return this.tx
      .select()
      .from(quoteLineItemsTable)
      .where(eq(quoteLineItemsTable.quoteId, quoteId))
      .orderBy(asc(quoteLineItemsTable.sortOrder));
  }

  async setQuoteApproved(quoteId: number): Promise<void> {
    await this.tx
      .update(quotesTable)
      .set({ status: "approved" })
      .where(eq(quotesTable.id, quoteId));
  }

  async insertJob(values: JobInsertValues) {
    const [job] = await this.tx
      .insert(jobsTable)
      .values(values)
      .returning();
    return job;
  }
}

const router: IRouter = Router();

// ─── the company's own quote settings ───────────────────────────────────────

/**
 * Kyle (#11, #13): how long a quote stays valid, and the terms the company
 * puts on it, are decided once for the business rather than on every quote.
 *
 * The read is open to anyone who may see a quote, because the builder needs
 * it to show the expiry and to fill in the terms. Only an administrator may
 * change it — see ROUTE_RULES.
 */
router.get("/quote-settings", async (_req, res) => {
  const settings = await readQuoteSettings();
  res.json({ ...settings, presets: [...QUOTE_VALIDITY_PRESETS] });
});

router.put("/quote-settings", async (req, res) => {
  const body = (req.body ?? {}) as { validityDays?: unknown; terms?: unknown };
  const problem = validateQuoteSettingsInput(body);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const settings = await writeQuoteSettings(
    {
      validityDays: normaliseValidityDays(body.validityDays)!,
      // Corstead never writes terms of its own: an empty box stays empty.
      terms: normaliseQuoteTerms(body.terms),
    },
    getPerformedBy(req),
  );
  res.json({ ...settings, presets: [...QUOTE_VALIDITY_PRESETS] });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function serializeQuote(q: typeof quotesTable.$inferSelect) {
  return {
    ...q,
    subtotal: Number(q.subtotal),
    taxTotal: Number(q.taxTotal),
    discountTotal: Number(q.discountTotal),
    totalAmount: Number(q.totalAmount),
    taxRate: q.taxRate == null ? null : Number(q.taxRate),
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

/**
 * Keeps the per-quote description beside its line. Writing null removes the
 * row rather than storing an empty note, so a cleared box really is cleared.
 */
async function saveLineServiceNotes(
  tx: { insert: typeof db.insert; delete: typeof db.delete },
  entries: ReadonlyArray<{ lineItemId: number; serviceNotes: string | null; propertyId?: number | null; isUpsell?: boolean }>,
): Promise<void> {
  for (const entry of entries) {
    await tx.delete(estimateLineMetadataTable)
      .where(eq(estimateLineMetadataTable.lineItemId, entry.lineItemId));
    if (!entry.serviceNotes && !entry.propertyId && !entry.isUpsell) continue;
    await tx.insert(estimateLineMetadataTable).values({
      lineItemId: entry.lineItemId, serviceNotes: entry.serviceNotes,
      propertyId: entry.propertyId ?? null, isUpsell: entry.isUpsell ?? false,
    });
  }
}

/** A sender's line price, or a 400 (lib/estimate-pricing.ts). */
function linePrice(value: unknown) {
  const price = priceOf(value);
  if ("error" in price) throw new AccountRelationError(400, price.error);
  return price;
}

function serializeLineItem(li: typeof quoteLineItemsTable.$inferSelect) {
  return {
    ...li,
    quantity: Number(li.quantity),
    unitPrice: shownPrice(li),
    totalPrice: Number(li.totalPrice),
    pricePending: li.pricePending,
    createdAt: li.createdAt.toISOString(),
    updatedAt: li.updatedAt.toISOString(),
  };
}

async function getQuoteWithDetails(id: number) {
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
  if (!quote) return null;

  const lineItems = await db
    .select()
    .from(quoteLineItemsTable)
    .where(eq(quoteLineItemsTable.quoteId, id))
    .orderBy(asc(quoteLineItemsTable.sortOrder));

  // Kyle 2026-10-01 #9: each line's own description comes back with it, so the
  // builder shows what was written for this quote rather than losing it.
  const lineNotes = lineItems.length
    ? await db.select().from(estimateLineMetadataTable)
      .where(inArray(estimateLineMetadataTable.lineItemId, lineItems.map((line) => line.id)))
    : [];
  const notesByLine = new Map(lineNotes.map((row) => [row.lineItemId, row.serviceNotes ?? null]));
  const propertyByLine = new Map(lineNotes.map((row) => [row.lineItemId, row.propertyId ?? null]));

  // Fetch customer or lead info
  let displayName = null;
  let email: string | null = null;
  let phone: string | null = null;
  let customerForQuote = null;
  let leadForQuote = null;

  if (quote.customerId) {
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, quote.customerId));
    if (c) {
      displayName = `${c.firstName} ${c.lastName}`;
      email = c.email ?? null;
      phone = c.phone ?? null;
      // taxExempt and county: the estimate's sales tax choice needs them (phase 6).
      customerForQuote = { id: c.id, firstName: c.firstName, lastName: c.lastName, displayName, email, phone, taxExempt: c.taxExempt, county: c.county ?? null };
    }
  } else if (quote.leadId) {
    const [l] = await db.select().from(leadsTable).where(eq(leadsTable.id, quote.leadId));
    if (l) {
      displayName = `${l.firstName} ${l.lastName}`.trim() || "Lead";
      email = l.email ?? null;
      phone = l.phone ?? null;
      leadForQuote = { id: l.id, firstName: l.firstName, lastName: l.lastName, displayName, email, phone };
    }
  }

  // Fetch property info
  let property = null;
  if (quote.propertyId) {
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, quote.propertyId));
    property = p || null;
  }

  // The same derived status the list shows, so every screen agrees (Random Edits #4).
  const [appointmentRows, revisionRows, linkRows, linkedJobRows] = await Promise.all([
    db.select({ quoteId: estimateAppointmentsTable.quoteId }).from(estimateAppointmentsTable).where(eq(estimateAppointmentsTable.quoteId, id)),
    db.select({ quoteId: estimateRevisionsTable.quoteId, id: estimateRevisionsTable.id, revisionNumber: estimateRevisionsTable.revisionNumber })
      .from(estimateRevisionsTable).where(eq(estimateRevisionsTable.quoteId, id)),
    db.select({
      quoteId: estimatePublicLinksTable.quoteId, revisionId: estimatePublicLinksTable.revisionId,
      sentAt: estimatePublicLinksTable.sentAt, firstOpenedAt: estimatePublicLinksTable.firstOpenedAt,
      decision: estimatePublicLinksTable.decision, expiresAt: estimatePublicLinksTable.expiresAt,
    }).from(estimatePublicLinksTable).where(eq(estimatePublicLinksTable.quoteId, id)),
    db.select({ quoteId: jobsTable.quoteId }).from(jobsTable).where(eq(jobsTable.quoteId, id)),
  ]);
  const displayStatus = deriveQuoteStatuses({
    quotes: [quote], appointments: appointmentRows, revisions: revisionRows, links: linkRows, jobs: linkedJobRows,
  }).get(quote.id);

  const discounts = serializeDiscounts(await readQuoteDiscounts(db, id));

  return {
    ...serializeQuote(quote),
    displayStatus,
    discounts,
    lineItems: lineItems.map((line) => ({
      ...serializeLineItem(line),
      serviceNotes: notesByLine.get(line.id) ?? null,
      propertyId: propertyByLine.get(line.id) ?? null,
    })),
    customer: customerForQuote,
    lead: leadForQuote,
    property: property ? {
      id: property.id,
      name: property.name,
      address: property.address,
      city: property.city,
      state: property.state,
      zip: property.zip,
      county: property.county ?? null,
    } : null,
  };
}

// Phase 5: the totals take the estimate's discounts into account (lib/quote-totals.ts).
async function recalcQuoteTotalsTx(tx: DrizzleTX, quoteId: number) {
  await writeQuoteTotalsTx(tx, quoteId);
}

type QuoteCreateBody = {
  customerId?: unknown;
  leadId?: unknown;
  propertyId?: unknown;
  status?: string;
  notes?: string | null;
  terms?: string | null;
  validUntil?: string | null;
  lineItems?: Array<{
    serviceId?: number;
    description: string;
    quantity: number;
    /** null or blank: still to be quoted (lib/estimate-pricing.ts). */
    unitPrice: number | null;
    /** The job location for this line (Kyle, Video 3); checked against the account. */
    propertyId?: number | null;
  }>;
  /** Phase 5. Absent: the profile's own discounts are added. */
  discounts?: unknown;
  /** Phase 6: { stateRateId?, countyRateId? }. Absent or null: no tax (never by default). */
  tax?: unknown;
};

export async function createQuoteTx(
  tx: DrizzleTX,
  body: QuoteCreateBody,
  performedBy: string | null,
) {
  assertStaffWritableQuoteStatus(body.status);
  if (!body.customerId && !body.leadId) {
    throw new AccountRelationError(400, "customerId or leadId is required");
  }
  const lineItemsInput = body.lineItems ?? [];
  const sentDiscounts = body.discounts === undefined ? null : discountsOf(body.discounts);
  if (sentDiscounts && "error" in sentDiscounts) throw new AccountRelationError(400, sentDiscounts.error);
  const requestedPropertyId = normalizeOptionalPropertyId(body.propertyId);
  const requestedCustomerId = body.customerId ? Number(body.customerId) : null;
  if (requestedPropertyId !== null && requestedCustomerId === null) {
    throw new AccountRelationError(400, "Properties require a customer-owned or shared account");
  }
  if (requestedPropertyId !== null) {
    await requireActivePropertyForCustomer(tx, requestedCustomerId!, requestedPropertyId);
  }
  const prices = lineItemsInput.map((li) => linePrice(li.unitPrice));
  const subtotal = lineItemsInput.reduce((sum, li, i) => sum + li.quantity * prices[i].unitPrice, 0);
  // Kyle #11: nobody types a Valid Until date. It is calculated from the
  // company's validity setting, and an explicit date is only honoured if one
  // is sent (an import, or a caller correcting a single quote).
  const taxChoice = await taxChoiceOf(tx, body.tax ?? null, requestedCustomerId);
  if ("error" in taxChoice) throw new AccountRelationError(400, taxChoice.error);
  const taxableByService = await serviceTaxability(tx, lineItemsInput.map((li) => li.serviceId));
  const settings = await readQuoteSettings(tx);
  const validUntil = body.validUntil
    || quoteExpiryFor(new Date(), settings.validityDays).validUntil;
  const [created] = await tx.insert(quotesTable).values({
    customerId: requestedCustomerId,
    leadId: body.leadId ? Number(body.leadId) : null,
    propertyId: requestedPropertyId,
    quoteNumber: `Q-${Date.now()}`,
    status: body.status || "draft",
    subtotal: String(subtotal),
    taxTotal: "0",
    discountTotal: "0",
    totalAmount: String(subtotal),
    ...taxChoice,
    notes: body.notes || null,
    // #13: the company's own terms, when it has written any. Never Corstead's.
    terms: body.terms || settings.terms || null,
    validUntil,
  }).returning();

  if (lineItemsInput.length > 0) {
    const inserted = await tx.insert(quoteLineItemsTable).values(
      lineItemsInput.map((li, i) => ({
        quoteId: created.id,
        serviceId: li.serviceId ? Number(li.serviceId) : null,
        description: li.description,
        quantity: String(li.quantity),
        unitPrice: String(prices[i].unitPrice),
        totalPrice: String(li.quantity * prices[i].unitPrice),
        pricePending: prices[i].pricePending,
        // Phase 6: as the sender says, else as the service is set up.
        taxable: typeof (li as { taxable?: unknown }).taxable === "boolean"
          ? Boolean((li as { taxable?: boolean }).taxable) : taxableByService.get(Number(li.serviceId)) ?? false,
        sortOrder: i,
      })),
    ).returning();
    const linePropertyIds = lineItemsInput.map((li) => normalizeOptionalPropertyId(li.propertyId));
    for (const propertyId of new Set(linePropertyIds.filter((id): id is number => id !== null))) {
      if (requestedCustomerId === null) throw new AccountRelationError(400, "Line locations require a customer account");
      await requireActivePropertyForCustomer(tx, requestedCustomerId, propertyId);
    }
    await saveLineServiceNotes(tx, inserted.map((row, i) => ({
      lineItemId: row.id,
      serviceNotes: (lineItemsInput[i] as { serviceNotes?: string | null }).serviceNotes?.trim() || null,
      propertyId: linePropertyIds[i],
    })));
  }
  // Phase 5: a new estimate starts with the profile's own discounts, unless
  // the sender chose its discounts itself.
  if (sentDiscounts) await replaceQuoteDiscountsTx(tx, created.id, sentDiscounts.discounts);
  else await copyProfileDiscountsTx(tx, created.id, requestedCustomerId);
  await writeQuoteTotalsTx(tx, created.id);
  await logQuoteActivityTx(
    tx,
    { customerId: created.customerId, leadId: created.leadId },
    "quote_created",
    null,
    created.status,
    `Quote ${created.quoteNumber} created`,
    performedBy,
  );
  if (created.status === "sent" || created.status === "accepted") {
    await enqueueCommunicationEvent(tx, {
      eventType: created.status === "sent" ? "quote.sent" : "quote.accepted",
      aggregateType: "quote",
      aggregateId: created.id,
      payload: { customerId: created.customerId, quoteId: created.id, status: created.status },
      source: "quotes.create",
      actorId: performedBy,
      dedupeKey: `quote.${created.status}:${created.id}:${created.updatedAt.toISOString()}`,
    });
  }
  const [withTotals] = await tx.select().from(quotesTable).where(eq(quotesTable.id, created.id));
  return withTotals ?? created;
}

async function quoteIsAccepted(quoteId: number): Promise<boolean> {
  const [quote] = await db.select({ status: quotesTable.status }).from(quotesTable)
    .where(eq(quotesTable.id, quoteId)).limit(1);
  return quote?.status === "accepted";
}

// ─── routes ─────────────────────────────────────────────────────────────────

// List all quotes (with customer/property names)
router.get("/quotes", async (req, res): Promise<void> => {
  try {
    const { customerId, leadId, status, page, limit, search } = req.query;

    const pageNum  = page  ? Math.max(1, parseInt(String(page),  10)) : null;
    const limitNum = limit ? Math.max(1, parseInt(String(limit), 10)) : (pageNum ? 50 : null);
    const searchQ  = search ? String(search).trim() : "";
    const isPaginated = pageNum !== null || searchQ;

    // Build base conditions
    const conditions = [];
    if (customerId) conditions.push(eq(quotesTable.customerId, Number(customerId)));
    if (leadId)     conditions.push(eq(quotesTable.leadId,     Number(leadId)));
    if (status === "open") conditions.push(inArray(quotesTable.status, ["draft", "sent"]));
    else if (status) conditions.push(eq(quotesTable.status, String(status)));

    // For search, we need to join customers/leads — do a CTE-style approach
    // by searching on quote number directly (customer name search requires join)
    if (searchQ && !customerId && !leadId) {
      conditions.push(ilike(quotesTable.quoteNumber, `%${searchQ}%`));
    }

    const where = conditions.length > 0
      ? (conditions.length === 1 ? conditions[0] : and(...conditions))
      : undefined;

    // Fetch page of quotes (fetch limit+1 to detect hasMore)
    const fetchLimit = limitNum ? limitNum + 1 : (isPaginated ? 51 : 201);
    const fetchOffset = (pageNum && limitNum) ? (pageNum - 1) * limitNum : 0;

    let quotes: typeof quotesTable.$inferSelect[] = await db
      .select()
      .from(quotesTable)
      .where(where)
      .orderBy(desc(quotesTable.createdAt))
      .limit(fetchLimit)
      .offset(fetchOffset);

    let hasMore = false;
    const resolvedLimit = limitNum ?? (isPaginated ? 50 : 200);
    if (quotes.length > resolvedLimit) {
      hasMore = true;
      quotes = quotes.slice(0, resolvedLimit);
    }

    if (quotes.length === 0) {
      res.json(isPaginated ? { data: [], page: pageNum ?? 1, pageSize: limitNum ?? 50, hasMore: false } : []);
      return;
    }

    // Batch-fetch customers, leads, and properties
    const customerIds = [...new Set(quotes.map((q) => q.customerId).filter(Boolean) as number[])];
    const leadIds2    = [...new Set(quotes.map((q) => q.leadId).filter(Boolean) as number[])];
    const propertyIds = [...new Set(quotes.map((q) => q.propertyId).filter(Boolean) as number[])];

    const customers = customerIds.length
      ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds))
      : [];
    const leadsArr = leadIds2.length
      ? await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds2))
      : [];
    const properties = propertyIds.length
      ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
      : [];

    // One read each for the things a status is derived from, not one per row.
    const quoteIds = quotes.map((q) => q.id);
    const [appointmentRows, revisionRows, linkRows, linkedJobRows] = await Promise.all([
      db.select({ quoteId: estimateAppointmentsTable.quoteId }).from(estimateAppointmentsTable)
        .where(inArray(estimateAppointmentsTable.quoteId, quoteIds)),
      db.select({ quoteId: estimateRevisionsTable.quoteId, id: estimateRevisionsTable.id, revisionNumber: estimateRevisionsTable.revisionNumber })
        .from(estimateRevisionsTable).where(inArray(estimateRevisionsTable.quoteId, quoteIds)),
      db.select({
        quoteId: estimatePublicLinksTable.quoteId, revisionId: estimatePublicLinksTable.revisionId,
        sentAt: estimatePublicLinksTable.sentAt, firstOpenedAt: estimatePublicLinksTable.firstOpenedAt,
        decision: estimatePublicLinksTable.decision, expiresAt: estimatePublicLinksTable.expiresAt,
      }).from(estimatePublicLinksTable).where(inArray(estimatePublicLinksTable.quoteId, quoteIds)),
      db.select({ quoteId: jobsTable.quoteId }).from(jobsTable).where(inArray(jobsTable.quoteId, quoteIds)),
    ]);
    const displayStatuses = deriveQuoteStatuses({
      quotes, appointments: appointmentRows, revisions: revisionRows, links: linkRows, jobs: linkedJobRows,
    });

    const customerMap = Object.fromEntries(customers.map((c) => [c.id, c]));
    const leadMap     = Object.fromEntries(leadsArr.map((l) => [l.id, l]));
    const propertyMap = Object.fromEntries(properties.map((p) => [p.id, p]));

    const enriched = quotes.map((q) => {
      const c = q.customerId ? customerMap[q.customerId] : null;
      const l = q.leadId ? leadMap[q.leadId] : null;
      const p = q.propertyId ? propertyMap[q.propertyId] : null;
      const name = c
        ? `${c.firstName} ${c.lastName}`
        : l ? `${l.firstName} ${l.lastName}`.trim() || "Lead"
        : "Unknown";
      return {
        displayStatus: displayStatuses.get(q.id) ?? q.status,
        ...serializeQuote(q),
        customerName: name,
        isLead: !q.customerId && !!q.leadId,
        propertyAddress: p ? [p.address, p.city, p.state].filter(Boolean).join(", ") : null,
        propertyName: p?.name || null,
      };
    });

    if (isPaginated) {
      res.json({ data: enriched, page: pageNum ?? 1, pageSize: limitNum ?? 50, hasMore });
      return;
    }

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch quotes" });
  }
});

// Get single quote with line items, customer, property
router.get("/quotes/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const quote = await getQuoteWithDetails(id);
    if (!quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }
    res.json(quote);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch quote" });
  }
});

// Create quote + line items atomically
router.post("/quotes", async (req, res): Promise<void> => {
  try {
    const quote = await db.transaction((tx) => createQuoteTx(tx, req.body, getPerformedBy(req)));

    const full = await getQuoteWithDetails(quote.id);

    res.status(201).json(full);
  } catch (err) {
    if (err instanceof AccountRelationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof Error && "status" in err && typeof err.status === "number") {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create quote" });
  }
});

export interface QuoteAppointmentInput {
  startsAt: Date;
  durationMinutes: number;
  assignedUserId: string;
  propertyIds: number[];
  appointmentNotes: string | null;
  estimateNotes: string | null;
}

/** An estimate appointment as the office sends it, or the reason it cannot be booked. */
export function parseQuoteAppointment(raw: Record<string, unknown>): QuoteAppointmentInput | { error: string } {
  const startsAtInput = raw.startsAt;
  const startsAt = new Date(typeof startsAtInput === "string" ? startsAtInput : "");
  const durationMinutes = Number(raw.durationMinutes);
  const assignedUserId = typeof raw.assignedUserId === "string" ? raw.assignedUserId.trim() : "";
  const propertyIds = [...new Set(
    (Array.isArray(raw.propertyIds) ? raw.propertyIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )];
  if (
    typeof startsAtInput !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(startsAtInput)
    || Number.isNaN(startsAt.valueOf())
    || !Number.isInteger(durationMinutes)
    || durationMinutes < 15
    || durationMinutes > 1440
    || !assignedUserId
    || !propertyIds.length
  ) {
    return { error: "A complete appointment with a valid start, duration, technician, and location is required" };
  }
  return {
    startsAt, durationMinutes, assignedUserId, propertyIds,
    appointmentNotes: typeof raw.appointmentNotes === "string" && raw.appointmentNotes ? raw.appointmentNotes : null,
    estimateNotes: typeof raw.estimateNotes === "string" && raw.estimateNotes ? raw.estimateNotes : null,
  };
}

/**
 * Create a quote with its appointment inside the caller's transaction. Used by
 * POST /quotes/with-appointment and by the Add Prospect form (piece B2), so a
 * new prospect's estimate is booked exactly as one booked later would be.
 */
export async function createScheduledQuoteTx(
  tx: DrizzleTX,
  input: {
    quote: QuoteCreateBody;
    customerId: number;
    appointment: QuoteAppointmentInput;
    performedBy: string | null;
    actorId: string | null;
    completeIdempotency?: (quote: typeof quotesTable.$inferSelect) => Promise<void>;
  },
) {
  const { appointment, customerId, actorId } = input;
  return persistScheduledQuoteCore<
    typeof quotesTable.$inferSelect,
    typeof estimateAppointmentsTable.$inferSelect
  >({
    async validateReferences() {
      for (const propertyId of appointment.propertyIds) {
        await requireActivePropertyForCustomer(tx, customerId, propertyId);
      }
      const [technician] = await tx.select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable)
        .where(and(eq(usersTable.id, appointment.assignedUserId), eq(usersTable.isActive, true)))
        .limit(1);
      if (!technician || normalizeAuthorizationRole(technician.role) !== "field_tech") {
        throw new AccountRelationError(400, "Assigned technician must be an active Field or Team Technician");
      }
    },
    createQuote: () => createQuoteTx(tx, input.quote, input.performedBy),
    async createAppointment(quote) {
      const [created] = await tx.insert(estimateAppointmentsTable).values({
        quoteId: quote.id,
        startsAt: appointment.startsAt,
        durationMinutes: appointment.durationMinutes,
        assignedUserId: appointment.assignedUserId,
        appointmentNotes: appointment.appointmentNotes,
        estimateNotes: appointment.estimateNotes,
        createdBy: actorId,
      }).returning();
      return created;
    },
    createLocations: (quote) => tx.insert(estimateLocationsTable).values(appointment.propertyIds.map((propertyId) => ({
      quoteId: quote.id,
      propertyId,
    }))).then(() => undefined),
    createActivity: (quote) => tx.insert(estimateActivitiesTable).values({
      quoteId: quote.id,
      activityType: "appointment_scheduled",
      actorId,
      detail: {
        startsAt: appointment.startsAt.toISOString(),
        durationMinutes: appointment.durationMinutes,
        assignedUserId: appointment.assignedUserId,
        propertyIds: appointment.propertyIds,
      },
    }).then(() => undefined),
    async enqueueEvent(quote) {
      await enqueueCommunicationEvent(tx, {
        eventType: "appointment.scheduled",
        aggregateType: "quote",
        aggregateId: quote.id,
        payload: {
          quoteId: quote.id,
          customerId: quote.customerId,
          scheduledDate: appointment.startsAt.toISOString(),
        },
        source: "estimate_lifecycle",
        actorId,
        dedupeKey: `estimate-appointment:${quote.id}:${appointment.startsAt.toISOString()}`,
      });
    },
    completeIdempotency: (quote) => input.completeIdempotency?.(quote) ?? Promise.resolve(),
  });
}

router.post("/quotes/with-appointment", async (req, res): Promise<void> => {
  try {
    if (!hasCapability(req.user?.role, "estimates.schedule")) {
      res.status(403).json({ error: "Estimate scheduling access is required" });
      return;
    }
    const body = req.body as { quote?: QuoteCreateBody; appointment?: Record<string, unknown> };
    if (!body.quote || !body.appointment) {
      res.status(400).json({ error: "Quote and appointment are required" });
      return;
    }
    const appointment = parseQuoteAppointment(body.appointment);
    if ("error" in appointment) {
      res.status(400).json({ error: appointment.error });
      return;
    }
    const { startsAt, propertyIds } = appointment;
    const requestedCustomerId = body.quote.customerId ? Number(body.quote.customerId) : null;
    if (!requestedCustomerId) {
      res.status(400).json({ error: "Scheduled quotes require a customer account" });
      return;
    }
    const actorId = req.user?.id ?? null;
    const performedBy = getPerformedBy(req);
    const idempotency = getIdempotencyContext(req, "quotes.create_with_appointment", body);
    if (!idempotency) {
      res.status(400).json({ error: "Idempotency-Key is required" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, idempotency);
      if (claim.kind !== "claimed") return claim;
      const committed = await createScheduledQuoteTx(tx, {
        quote: body.quote!,
        customerId: requestedCustomerId,
        appointment,
        performedBy,
        actorId,
        completeIdempotency: (quote) => completeIdempotencyKey(tx, claim.record.id, {
          resourceType: "quote",
          resourceId: quote.id,
          responseStatus: 201,
        }),
      });
      return { kind: "created" as const, ...committed };
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
      const quoteId = result.record.resourceId;
      if (!quoteId) {
        res.status(409).json({ error: "The idempotent quote result is unavailable" });
        return;
      }
      const [[quote], [appointment], locations] = await Promise.all([
        db.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1),
        db.select().from(estimateAppointmentsTable).where(eq(estimateAppointmentsTable.quoteId, quoteId)).limit(1),
        db.select().from(estimateLocationsTable).where(eq(estimateLocationsTable.quoteId, quoteId)),
      ]);
      if (!quote || !appointment) {
        res.status(404).json({ error: "The idempotent scheduled quote no longer exists" });
        return;
      }
      markIdempotencyReplay(res);
      res.status(result.record.responseStatus ?? 201).json({
        quote: serializeQuote(quote),
        appointment: {
          ...appointment,
          startsAt: appointment.startsAt.toISOString(),
          propertyIds: locations.map((location) => location.propertyId),
        },
      });
      return;
    }

    res.status(201).json({
      quote: serializeQuote(result.quote),
      appointment: {
        ...result.appointment,
        startsAt: result.appointment.startsAt.toISOString(),
        propertyIds,
      },
    });
  } catch (err) {
    if (err instanceof AccountRelationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof Error && "status" in err && typeof err.status === "number") {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create scheduled quote" });
  }
});

// Update quote + replace line items
router.patch("/quotes/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body;
    assertStaffWritableQuoteStatus(body.status);

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteAdvisoryLockKey(id)})`);
      const [current] = await tx.select().from(quotesTable).where(eq(quotesTable.id, id));
      if (!current) return { kind: "notFound" as const };
      if (isTerminalEstimateStatus(current.status)) return { kind: "locked" as const };
      const updateData: Record<string, unknown> = {};
      if (body.propertyId !== undefined) {
        const propertyId = normalizeOptionalPropertyId(body.propertyId);
        if (propertyId !== null) {
          if (current.customerId === null) {
            throw new AccountRelationError(400, "Properties require a customer-owned or shared account");
          }
          await requireActivePropertyForCustomer(tx, current.customerId, propertyId);
        }
        updateData.propertyId = propertyId;
      }
      if (body.status !== undefined) updateData.status = body.status;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.terms !== undefined) updateData.terms = body.terms;
      if (body.validUntil !== undefined) updateData.validUntil = body.validUntil;

      let moneyChanged = false;
      if (body.tax !== undefined) {
        const choice = await taxChoiceOf(tx, body.tax, current.customerId);
        if ("error" in choice) throw new AccountRelationError(400, choice.error);
        Object.assign(updateData, choice);
        moneyChanged = true;
      }
      if (body.discounts !== undefined) {
        const sent = discountsOf(body.discounts);
        if ("error" in sent) throw new AccountRelationError(400, sent.error);
        // A discount kept from the profile keeps its link, by name, so the
        // estimate still says where it came from.
        const before = await readQuoteDiscounts(tx, id);
        await replaceQuoteDiscountsTx(tx, id, sent.discounts.map((discount: DiscountInput) => ({
          ...discount, customerDiscountId: before.find((row) => row.name === discount.name)?.customerDiscountId ?? null,
        })));
        moneyChanged = true;
      }
      if (body.lineItems !== undefined) {
        const lineItemsInput: Array<{
          serviceId?: number; description: string; quantity: number; unitPrice: number | null;
          serviceNotes?: string | null; propertyId?: number | null; isUpsell?: boolean; taxable?: boolean;
        }> = body.lineItems;
        const prices = lineItemsInput.map((li) => linePrice(li.unitPrice));
        // Editing replaces the lines. A line's location and upsell flag, and
        // its description when not sent, are carried over by position, as
        // Finalize does — found 2026-10-24: every edit dropped each line's
        // location.
        const previousLines = await tx.select({ id: quoteLineItemsTable.id, taxable: quoteLineItemsTable.taxable }).from(quoteLineItemsTable)
          .where(eq(quoteLineItemsTable.quoteId, id)).orderBy(asc(quoteLineItemsTable.sortOrder));
        const taxableByService = await serviceTaxability(tx, lineItemsInput.map((li) => li.serviceId));
        const previousMeta = previousLines.length
          ? await tx.select().from(estimateLineMetadataTable)
            .where(inArray(estimateLineMetadataTable.lineItemId, previousLines.map((line) => line.id)))
          : [];
        const previousByPosition = previousLines.map((line) => previousMeta.find((meta) => meta.lineItemId === line.id) ?? null);
        if (previousLines.length) {
          await tx.delete(estimateLineMetadataTable)
            .where(inArray(estimateLineMetadataTable.lineItemId, previousLines.map((line) => line.id)));
        }
        await tx.delete(quoteLineItemsTable).where(eq(quoteLineItemsTable.quoteId, id));
        if (lineItemsInput.length > 0) {
          const rewritten = await tx.insert(quoteLineItemsTable).values(lineItemsInput.map((li, i) => ({
            quoteId: id,
            serviceId: li.serviceId ? Number(li.serviceId) : null,
            description: li.description,
            quantity: String(li.quantity),
            unitPrice: String(prices[i].unitPrice),
            totalPrice: String(Number(li.quantity) * prices[i].unitPrice),
            pricePending: prices[i].pricePending,
            // Phase 6: as sent; else as it was (by position, like the location); else the service's.
            taxable: typeof li.taxable === "boolean" ? li.taxable
              : previousLines[i]?.taxable ?? taxableByService.get(Number(li.serviceId)) ?? false,
            sortOrder: i,
          }))).returning();
          await saveLineServiceNotes(tx, rewritten.map((row, i) => {
            const sent = lineItemsInput[i];
            const previous = previousByPosition[i];
            return {
              lineItemId: row.id,
              serviceNotes: sent.serviceNotes === undefined ? previous?.serviceNotes ?? null : sent.serviceNotes?.trim() || null,
              propertyId: sent.propertyId === undefined ? previous?.propertyId ?? null : normalizeOptionalPropertyId(sent.propertyId),
              isUpsell: sent.isUpsell === undefined ? previous?.isUpsell ?? false : !!sent.isUpsell,
            };
          }));
        }
        moneyChanged = true;
      }
      if (Object.keys(updateData).length > 0) {
        await tx.update(quotesTable).set(updateData).where(eq(quotesTable.id, id));
      }
      if (moneyChanged) await writeQuoteTotalsTx(tx, id);
      const statusChanged = body.status !== undefined && body.status !== current.status;
      if (statusChanged) {
        await logQuoteActivityTx(tx, current, "quote_status_changed", current.status, body.status, null, getPerformedBy(req));
      } else if (body.lineItems !== undefined || body.discounts !== undefined) {
        await logQuoteActivityTx(tx, current, "quote_updated", null, null, `Quote ${current.quoteNumber} ${body.lineItems !== undefined ? "line items" : "discounts"} updated`, getPerformedBy(req));
      }
      const [quote] = await tx.select().from(quotesTable).where(eq(quotesTable.id, id));
      if (statusChanged && (body.status === "sent" || body.status === "accepted")) {
        await enqueueCommunicationEvent(tx, {
          eventType: body.status === "sent" ? "quote.sent" : "quote.accepted",
          aggregateType: "quote",
          aggregateId: id,
          payload: { customerId: quote?.customerId ?? null, quoteId: id, status: body.status },
          source: "quotes.patch",
          actorId: getPerformedBy(req),
          dedupeKey: `quote.${body.status}:${id}:${quote?.updatedAt.toISOString() ?? Date.now()}`,
        });
      }
      return { kind: "updated" as const };
    });
    if (result.kind === "notFound") { res.status(404).json({ error: "Quote not found" }); return; }
    if (result.kind === "locked") { res.status(409).json({ error: "Accepted estimate terms are locked; create a revision instead", code: "estimate_locked" }); return; }

    const full = await getQuoteWithDetails(id);
    res.json(full);
  } catch (err) {
    if (err instanceof AccountRelationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof Error && "status" in err && typeof err.status === "number") {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update quote" });
  }
});

// Delete quote + cascade line items
// Random Edits #4: "Authorized employees may manually correct a status, but
// that correction should be recorded in activity history." Since Kyle's
// correction note #23 (2026-10-10) that includes Accepted, because most of
// this company's acceptances happen on the phone. Two things still hold: the
// correction must name a reason, and a quote the customer has already accepted
// on the secure link cannot be corrected at all.
router.patch("/quotes/:id/status", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Quote id must be a positive integer" });
      return;
    }
    const requested = (req.body as { status?: unknown }).status;
    if (!isManuallyCorrectableStatus(requested)) {
      res.status(400).json({
        error: `Status must be one of ${MANUALLY_CORRECTABLE_STATUSES.join(", ")}.`,
        code: "status_not_correctable",
      });
      return;
    }
    const reason = typeof (req.body as { reason?: unknown }).reason === "string"
      ? String((req.body as { reason: string }).reason).trim() : "";
    // Kyle #23. Accepted is the one correction that commits the company to
    // work, so it carries its own evidence into the activity history — the
    // same thing the verbal-acceptance box on the scheduling screen asks for.
    if (correctionRequiresReason(requested) && reason.length < CORRECTION_REASON_MIN_LENGTH) {
      res.status(400).json({
        error: "Correcting an estimate to Accepted needs a reason of at least "
          + `${CORRECTION_REASON_MIN_LENGTH} characters — who accepted it, and how.`,
        code: "reason_required",
      });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteAdvisoryLockKey(id)})`);
      const [current] = await tx.select().from(quotesTable).where(eq(quotesTable.id, id)).limit(1);
      if (!current) return { kind: "notFound" as const };
      const [acceptedLink] = await tx.select({ id: estimatePublicLinksTable.id })
        .from(estimatePublicLinksTable)
        .where(and(eq(estimatePublicLinksTable.quoteId, id), eq(estimatePublicLinksTable.decision, "accepted")))
        .limit(1);
      // The customer accepted it; no correction may say otherwise.
      if (acceptedLink) return { kind: "accepted" as const };
      const [updated] = await tx.update(quotesTable).set({ status: requested })
        .where(eq(quotesTable.id, id)).returning();
      await tx.insert(activityLogsTable).values({
        entityType: "customer",
        entityId: current.customerId ?? 0,
        action: "estimate_status_corrected",
        fromValue: current.status ?? null,
        toValue: requested,
        note: `Estimate ${current.quoteNumber} status corrected from ${current.status ?? "none"} to ${requested}`
          + (reason ? `: ${reason}` : ""),
        performedBy: getPerformedBy(req),
      });
      return { kind: "corrected" as const, quote: updated, from: current.status ?? null };
    });

    if (outcome.kind === "notFound") {
      res.status(404).json({ error: "Quote not found" });
      return;
    }
    if (outcome.kind === "accepted") {
      res.status(409).json({
        error: "This estimate was accepted by the customer; its status cannot be corrected.",
        code: "estimate_accepted",
      });
      return;
    }
    res.json({ id, status: requested, previousStatus: outcome.from });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to correct the estimate status" });
  }
});

router.delete("/quotes/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const quote = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteAdvisoryLockKey(id)})`);
      const [current] = await tx.select().from(quotesTable).where(eq(quotesTable.id, id)).limit(1);
      if (!current) return null;
      // Kyle (2026-09-23, #3): estimates delete from the profile, accepted ones
      // included. Everything hanging off the estimate goes with it — revisions,
      // public links, appointments, locations and activities — and a job that
      // came from it keeps its own record, simply pointing at nothing.
      for (const statement of quotePurgeStatements(id)) {
        await tx.execute(sql.raw(statement));
      }
      return current;
    });
    if (!quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete quote" });
  }
});

// Convert quote → job  (idempotent, advisory-lock-serialised)
//
// All conversion logic lives in convertQuoteCore (lib/quote-convert.ts).
// DrizzleTxAdapter binds every DB call to a single transaction so that
// pg_advisory_xact_lock is held for the entire operation.
//
// Concurrency guarantee:
//   pg_advisory_xact_lock(quoteId) is exclusive and transaction-scoped.
//   Competing calls for the same quote block at the lock statement and
//   proceed only after the first transaction commits.  At that point the
//   idempotency check finds the existing job and returns it.
//   A failed pool connection causes db.transaction() to throw BEFORE
//   DrizzleTxAdapter is instantiated — the request fails with 500 and the
//   lock is never reached.  Pool exhaustion therefore causes a hard failure,
//   not a silent bypass.
//
// Residual risk:
//   POST /jobs accepts an arbitrary quoteId and is not protected by this
//   lock.  A direct POST /jobs { quoteId: X } can create a second job for
//   quote X, bypassing the idempotency guard.  A UNIQUE constraint on
//   jobs.quote_id would close this gap (requires a schema migration).
//
// Lead-owned quotes:
//   The lead must be converted first (existing invariant preserved).
//   quote.customerId is NOT backfilled — leadId preserves the audit trail.
router.post("/quotes/:id/convert", async (req, res): Promise<void> => {
  try {
    const id          = parseInt(req.params.id, 10);
    res.status(409).json({
      error: "Estimate conversion is disabled until accepted-estimate scheduling is implemented",
      code: "estimate_conversion_deferred",
      quoteId: id,
    });
    return;
    /* Deferred implementation retained for Task #14:
    const performedBy = getPerformedBy(req);
    const idempotency = getIdempotencyContext(req, "quotes.convert", { quoteId: id });

    const result = await db.transaction(async (tx) => {
      if (idempotency) {
        const claim = await claimIdempotencyKey(tx, idempotency);
        if (claim.kind !== "claimed") return claim;

        const outcome = await convertQuoteCore(id, new DrizzleTxAdapter(tx));
        if (outcome.kind === "created" || outcome.kind === "existing") {
          await completeIdempotencyKey(tx, claim.record.id, {
            resourceType: "job",
            resourceId: outcome.job.id,
            responseStatus: 200,
          });
        } else {
          await releaseIdempotencyKey(tx, claim.record.id);
        }
        return { kind: "outcome" as const, outcome };
      }

      return {
        kind: "outcome" as const,
        outcome: await convertQuoteCore(id, new DrizzleTxAdapter(tx)),
      };
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
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, result.record.resourceId!));
      if (!job) {
        res.status(404).json({ error: "The idempotent job no longer exists" });
        return;
      }
      markIdempotencyReplay(res);
      res.json({
        ...job,
        totalAmount: Number(job.totalAmount),
        createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : job.createdAt,
        updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : job.updatedAt,
      });
      return;
    }

    const outcome = result.outcome;

    if (outcome.kind === "notFound") { res.status(404).json({ error: "Quote not found" }); return; }
    if (outcome.kind === "error")    { res.status(400).json({ error: outcome.message });   return; }

    // Only log activity when a new job was actually created.
    // On the idempotency path (kind="existing") we skip logging so there are
    // no duplicate activity entries.
    if (outcome.kind === "created") {
      const { customerId, leadId, quoteNumber, jobNumber } = outcome.forLog;
      logQuoteActivity(
        { customerId, leadId },
        "quote_converted",
        "approved",
        "job_created",
        `Quote ${quoteNumber} converted to job ${jobNumber}`,
        performedBy,
      ).catch(() => {});
      db.insert(activityLogsTable).values({
        entityType: "customer",
        entityId:   customerId,
        action:     "job_created",
        toValue:    jobNumber,
        note:       `Job created from quote ${quoteNumber}`,
        performedBy,
      }).catch(() => {});
    }

    const j = outcome.job;
    res.json({
      ...j,
      totalAmount: Number(j.totalAmount),
      createdAt:   j.createdAt instanceof Date ? j.createdAt.toISOString() : j.createdAt,
      updatedAt:   j.updatedAt instanceof Date ? j.updatedAt.toISOString() : j.updatedAt,
    });
    */
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to convert quote" });
  }
});

// ─── Quote Line Item sub-routes ───────────────────────────────────────────

router.post("/quotes/:id/line-items", async (req, res): Promise<void> => {
  try {
    const quoteId = parseInt(req.params.id, 10);
    const body = req.body;
    const qty = Number(body.quantity) || 1;
    const price = priceOf(body.unitPrice);
    if ("error" in price) { res.status(400).json({ error: price.error }); return; }
    const li = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteAdvisoryLockKey(quoteId)})`);
      const [quote] = await tx.select({ status: quotesTable.status }).from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1);
      if (!quote) return "not_found" as const;
      if (isTerminalEstimateStatus(quote.status)) return "locked" as const;
      const [created] = await tx.insert(quoteLineItemsTable).values({
        quoteId, serviceId: body.serviceId ? Number(body.serviceId) : null, description: body.description,
        quantity: String(qty), unitPrice: String(price.unitPrice), totalPrice: String(qty * price.unitPrice),
        pricePending: price.pricePending, sortOrder: body.sortOrder ?? 0,
        taxable: typeof body.taxable === "boolean" ? body.taxable
          : (await serviceTaxability(tx, [Number(body.serviceId)])).get(Number(body.serviceId)) ?? false,
      }).returning();
      await saveLineServiceNotes(tx, [{
        lineItemId: created.id,
        serviceNotes: typeof body.serviceNotes === "string" ? body.serviceNotes.trim() || null : null,
      }]);
      await recalcQuoteTotalsTx(tx, quoteId);
      return created;
    });
    if (li === "not_found") { res.status(404).json({ error: "Quote not found" }); return; }
    if (li === "locked") { res.status(409).json({ error: "Accepted estimate terms are locked", code: "estimate_locked" }); return; }
    res.status(201).json(serializeLineItem(li));
  } catch (err) {
    res.status(500).json({ error: "Failed to add line item" });
  }
});

router.patch("/quotes/:id/line-items/:liId", async (req, res): Promise<void> => {
  try {
    const quoteId = parseInt(req.params.id, 10);
    const liId = parseInt(req.params.liId, 10);
    const body = req.body;
    const qty = Number(body.quantity);
    const price = priceOf(body.unitPrice);
    if ("error" in price) { res.status(400).json({ error: price.error }); return; }
    const li = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteAdvisoryLockKey(quoteId)})`);
      const [quote] = await tx.select({ status: quotesTable.status }).from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1);
      if (!quote) return "not_found" as const;
      if (isTerminalEstimateStatus(quote.status)) return "locked" as const;
      const [updated] = await tx.update(quoteLineItemsTable).set({
        description: body.description, quantity: String(qty), unitPrice: String(price.unitPrice), totalPrice: String(qty * price.unitPrice),
        pricePending: price.pricePending,
      }).where(and(eq(quoteLineItemsTable.id, liId), eq(quoteLineItemsTable.quoteId, quoteId))).returning();
      if (updated) await recalcQuoteTotalsTx(tx, quoteId);
      return updated ?? null;
    });
    if (li === "not_found" || !li) { res.status(404).json({ error: "Line item not found for this quote" }); return; }
    if (li === "locked") { res.status(409).json({ error: "Accepted estimate terms are locked", code: "estimate_locked" }); return; }
    res.json(serializeLineItem(li));
  } catch (err) {
    res.status(500).json({ error: "Failed to update line item" });
  }
});

router.delete("/quotes/:id/line-items/:liId", async (req, res): Promise<void> => {
  try {
    const quoteId = parseInt(req.params.id, 10);
    const liId = parseInt(req.params.liId, 10);
    const deleted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteAdvisoryLockKey(quoteId)})`);
      const [quote] = await tx.select({ status: quotesTable.status }).from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1);
      if (!quote) return "not_found" as const;
      if (isTerminalEstimateStatus(quote.status)) return "locked" as const;
      const [removed] = await tx.delete(quoteLineItemsTable)
        .where(and(eq(quoteLineItemsTable.id, liId), eq(quoteLineItemsTable.quoteId, quoteId))).returning();
      if (removed) await recalcQuoteTotalsTx(tx, quoteId);
      return removed ?? null;
    });
    if (deleted === "not_found" || !deleted) { res.status(404).json({ error: "Line item not found for this quote" }); return; }
    if (deleted === "locked") { res.status(409).json({ error: "Accepted estimate terms are locked", code: "estimate_locked" }); return; }
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete line item" });
  }
});

export default router;
