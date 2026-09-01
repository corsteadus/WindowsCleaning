import { Router, type IRouter } from "express";
import { eq, ilike, or, and, sql, desc, inArray } from "drizzle-orm";
import { db, leadsTable, customersTable, activityLogsTable } from "@workspace/db";
import { businessDateStr } from "../lib/date.js";
import {
  convertLeadCore,
  leadAdvisoryLockKey,
  type LeadRow,
  type ConvertLeadAdapter,
  type CustomerInsertValues,
} from "../lib/lead-convert.js";
import {
  findStrongDuplicateCandidates,
  sanitizeConversionReason,
} from "../lib/lead-duplicate-candidates.js";
import {
  customerLifecycleStatus,
  normalizeAccountType,
} from "../lib/account-lifecycle.js";
import { leadNoteActivityValues, leadPatchValues } from "../lib/lead-activity.js";

const router: IRouter = Router();

async function appendLeadNote(
  executor: any,
  leadId: number,
  note: string,
  performedBy: string | null,
) {
  const [log] = await executor.insert(activityLogsTable)
    .values(leadNoteActivityValues(leadId, note, performedBy))
    .returning();
  return log;
}

// ─── List leads ───────────────────────────────────────────────────────────────
router.get("/leads", async (req, res): Promise<void> => {
  const { status, clientType, accountType, search, page, limit: limitParam } = req.query;
  const isPaginated = page !== undefined;
  const pageNum  = Math.max(1, parseInt(String(page  ?? "1"), 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(String(limitParam ?? "50"), 10)));
  const offset   = (pageNum - 1) * pageSize;

  const conditions = [];

  if (status) conditions.push(eq(leadsTable.status, String(status)));
  const requestedAccountType = accountType ?? clientType;
  if (requestedAccountType) {
    conditions.push(eq(leadsTable.clientType, normalizeAccountType(requestedAccountType)));
  }

  if (search) {
    const term = String(search).trim();
    const likeTerm = `%${term}%`;
    const fullNameMatch = sql`UPPER(CONCAT(${leadsTable.firstName}, ' ', ${leadsTable.lastName})) LIKE UPPER(${likeTerm})`;
    conditions.push(or(
      fullNameMatch,
      ilike(leadsTable.firstName, likeTerm),
      ilike(leadsTable.lastName,  likeTerm),
      ilike(leadsTable.email,     likeTerm),
      ilike(leadsTable.phone,     likeTerm),
      ilike(leadsTable.city,      likeTerm),
    ));
  }

  const where = conditions.length === 0
    ? undefined
    : conditions.length === 1
      ? conditions[0]
      : and(...conditions);

  if (isPaginated) {
    const leads = await db.select().from(leadsTable).where(where)
      .orderBy(desc(leadsTable.createdAt))
      .limit(pageSize).offset(offset);
    res.json({ data: await serializeLeadCollection(leads), page: pageNum, pageSize, hasMore: leads.length === pageSize });
  } else {
    const leads = await db.select().from(leadsTable).where(where)
      .orderBy(desc(leadsTable.createdAt));
    res.json(await serializeLeadCollection(leads));
  }
});

// ─── Create lead ──────────────────────────────────────────────────────────────
router.post("/leads", async (req, res): Promise<void> => {
  const body = req.body;
  if (!body.firstName || !body.lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  // Notes are immutable lead activity, rather than a mutable field on the lead.
  // This also makes a note supplied in the New Lead form visible after reload.
  const initialNote = typeof body.notes === "string" ? body.notes.trim() : "";
  const lead = await db.transaction(async (tx) => {
    const [created] = await tx.insert(leadsTable).values({
      firstName:      body.firstName,
      lastName:       body.lastName,
      email:          body.email          ?? null,
      phone:          body.phone          ?? null,
      source:         body.source         ?? null,
      status:         body.status         ?? "new",
      notes:          null,
      address:        body.address        ?? null,
      city:           body.city           ?? null,
      state:          body.state          ?? null,
      zip:            body.zip            ?? null,
      estimatedValue: body.estimatedValue ? String(body.estimatedValue) : null,
      followUpDate:   body.followUpDate   ?? null,
      assignedTo:     body.assignedTo     ?? null,
      clientType:     normalizeAccountType(body.accountType ?? body.clientType),
    }).returning();

    await tx.insert(activityLogsTable).values({
      entityType: "lead", entityId: created.id, action: "created",
      toValue: created.status, performedBy: body.performedBy ?? null,
    });
    if (initialNote) {
      await appendLeadNote(tx, created.id, initialNote, body.performedBy ?? null);
    }
    return created;
  });

  res.status(201).json(serializeLead(lead));
});

// ─── Get lead detail (with activity logs) ────────────────────────────────────
router.get("/leads/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const activityLogs = await db
    .select().from(activityLogsTable)
    .where(and(eq(activityLogsTable.entityType, "lead"), eq(activityLogsTable.entityId, id)))
    .orderBy(desc(activityLogsTable.createdAt));
  const [linkedCustomer] = lead.convertedCustomerId === null
    ? []
    : await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.id, lead.convertedCustomerId));

  res.json({
    ...serializeLead(lead, lead.convertedCustomerId === null || Boolean(linkedCustomer)),
    activityLogs: activityLogs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
  });
});

// ─── Update lead ──────────────────────────────────────────────────────────────
router.patch("/leads/:id", async (req, res): Promise<void> => {
  const id   = parseId(req.params.id);
  const body = req.body as Record<string, unknown>;
  const updateData = leadPatchValues(body);
  const appendedNote = typeof body.notes === "string" ? body.notes.trim() : "";
  if (updateData.estimatedValue !== undefined && updateData.estimatedValue !== null) {
    updateData.estimatedValue = String(updateData.estimatedValue);
  }
  if (body.accountType !== undefined || body.clientType !== undefined) {
    updateData.clientType = normalizeAccountType(body.accountType ?? body.clientType);
  }
  delete updateData.accountType;
  const lead = await db.transaction(async (tx) => {
    const [updated] = Object.keys(updateData).length
      ? await tx.update(leadsTable).set(updateData).where(eq(leadsTable.id, id)).returning()
      : await tx.select().from(leadsTable).where(eq(leadsTable.id, id));
    if (!updated) return null;
    if (appendedNote) {
      await appendLeadNote(tx, id, appendedNote, typeof body.performedBy === "string" ? body.performedBy : null);
    }
    return updated;
  });
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json(serializeLead(lead));
});

// ─── Add note to lead activity log ───────────────────────────────────────────
router.post("/leads/:id/notes", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { note, performedBy } = req.body as { note: string; performedBy?: string };
  if (!note?.trim()) { res.status(400).json({ error: "note is required" }); return; }
  const [lead] = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const log = await appendLeadNote(db, id, note, performedBy ?? null);

  res.status(201).json({ ...log, createdAt: log.createdAt.toISOString() });
});

// ─── Change lead status ───────────────────────────────────────────────────────
router.post("/leads/:id/status", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { status, reason, performedBy } = req.body as { status: string; reason?: string; performedBy?: string };
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  const [current] = await db.select({ status: leadsTable.status }).from(leadsTable).where(eq(leadsTable.id, id));
  if (!current) { res.status(404).json({ error: "Lead not found" }); return; }

  const [lead] = await db.update(leadsTable)
    .set({ status, lostReason: reason ?? null })
    .where(eq(leadsTable.id, id)).returning();

  await db.insert(activityLogsTable).values({
    entityType: "lead", entityId: id, action: "status_changed",
    fromValue: current.status, toValue: status,
    reason: reason ?? null, performedBy: performedBy ?? null,
  });

  res.json(serializeLead(lead));
});

// ─── Delete lead ──────────────────────────────────────────────────────────────
router.delete("/leads/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [lead] = await db.delete(leadsTable).where(eq(leadsTable.id, id)).returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.sendStatus(204);
});

// ─── Read-only strong duplicate candidates ─────────────────────────────────────
router.get("/leads/:id/duplicate-candidates", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid lead id" }); return; }

  const [lead] = await db
    .select({ email: leadsTable.email, phone: leadsTable.phone })
    .from(leadsTable)
    .where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const candidates = await findStrongDuplicateCandidates(db, lead);
  res.json({ candidateCount: candidates.length, candidates });
});

// ─── Convert lead to customer ─────────────────────────────────────────────────
// All conversion logic lives in convertLeadCore (lib/lead-convert.ts).
// DrizzleTxLeadAdapter binds every DB call to a single transaction so that
// pg_advisory_xact_lock(leadAdvisoryLockKey(id)) is held for the entire
// operation. Lead keys are offset by 1e9 so they can never collide with the
// quote lock namespace (quoteAdvisoryLockKey uses the raw quote id).

type DrizzleTX = Parameters<Parameters<typeof db.transaction>[0]>[0];

type CustomerSelect = typeof customersTable.$inferSelect;

class DrizzleTxLeadAdapter implements ConvertLeadAdapter<CustomerSelect> {
  constructor(private readonly tx: DrizzleTX) {}

  async acquireAdvisoryLock(leadId: number): Promise<void> {
    // Transaction-scoped exclusive lock: released automatically on
    // commit/rollback. A failed pool connection makes db.transaction() throw
    // before this runs — hard failure, never a silent lock bypass.
    // Two-int form: (classid, objid) keyspace is separate from the single-int
    // keyspace used by quote/job locks, so collision is impossible.
    const [classid, objid] = leadAdvisoryLockKey(leadId);
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(${classid}, ${objid})`);
  }

  async findLeadById(leadId: number) {
    const [lead] = await this.tx.select().from(leadsTable).where(eq(leadsTable.id, leadId));
    return lead ?? null;
  }

  async findCustomerById(customerId: number) {
    const [customer] = await this.tx.select().from(customersTable).where(eq(customersTable.id, customerId));
    return customer ?? null;
  }

  async findStrongDuplicateCandidates(lead: LeadRow) {
    return findStrongDuplicateCandidates(this.tx, lead);
  }

  async lockCustomerRow(customerId: number): Promise<void> {
    await this.tx.execute(
      sql`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`,
    );
  }

  async insertCustomer(values: CustomerInsertValues) {
    const [customer] = await this.tx.insert(customersTable).values(values).returning();
    return customer;
  }

  async promoteCustomerToActive(customerId: number) {
    const [customer] = await this.tx
      .update(customersTable)
      .set({
        status: "active",
        lifecycleStatus: "customer",
        deactivatedAt: null,
        deactivationReason: null,
        deactivatedBy: null,
      })
      .where(and(
        eq(customersTable.id, customerId),
        or(
          eq(customersTable.lifecycleStatus, "prospect"),
          eq(customersTable.status, "prospect"),
        ),
      ))
      .returning();
    if (!customer) throw new Error(`Customer ${customerId} disappeared during lead conversion`);
    return customer;
  }

  async markLeadConverted(leadId: number, customerId: number): Promise<void> {
    const updated = await this.tx
      .update(leadsTable)
      .set({ status: "won", convertedCustomerId: customerId })
      .where(eq(leadsTable.id, leadId))
      .returning({ id: leadsTable.id });
    if (updated.length === 0) {
      // Lead deleted concurrently (delete does not take the advisory lock).
      // Throwing rolls back the whole transaction, including the customer insert.
      throw new Error(`Lead ${leadId} disappeared during conversion; rolled back`);
    }
  }
}

function serializeCustomer(customer: CustomerSelect) {
  return {
    ...customer,
    lifecycleStatus: customerLifecycleStatus(customer),
    accountType: normalizeAccountType(customer.clientType),
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

router.post("/leads/:id/convert", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid lead id" }); return; }

  const rawExistingCustomerId = req.body?.existingCustomerId;
  let existingCustomerId: number | null = null;
  if (rawExistingCustomerId !== undefined && rawExistingCustomerId !== null && rawExistingCustomerId !== "") {
    existingCustomerId = Number(rawExistingCustomerId);
    if (!Number.isInteger(existingCustomerId) || existingCustomerId <= 0) {
      res.status(400).json({ error: "existingCustomerId must be a positive integer" });
      return;
    }
  }

  const rawCreateSeparateAccount = req.body?.createSeparateAccount;
  if (rawCreateSeparateAccount !== undefined && typeof rawCreateSeparateAccount !== "boolean") {
    res.status(400).json({ error: "createSeparateAccount must be a boolean" });
    return;
  }
  const rawOverrideReason = req.body?.overrideReason;
  if (rawOverrideReason !== undefined && rawOverrideReason !== null && typeof rawOverrideReason !== "string") {
    res.status(400).json({ error: "overrideReason must be a string" });
    return;
  }
  const overrideReason = sanitizeConversionReason(rawOverrideReason);

  const outcome = await db.transaction((tx) =>
    convertLeadCore(
      id,
      businessDateStr(),
      new DrizzleTxLeadAdapter(tx),
      existingCustomerId,
      {
        createSeparateAccount: rawCreateSeparateAccount === true,
        overrideReason,
      },
    ),
  );

  switch (outcome.kind) {
    case "notFound":
      res.status(404).json({ error: "Lead not found" });
      return;
    case "staleLink":
      res.status(409).json({
        error: `Lead is marked converted but customer #${outcome.convertedCustomerId} no longer exists`,
      });
      return;
    case "conflict":
      res.status(409).json({
        error: `Lead is already linked to customer #${outcome.existingCustomerId}`,
        existingCustomerId: outcome.existingCustomerId,
      });
      return;
    case "duplicateCandidates":
      res.status(409).json({
        error: "Strong contact matches found; choose an existing account or confirm creating a separate account with a reason",
        candidateCount: outcome.candidates.length,
        candidates: outcome.candidates,
      });
      return;
    case "targetNotFound":
      res.status(404).json({ error: `Customer #${outcome.customerId} not found` });
      return;
    case "blockedTarget":
      res.status(409).json({
        error: `Customer #${outcome.customerId} is ${outcome.lifecycleStatus} and must be reactivated before linking`,
        lifecycleStatus: outcome.lifecycleStatus,
      });
      return;
    case "existing":
      // Idempotent repeat: return the linked customer, no new activity log.
      res.json(serializeCustomer(outcome.customer));
      return;
    case "created": {
      // Post-commit activity log — a logging failure can't roll back the insert.
      await db.insert(activityLogsTable).values({
        entityType: "lead", entityId: outcome.forLog.leadId, action: "converted",
        toValue: String(outcome.forLog.customerId),
        reason: [
          outcome.forLog.audit.overrideReason ? "create_separate_account" : "create_new_account",
          `candidateCount=${outcome.forLog.audit.candidateCount}`,
          `matchTypes=${outcome.forLog.audit.matchTypes.join(",") || "none"}`,
          outcome.forLog.audit.overrideReason ? `overrideReason=${outcome.forLog.audit.overrideReason}` : null,
        ].filter(Boolean).join(";"),
        performedBy: req.body?.performedBy ?? null,
      });
      res.json(serializeCustomer(outcome.customer));
      return;
    }
    case "linked": {
      await db.insert(activityLogsTable).values({
        entityType: "lead", entityId: outcome.forLog.leadId, action: "converted",
        toValue: String(outcome.forLog.customerId),
        reason: [
          "use_existing_account",
          `selectedCustomerId=${outcome.forLog.audit.selectedCustomerId ?? outcome.forLog.customerId}`,
          `candidateCount=${outcome.forLog.audit.candidateCount}`,
          `matchTypes=${outcome.forLog.audit.matchTypes.join(",") || "none"}`,
        ].join(";"),
        performedBy: req.body?.performedBy ?? null,
      });
      res.json(serializeCustomer(outcome.customer));
      return;
    }
  }
});

function parseId(raw: string | string[]) {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function serializeLeadCollection(leads: Array<typeof leadsTable.$inferSelect>) {
  const convertedIds = leads
    .map(lead => lead.convertedCustomerId)
    .filter((id): id is number => id !== null);
  const validConvertedIds = convertedIds.length === 0
    ? new Set<number>()
    : new Set(
      (await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(inArray(customersTable.id, convertedIds)))
        .map(customer => customer.id),
    );
  return leads.map(lead => serializeLead(
    lead,
    lead.convertedCustomerId === null || validConvertedIds.has(lead.convertedCustomerId),
  ));
}

function serializeLead(
  lead: typeof leadsTable.$inferSelect,
  convertedCustomerIsValid = true,
) {
  return {
    ...lead,
    lifecycleStatus: lead.convertedCustomerId !== null && convertedCustomerIsValid ? "customer" : "prospect",
    accountType: normalizeAccountType(lead.clientType),
    estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

export default router;
