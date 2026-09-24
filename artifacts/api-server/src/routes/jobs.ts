import { Router, type IRouter, type Request } from "express";
import { eq, and, inArray, isNull, gte, lte, isNotNull, desc, sql } from "drizzle-orm";
import {
  db,
  jobsTable,
  customersTable,
  propertiesTable,
  quotesTable,
  invoicesTable,
  invoiceJobsTable,
  invoiceLinesTable,
  activityLogsTable,
  usersTable,
  crewsTable,
  scheduleEntriesTable,
} from "@workspace/db";
import { customerDisplayName } from "../lib/customer-display.ts";
import { primaryCustomerPhone } from "../lib/customer-phone.ts";
import {
  scheduleChangeLock,
  scheduleLockMessage,
  touchesSchedule,
} from "../lib/schedule-change-lock.ts";
import { buildJobStatusUpdate, businessDateStr, canonicalIsoInstant, isDateOnly, isTimeOnly } from "../lib/date.ts";
import {
  createQuotedJobCore,
  quoteAdvisoryLockKey,
  type CreateQuotedJobAdapter,
  type DirectJobInsertValues,
} from "../lib/quote-convert.ts";
import {
  generateInvoiceCore,
  type GenerateInvoiceAdapter,
} from "../lib/billing-core.ts";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyContext,
  idempotencyConflictMessage,
  idempotencyInProgressMessage,
  markIdempotencyReplay,
  releaseIdempotencyKey,
} from "../lib/idempotency.ts";
import { enqueueCommunicationEvent } from "../lib/communication-outbox.ts";
import {
  AccountRelationError,
  normalizeOptionalPropertyId,
  requireActivePropertyForCustomer,
} from "../lib/account-relations.ts";
import {
  isAppendOnlyJobNotesRole,
  isFieldTechJobStatusTransitionAllowed,
  isAssignmentScopedOperationalRole,
  requireCapability,
} from "../lib/authorization.ts";
import { assignedJobCondition, redactAssignedJob } from "../lib/field-tech-scope.ts";
import { appendFieldTechNote } from "../lib/field-tech-notes.ts";

function getPerformedBy(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || String((req.user as { id: string }).id);
}

function normalizeAssignmentUserId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new AccountRelationError(400, "assignedTechnicianUserId must be a non-empty canonical user ID or null");
  }
  return value.trim();
}

function normalizeCrewId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AccountRelationError(400, "crewId must be a positive integer or null");
  return id;
}

async function requireActiveJobAssignments(
  tx: DrizzleTX,
  crewId: number | null,
  assignedTechnicianUserId: string | null,
): Promise<void> {
  if (crewId !== null) {
    const [crew] = await tx.select({ id: crewsTable.id }).from(crewsTable)
      .where(and(eq(crewsTable.id, crewId), eq(crewsTable.isActive, true))).for("update");
    if (!crew) throw new AccountRelationError(400, "crewId must reference an active crew");
  }
  if (assignedTechnicianUserId !== null) {
    const [user] = await tx.select({ id: usersTable.id, role: usersTable.role }).from(usersTable)
      .where(and(eq(usersTable.id, assignedTechnicianUserId), eq(usersTable.isActive, true))).for("update");
    if (!user || !isAssignmentScopedOperationalRole(user.role)) {
      throw new AccountRelationError(400, "assignedTechnicianUserId must reference an active Field Tech user");
    }
  }
}

async function enqueueAppointmentScheduledEvent(
  tx: DrizzleTX,
  job: { id: number; customerId: number; scheduledDate: string | null; updatedAt: Date | string },
  source: string,
  actorId: string | null,
): Promise<void> {
  if (!job.scheduledDate) return;
  await enqueueCommunicationEvent(tx, {
    eventType: "appointment.scheduled",
    aggregateType: "job",
    aggregateId: job.id,
    payload: {
      customerId: job.customerId,
      jobId: job.id,
      scheduledDate: job.scheduledDate,
      changeKind: "scheduled",
    },
    source,
    actorId,
    dedupeKey: `appointment.scheduled:${job.id}:${
      typeof job.updatedAt === "string" ? job.updatedAt : job.updatedAt.toISOString()
    }`,
  });
}

// ── DrizzleTxJobAdapter ───────────────────────────────────────────────────────
// Implements CreateQuotedJobAdapter using a Drizzle transaction.
// Uses quoteAdvisoryLockKey() — the SAME key used by DrizzleTxAdapter in
// quotes.ts — so POST /jobs and POST /quotes/:id/convert share the same
// pg_advisory_xact_lock slot and cannot race each other.

type DrizzleTX = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface JobDeleteProtectionRepository {
  hasLegacyInvoiceLink(jobId: number): Promise<boolean>;
  hasInvoiceJobLink(jobId: number): Promise<boolean>;
}

const drizzleJobDeleteProtectionRepository: JobDeleteProtectionRepository = {
  hasLegacyInvoiceLink: async (jobId) => {
    const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.jobId, jobId)).limit(1);
    return Boolean(invoice);
  },
  hasInvoiceJobLink: async (jobId) => {
    const [association] = await db.select({ invoiceId: invoiceJobsTable.invoiceId }).from(invoiceJobsTable)
      .where(eq(invoiceJobsTable.jobId, jobId)).limit(1);
    return Boolean(association);
  },
};

export async function isJobPermanentDeleteProtected(
  jobId: number,
  status: unknown,
  repository: JobDeleteProtectionRepository = drizzleJobDeleteProtectionRepository,
): Promise<boolean> {
  if (typeof status === "string" && status.trim().toLowerCase() === "completed") return true;
  if (await repository.hasLegacyInvoiceLink(jobId)) return true;
  return repository.hasInvoiceJobLink(jobId);
}

class DrizzleTxJobAdapter implements CreateQuotedJobAdapter {
  private readonly tx: DrizzleTX;
  constructor(tx: DrizzleTX) {
    this.tx = tx;
  }

  async acquireAdvisoryLock(quoteId: number): Promise<void> {
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

  async insertJob(values: DirectJobInsertValues & { quoteId: number }) {
    const [job] = await this.tx
      .insert(jobsTable)
      .values(values)
      .returning();
    return job;
  }
}

export type JobFieldTechRepository = {
  listAssigned(userId: string, query: Record<string, unknown>): Promise<{
    rows: (typeof jobsTable.$inferSelect)[];
    total: number;
  }>;
  listUnscheduled(userId: string): Promise<(typeof jobsTable.$inferSelect)[]>;
  enrichAssigned?: (jobs: (typeof jobsTable.$inferSelect)[]) => Promise<Record<string, any>[]>;
  find(id: number): Promise<typeof jobsTable.$inferSelect | null>;
  findAssigned(id: number, userId: string): Promise<typeof jobsTable.$inferSelect | null>;
  getAssignedDetails?: (id: number, userId: string) => Promise<Record<string, any> | null>;
  getDetails?: (id: number) => Promise<Record<string, any> | null>;
};

export function serializeJob(j: typeof jobsTable.$inferSelect) {
  return {
    ...j,
    totalAmount: Number(j.totalAmount),
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

/**
 * The transaction boundary is injectable for contract tests. Production keeps
 * using the Drizzle database; repository reads remain separately injectable.
 */
export function createJobsRouter(
  fieldTechRepository: JobFieldTechRepository = drizzleJobFieldTechRepository,
  mutationDatabase: Pick<typeof db, "transaction"> = db,
  deleteProtectionLookup: (jobId: number, status: unknown) => Promise<boolean> = isJobPermanentDeleteProtected,
): IRouter {
const router: IRouter = Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

async function enrichJobs(jobs: (typeof jobsTable.$inferSelect)[], fieldTech = false) {
  if (!jobs.length) return [];

  const customerIds = [...new Set(jobs.map((j) => j.customerId))];
  const propertyIds = [...new Set(jobs.map((j) => j.propertyId).filter(Boolean) as number[])];
  const assignedUserIds = [...new Set(jobs.flatMap((job) => {
    if (!job.lineItems) return [];
    try {
      const lines = JSON.parse(job.lineItems) as Array<{ assignedUserIds?: string[] }>;
      return lines.flatMap((line) => line.assignedUserIds ?? []);
    } catch {
      return [];
    }
  }))];
  const directAssigneeIds = [...new Set(jobs
    .map((job) => job.assignedTechnicianUserId)
    .filter((id): id is string => id !== null))];
  const crewIds = [...new Set(jobs.map((job) => job.crewId).filter((id): id is number => id !== null))];

  const customers = customerIds.length
    ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds))
    : [];
  const properties = propertyIds.length
    ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
    : [];
  const assignedUsers = assignedUserIds.length
    ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable).where(inArray(usersTable.id, assignedUserIds))
    : [];
  const directAssignees = directAssigneeIds.length
    ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
      .from(usersTable).where(inArray(usersTable.id, directAssigneeIds))
    : [];
  const crews = crewIds.length
    ? await db.select({ id: crewsTable.id, name: crewsTable.name }).from(crewsTable).where(inArray(crewsTable.id, crewIds))
    : [];

  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c]));
  const propertyMap = Object.fromEntries(properties.map((p) => [p.id, p]));
  const userMap = Object.fromEntries(assignedUsers.map((user) => [
    user.id, [user.firstName, user.lastName].filter(Boolean).join(" ") || "Team member",
  ]));
  const directAssigneeMap = Object.fromEntries(directAssignees.map((user) => [user.id, {
    id: user.id,
    displayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Team member",
  }]));
  const crewMap = Object.fromEntries(crews.map((crew) => [crew.id, crew.name]));

  return jobs.map((j) => {
    const c = customerMap[j.customerId];
    const p = j.propertyId ? propertyMap[j.propertyId] : null;
    let jobAssignedUserIds: string[] = [];
    if (j.lineItems) {
      try {
        const lines = JSON.parse(j.lineItems) as Array<{ assignedUserIds?: string[] }>;
        jobAssignedUserIds = [...new Set(lines.flatMap((line) => line.assignedUserIds ?? []))];
      } catch {
        jobAssignedUserIds = [];
      }
    }
    return {
      ...(fieldTech ? redactAssignedJob(serializeJob(j)) : serializeJob(j)),
      customerName: customerDisplayName(c, j.customerId),
      propertyAddress: p ? [p.address, p.city, p.state].filter(Boolean).join(", ") : null,
      propertyName: p?.name ?? null,
      assignedUserIds: jobAssignedUserIds,
      assignedEmployeeNames: jobAssignedUserIds.map((id) => userMap[id]).filter(Boolean),
      assignedTechnician: j.assignedTechnicianUserId
        ? directAssigneeMap[j.assignedTechnicianUserId] ?? null
        : null,
      crewName: j.crewId ? crewMap[j.crewId] ?? null : null,
    };
  });
}

async function getJobWithDetails(id: number, fieldTechUserId?: string) {
  const [job] = await db.select().from(jobsTable).where(and(
    eq(jobsTable.id, id),
    ...(fieldTechUserId ? [assignedJobCondition(fieldTechUserId)] : []),
  ));
  if (!job) return null;

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, job.customerId));

  let property = null;
  if (job.propertyId) {
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, job.propertyId));
    property = p ?? null;
  }

  let linkedQuote = null;
  if (job.quoteId) {
    const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, job.quoteId));
    if (q) {
      linkedQuote = {
        id: q.id,
        quoteNumber: q.quoteNumber,
        status: q.status,
        totalAmount: Number(q.totalAmount),
      };
    }
  }

  const [assignedTechnician] = job.assignedTechnicianUserId
    ? await db.select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      }).from(usersTable).where(eq(usersTable.id, job.assignedTechnicianUserId)).limit(1)
    : [];
  const [crew] = job.crewId
    ? await db.select({ id: crewsTable.id, name: crewsTable.name })
      .from(crewsTable).where(eq(crewsTable.id, job.crewId)).limit(1)
    : [];

  return {
    ...(fieldTechUserId ? redactAssignedJob(serializeJob(job)) : serializeJob(job)),
    customer: customer
      ? {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          displayName: `${customer.firstName} ${customer.lastName}`,
          email: customer.email,
          phone: primaryCustomerPhone(customer),
        }
      : null,
    property: property
      ? {
          id: property.id,
          name: property.name,
          address: property.address,
          city: property.city,
          state: property.state,
          zip: property.zip,
        }
      : null,
    linkedQuote: fieldTechUserId ? null : linkedQuote,
    assignedTechnician: assignedTechnician ? {
      id: assignedTechnician.id,
      displayName: [assignedTechnician.firstName, assignedTechnician.lastName].filter(Boolean).join(" ")
        || assignedTechnician.email
        || "Team member",
    } : null,
    crewName: crew?.name ?? null,
  };
}

// ─── routes ──────────────────────────────────────────────────────────────────

// Unscheduled jobs — must be before /jobs/:id so it matches correctly
router.get("/jobs/unscheduled", async (req, res): Promise<void> => {
  try {
    const fieldTech = isAssignmentScopedOperationalRole(req.user?.role);
    const jobs = fieldTech
      ? await fieldTechRepository.listUnscheduled(req.user!.id)
      : await db.select().from(jobsTable).where(and(
          isNull(jobsTable.scheduledDate),
          inArray(jobsTable.status, ["unscheduled", "scheduled"]),
        )).orderBy(jobsTable.createdAt);
    res.json(await enrichJobs(jobs, fieldTech));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch unscheduled jobs" });
  }
});

// List jobs with flexible filtering + pagination
router.get("/jobs", async (req, res): Promise<void> => {
  try {
    const { status, crewId, date, customerId, start, end, view, page, limit: limitParam } = req.query;

    // Pagination params (only used for paginated responses)
    const pageNum  = Math.max(1, parseInt(String(page  ?? "1"),  10));
    const pageSize = Math.min(300, Math.max(1, parseInt(String(limitParam ?? "200"), 10)));
    const offset   = (pageNum - 1) * pageSize;
    const isPaginated = page !== undefined;

    let jobs;
    const fieldTech = isAssignmentScopedOperationalRole(req.user?.role);
    if (fieldTech) {
      const assignedResult = await fieldTechRepository.listAssigned(req.user!.id, req.query as Record<string, unknown>);
      const assignedJobs = assignedResult.rows;
      const enriched = fieldTechRepository.enrichAssigned
        ? await fieldTechRepository.enrichAssigned(assignedJobs)
        : await enrichJobs(assignedJobs, true);
      const safe = enriched.map((job) => redactAssignedJob(job));
      if (page !== undefined) {
        res.json({ data: safe, total: assignedResult.total, page: pageNum, pageSize, totalPages: Math.ceil(assignedResult.total / pageSize) });
      } else {
        res.json(safe);
      }
      return;
    }
    const assigned = fieldTech ? assignedJobCondition(req.user!.id) : undefined;

    if (view === "today") {
      // Bounded: only today's jobs (hits scheduled_date index)
      const todayStr = businessDateStr();
      jobs = await db
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.scheduledDate, todayStr), ...(assigned ? [assigned] : [])))
        .orderBy(jobsTable.scheduledStartTime);
      res.json(await enrichJobs(jobs, fieldTech)); return;

    } else if (start && end) {
      // Bounded: date range (hits scheduled_date index)
      jobs = await db
        .select()
        .from(jobsTable)
        .where(and(
          gte(jobsTable.scheduledDate, String(start)),
          lte(jobsTable.scheduledDate, String(end)),
          isNotNull(jobsTable.scheduledDate),
          ...(assigned ? [assigned] : []),
        ))
        .orderBy(jobsTable.scheduledDate);
      res.json(await enrichJobs(jobs, fieldTech)); return;

    } else if (customerId) {
      // Bounded: by customer (hits customer_id index)
      jobs = await db
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.customerId, Number(customerId)), ...(assigned ? [assigned] : [])))
        .orderBy(desc(jobsTable.scheduledDate));
      res.json(await enrichJobs(jobs, fieldTech)); return;

    } else if (date) {
      // Bounded: specific date
      jobs = await db
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.scheduledDate, String(date)), ...(assigned ? [assigned] : [])))
        .orderBy(jobsTable.scheduledStartTime);
      res.json(await enrichJobs(jobs, fieldTech)); return;
    }

    // ── Paginated multi-filter path ────────────────────────────────────────────
    // Builds conditions from any combo of status/crewId and supports pagination.
    const conditions = [];
    if (status)  conditions.push(eq(jobsTable.status,  String(status)));
    if (crewId)  conditions.push(eq(jobsTable.crewId,  Number(crewId)));
    if (assigned) conditions.push(assigned);

    const where = conditions.length === 0 ? undefined
      : conditions.length === 1 ? conditions[0]
      : and(...conditions);

    // Always return paginated + total for general queries (avoids loading 21k rows)
    const [rows, countResult] = await Promise.all([
      db.select().from(jobsTable)
        .where(where)
        .orderBy(desc(jobsTable.scheduledDate))
        .limit(pageSize)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(jobsTable).where(where),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const enriched = await enrichJobs(rows, fieldTech);

    if (isPaginated) {
      res.json({ data: enriched, total, page: pageNum, pageSize, totalPages: Math.ceil(total / pageSize) });
      return;
    }
    // Legacy: non-paginated callers (e.g. schedule components) get the array directly
    // but capped to avoid loading tens of thousands of rows
    res.json(enriched);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

// Create job
//
// When body.quoteId is present the request enters the guarded path:
//   1. pg_advisory_xact_lock(quoteAdvisoryLockKey(quoteId)) — same key as
//      POST /quotes/:id/convert, so the two endpoints cannot race each other.
//   2. If a job already exists for that quoteId → 409 Conflict.
//      (Use POST /quotes/:id/convert to retrieve the existing job idempotently.)
//   3. If the quote does not exist → 404 (prevents dangling quoteId foreign keys).
//   4. Otherwise insert.
//
// When body.quoteId is absent the path is completely unchanged: direct
// db.insert(), no lock, no conflict check.
router.post("/jobs", async (req, res): Promise<void> => {
  try {
    const body     = req.body;
    if (body.completedAt !== undefined && (body.status ?? "scheduled") !== "completed") {
      res.status(400).json({ error: "completedAt may only be supplied when status is completed" });
      return;
    }
    if (body.status === "completed" && body.completedAt === null) {
      res.status(400).json({ error: "completedAt cannot be null when status is completed" });
      return;
    }
    if (body.completedAt !== undefined && body.completedAt !== null && !canonicalIsoInstant(body.completedAt)) {
      res.status(400).json({ error: "completedAt must be a valid ISO date-time with an explicit offset" });
      return;
    }
    for (const field of ["scheduledDate"] as const) {
      if (body[field] !== undefined && body[field] !== null && !isDateOnly(body[field])) {
        res.status(400).json({ error: `${field} must be a valid YYYY-MM-DD date` });
        return;
      }
    }
    for (const field of ["scheduledStartTime", "scheduledEndTime"] as const) {
      if (body[field] !== undefined && body[field] !== null && !isTimeOnly(body[field])) {
        res.status(400).json({ error: `${field} must be a valid HH:mm or HH:mm:ss time` });
        return;
      }
    }
    const quoteId  = body.quoteId ? Number(body.quoteId) : null;
    const source   = body.recurringPlanId ? "recurring_plan" : "manual";

    if (quoteId !== null) {
      res.status(409).json({
        error: "Quote-linked job creation is disabled until accepted-estimate scheduling is implemented",
        code: "estimate_conversion_deferred",
      });
      return;
    }

    if (!body.customerId) {
      res.status(400).json({ error: "customerId is required" });
      return;
    }

    const jobNumber  = `J-${Date.now()}`;
    const isRecurring = !!(body.isRecurring || body.recurringPlanId);
    const customerId = Number(body.customerId);
    const propertyId = normalizeOptionalPropertyId(body.propertyId);
    const statusUpdate = buildJobStatusUpdate(
      body.status ?? "scheduled",
      body.scheduledDate ?? null,
    );
    if (statusUpdate.kind === "future") {
      res.status(400).json({
        error: "Cannot start or complete a future-dated job",
        code: "future_scheduled_job",
        detail: `Job is scheduled for ${statusUpdate.scheduledDate}, which is after today (${statusUpdate.today}). Start and completion are available on or after the scheduled date.`,
        scheduledDate: statusUpdate.scheduledDate,
        today: statusUpdate.today,
      });
      return;
    }

    let insertedJobId:     number;

    if (quoteId !== null) {
      // ── Quote-linked path ────────────────────────────────────────────────────
      const directValues: DirectJobInsertValues = {
        customerId,
        propertyId,
        crewId:              body.crewId ? Number(body.crewId) : null,
        recurringPlanId:     body.recurringPlanId ? Number(body.recurringPlanId) : null,
        jobNumber,
        status:              statusUpdate.status,
        serviceType:         body.serviceType ?? null,
        scheduledDate:       body.scheduledDate ?? null,
        scheduledStartTime:  body.scheduledStartTime ?? null,
        scheduledEndTime:    body.scheduledEndTime ?? null,
        estimatedDuration:   body.estimatedDuration ?? null,
        isRecurring,
        recurringFrequency:  body.recurringFrequency ?? null,
        totalAmount:         String(body.totalAmount ?? 0),
        notes:               body.notes ?? null,
        lineItems:           body.lineItems ?? null,
      };

      const idempotency = getIdempotencyContext(req, "jobs.create_from_quote", {
        quoteId,
        customerId: directValues.customerId,
        propertyId: directValues.propertyId,
        crewId: directValues.crewId,
        recurringPlanId: directValues.recurringPlanId,
        status: directValues.status,
        serviceType: directValues.serviceType,
        scheduledDate: directValues.scheduledDate,
        scheduledStartTime: directValues.scheduledStartTime,
        scheduledEndTime: directValues.scheduledEndTime,
        estimatedDuration: directValues.estimatedDuration,
        isRecurring: directValues.isRecurring,
        recurringFrequency: directValues.recurringFrequency,
        totalAmount: directValues.totalAmount,
        notes: directValues.notes,
        lineItems: directValues.lineItems,
      });

      const result = await mutationDatabase.transaction(async (tx) => {
        if (directValues.propertyId !== null) {
          await requireActivePropertyForCustomer(tx, directValues.customerId, directValues.propertyId);
        }
        if (idempotency) {
          const claim = await claimIdempotencyKey(tx, idempotency);
          if (claim.kind !== "claimed") return claim;
          const outcome = await createQuotedJobCore(
            quoteId,
            directValues,
            new DrizzleTxJobAdapter(tx),
          );
          if (outcome.kind === "created") {
            await tx.insert(activityLogsTable).values({
              entityType: "customer",
              entityId: customerId,
              action: "job_created",
              toValue: outcome.job.status,
              note: `Job ${jobNumber} created (${source})${body.scheduledDate ? ` for ${body.scheduledDate}` : ""}`,
              performedBy: getPerformedBy(req),
            });
            await enqueueAppointmentScheduledEvent(
              tx,
              { ...outcome.job, scheduledDate: directValues.scheduledDate },
              "jobs.create",
              getPerformedBy(req),
            );
            await completeIdempotencyKey(tx, claim.record.id, {
              resourceType: "job",
              resourceId: outcome.job.id,
              responseStatus: 201,
            });
          } else {
            await releaseIdempotencyKey(tx, claim.record.id);
          }
          return { kind: "outcome" as const, outcome };
        }

        const outcome = await createQuotedJobCore(
          quoteId,
          directValues,
          new DrizzleTxJobAdapter(tx),
        );
        if (outcome.kind === "created") {
          await tx.insert(activityLogsTable).values({
            entityType: "customer",
            entityId: customerId,
            action: "job_created",
            toValue: outcome.job.status,
            note: `Job ${jobNumber} created (${source})${body.scheduledDate ? ` for ${body.scheduledDate}` : ""}`,
            performedBy: getPerformedBy(req),
          });
          await enqueueAppointmentScheduledEvent(
            tx,
            { ...outcome.job, scheduledDate: directValues.scheduledDate },
            "jobs.create",
            getPerformedBy(req),
          );
        }
        return {
          kind: "outcome" as const,
          outcome,
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
        const full = await getJobWithDetails(result.record.resourceId!);
        if (!full) {
          res.status(404).json({ error: "The idempotent job no longer exists" });
          return;
        }
        markIdempotencyReplay(res);
        res.status(result.record.responseStatus ?? 201).json(full);
        return;
      }

      const outcome = result.outcome;

      if (outcome.kind === "quoteNotFound") {
        res.status(404).json({ error: `Quote #${quoteId} not found. Provide a valid quoteId or omit it.` });
        return;
      }
      if (outcome.kind === "conflict") {
        res.status(409).json({
          error:
            `A job already exists for quote #${quoteId} (job id: ${outcome.existingJobId}). ` +
            `Use POST /quotes/${quoteId}/convert to retrieve the existing job, ` +
            `or PATCH /jobs/${outcome.existingJobId} to update it.`,
        });
        return;
      }
      insertedJobId     = outcome.job.id;
    } else {
      // ── No-quote path: unchanged — direct insert, no lock, no conflict check ─
      const j = await mutationDatabase.transaction(async (tx) => {
        if (propertyId !== null) {
          await requireActivePropertyForCustomer(tx, customerId, propertyId);
        }
        const crewId = normalizeCrewId(body.crewId);
        const assignedTechnicianUserId = normalizeAssignmentUserId(body.assignedTechnicianUserId);
        await requireActiveJobAssignments(tx, crewId, assignedTechnicianUserId);
        const [created] = await tx.insert(jobsTable).values({
          customerId,
          propertyId,
          quoteId:             null,
          crewId,
          assignedTechnicianUserId,
          recurringPlanId:     body.recurringPlanId ? Number(body.recurringPlanId) : null,
          jobNumber,
          status:               statusUpdate.status,
          completedAt:          body.completedAt === undefined
            ? statusUpdate.completedAt
            : body.completedAt === null ? null : canonicalIsoInstant(body.completedAt)!,
          serviceType:          body.serviceType ?? null,
          scheduledDate:        body.scheduledDate ?? null,
          scheduledStartTime:   body.scheduledStartTime ?? null,
          scheduledEndTime:     body.scheduledEndTime ?? null,
          estimatedDuration:    body.estimatedDuration ?? null,
          isRecurring,
          recurringFrequency:   body.recurringFrequency ?? null,
          totalAmount:          String(body.totalAmount ?? 0),
          notes:                body.notes ?? null,
          lineItems:            body.lineItems ?? null,
        }).returning();
        if (created.assignedTechnicianUserId !== null) {
          await tx.insert(activityLogsTable).values({
            entityType: "customer", entityId: created.customerId, action: "job_technician_assigned",
            fromValue: null, toValue: created.assignedTechnicianUserId,
            note: `Job ${created.jobNumber} technician assigned`,
            performedBy: getPerformedBy(req),
          });
        }
        await tx.insert(activityLogsTable).values({
          entityType: "customer",
          entityId: customerId,
          action: "job_created",
          toValue: created.status,
          note: `Job ${jobNumber} created (${source})${body.scheduledDate ? ` for ${body.scheduledDate}` : ""}`,
          performedBy: getPerformedBy(req),
        });
        await enqueueAppointmentScheduledEvent(tx, created, "jobs.create", getPerformedBy(req));
        return created;
      });
      insertedJobId     = j.id;
    }

    const full = fieldTechRepository.getDetails
      ? await fieldTechRepository.getDetails(insertedJobId)
      : await getJobWithDetails(insertedJobId);
    res.status(201).json(full);
  } catch (err) {
    if (err instanceof AccountRelationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create job" });
  }
});

// Get single job with full details
router.get("/jobs/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const fieldTech = isAssignmentScopedOperationalRole(req.user?.role);
    const job = fieldTech
      ? await (fieldTechRepository.getAssignedDetails
          ? fieldTechRepository.getAssignedDetails(id, req.user!.id)
          : getJobWithDetails(id, req.user!.id))
      : await (fieldTechRepository.getDetails
          ? fieldTechRepository.getDetails(id)
          : getJobWithDetails(id));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const isDeleteProtected = await deleteProtectionLookup(
      id,
      (job as { status?: unknown }).status,
    );
    const detail = { ...job, isDeleteProtected };
    res.json(fieldTech ? redactAssignedJob(detail) : detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch job" });
  }
});

// Update job — auto-handles completedAt
router.patch("/jobs/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body;
    const fieldTech = isAssignmentScopedOperationalRole(req.user?.role);
    const appendOnlyNotes = isAppendOnlyJobNotesRole(req.user?.role);
    // Fast rejection improves the common unassigned case. This is not the
    // authority check: assignment is re-read from the locked row below so a
    // reassignment after this preflight still fails atomically.
    if (fieldTech) {
      const exists = await fieldTechRepository.find(id);
      if (exists && !await fieldTechRepository.findAssigned(id, req.user!.id)) {
        res.status(403).json({
          error: "This job is not assigned to you",
          code: "assigned_work_required",
        });
        return;
      }
    }
    const result = await mutationDatabase.transaction(async (tx) => {
      const [current] = await tx.select({
        status: jobsTable.status, customerId: jobsTable.customerId, jobNumber: jobsTable.jobNumber,
        propertyId: jobsTable.propertyId,
        scheduledDate: jobsTable.scheduledDate, crewId: jobsTable.crewId,
        scheduledStartTime: jobsTable.scheduledStartTime,
        scheduledEndTime: jobsTable.scheduledEndTime,
        notes: jobsTable.notes, techNotes: jobsTable.techNotes,
        lineItems: jobsTable.lineItems,
        assignedTechnicianUserId: jobsTable.assignedTechnicianUserId,
      }).from(jobsTable).where(eq(jobsTable.id, id)).for("update");
      if (!current) return { kind: "notFound" as const };
      if (fieldTech) {
        const [assigned] = await tx.select({ id: jobsTable.id }).from(jobsTable)
          .where(and(eq(jobsTable.id, id), assignedJobCondition(req.user!.id)));
        if (!assigned) return { kind: "unassigned" as const };
      }
      if (
        appendOnlyNotes
        && body.status !== undefined
        && (
          typeof body.status !== "string"
          || !isFieldTechJobStatusTransitionAllowed(current.status, body.status)
        )
      ) {
        return { kind: "forbiddenTransition" as const };
      }

      const updateData: Record<string, unknown> = {};
      for (const field of ["scheduledDate"] as const) {
        if (body[field] !== undefined && body[field] !== null && !isDateOnly(body[field])) {
          return { kind: "invalidDate" as const, field };
        }
      }
      for (const field of ["scheduledStartTime", "scheduledEndTime"] as const) {
        if (body[field] !== undefined && body[field] !== null && !isTimeOnly(body[field])) {
          return { kind: "invalidTime" as const, field };
        }
      }

      // Finished and billed work keeps the date it actually happened on.
      // Compared against the locked row, so a value merely resent by a form is
      // not treated as a move, and a concurrent completion cannot slip a
      // reschedule past this check.
      const scheduleChanges = {
        scheduledDate: body.scheduledDate !== undefined
          && (body.scheduledDate || null) !== current.scheduledDate,
        scheduledStartTime: body.scheduledStartTime !== undefined
          && (body.scheduledStartTime || null) !== current.scheduledStartTime,
        scheduledEndTime: body.scheduledEndTime !== undefined
          && (body.scheduledEndTime || null) !== current.scheduledEndTime,
      };
      if (touchesSchedule(scheduleChanges)) {
        const [invoiceLink] = await tx.select({ id: invoiceJobsTable.id })
          .from(invoiceJobsTable).where(eq(invoiceJobsTable.jobId, id)).limit(1);
        const lock = scheduleChangeLock({
          currentStatus: current.status,
          ...(body.status !== undefined ? { requestedStatus: body.status } : {}),
          hasInvoice: Boolean(invoiceLink),
          changes: scheduleChanges,
        });
        if (lock) return { kind: "scheduleLocked" as const, reason: lock };
      }

      if (body.propertyId !== undefined) {
        const propertyId = normalizeOptionalPropertyId(body.propertyId);
        if (propertyId !== null) {
          await requireActivePropertyForCustomer(tx, current.customerId, propertyId);
        }
        updateData.propertyId = propertyId;
      }
      if (body.crewId !== undefined) {
        if (fieldTech) return { kind: "forbiddenAssignmentChange" as const };
        updateData.crewId = normalizeCrewId(body.crewId);
      }
      if (body.assignedTechnicianUserId !== undefined) {
        if (fieldTech) return { kind: "forbiddenAssignmentChange" as const };
        updateData.assignedTechnicianUserId = normalizeAssignmentUserId(body.assignedTechnicianUserId);
      }
      if (body.crewId !== undefined || body.assignedTechnicianUserId !== undefined) {
        const nextCrewId = body.crewId === undefined
          ? current.crewId
          : normalizeCrewId(body.crewId);
        const nextAssignee = body.assignedTechnicianUserId === undefined
          ? current.assignedTechnicianUserId
          : normalizeAssignmentUserId(body.assignedTechnicianUserId);
        await requireActiveJobAssignments(tx, nextCrewId, nextAssignee);
      }
      if (body.serviceType !== undefined) updateData.serviceType = body.serviceType;
      if (body.scheduledDate !== undefined) updateData.scheduledDate = body.scheduledDate || null;
      if (body.scheduledStartTime !== undefined) updateData.scheduledStartTime = body.scheduledStartTime || null;
      if (body.scheduledEndTime !== undefined) updateData.scheduledEndTime = body.scheduledEndTime || null;
      if (body.estimatedDuration !== undefined) updateData.estimatedDuration = body.estimatedDuration;
      if (body.isRecurring !== undefined) updateData.isRecurring = body.isRecurring;
      if (body.recurringFrequency !== undefined) updateData.recurringFrequency = body.recurringFrequency;
      if (body.totalAmount !== undefined) updateData.totalAmount = String(body.totalAmount);
      if (body.notes !== undefined) {
        updateData.notes = appendOnlyNotes
          ? appendFieldTechNote(current.notes, body.notes)
          : body.notes;
      }
      if (body.techNotes !== undefined) {
        updateData.techNotes = appendOnlyNotes
          ? appendFieldTechNote(current.techNotes, body.techNotes)
          : body.techNotes;
      }
      if (
        body.status === undefined
        && current.status === "unscheduled"
        && typeof body.scheduledDate === "string"
        && body.scheduledDate
      ) {
        updateData.status = "scheduled";
      }

      if (body.status !== undefined) {
        if (body.status === "completed" || body.status === "in_progress") {
          const effectiveDate = (body.scheduledDate !== undefined
            ? body.scheduledDate
            : current.scheduledDate) as string | null | undefined;
          const completion = buildJobStatusUpdate(body.status, effectiveDate);
          if (completion.kind === "future") return { kind: "future" as const, scheduledDate: effectiveDate, today: completion.today };
        }
        const statusUpdate = buildJobStatusUpdate(
          body.status,
          (body.scheduledDate !== undefined
            ? body.scheduledDate
            : current.scheduledDate) as string | null | undefined,
        );
        if (statusUpdate.kind === "updated") {
          updateData.status = statusUpdate.status;
          updateData.completedAt = statusUpdate.completedAt;
        }
      }
      if (body.completedAt !== undefined) {
        const effectiveStatus = body.status ?? current.status;
        if (effectiveStatus !== "completed") return { kind: "invalidCompletedAt" as const };
        if (body.completedAt === null) return { kind: "invalidCompletedAtNull" as const };
        const completedAt = canonicalIsoInstant(body.completedAt);
        if (!completedAt) return { kind: "invalidCompletedAtValue" as const };
        updateData.completedAt = completedAt;
      }

      const updateWhere = fieldTech
        ? and(eq(jobsTable.id, id), assignedJobCondition(req.user!.id))
        : eq(jobsTable.id, id);
      const [job] = await tx.update(jobsTable).set(updateData).where(updateWhere).returning();
      if (fieldTech && !job) return { kind: "unassigned" as const };
      if (!job) return { kind: "notFound" as const };
      const statusChanged = job.status !== current.status;
      const dateChanged = job.scheduledDate !== current.scheduledDate;
      const crewChanged = job.crewId !== current.crewId;
      const technicianChanged = job.assignedTechnicianUserId !== current.assignedTechnicianUserId;
      if (statusChanged) {
        await tx.insert(activityLogsTable).values({
          entityType: "customer", entityId: current.customerId, action: "job_status_changed",
          fromValue: current.status, toValue: job.status,
          note: `Job ${current.jobNumber} moved from ${current.status} to ${job.status}`,
          performedBy: getPerformedBy(req),
        });
      }
      if (dateChanged) {
        await tx.insert(activityLogsTable).values({
          entityType: "customer", entityId: current.customerId, action: "job_rescheduled",
          fromValue: current.scheduledDate ?? "unscheduled", toValue: job.scheduledDate ?? "unscheduled",
          note: `Job ${current.jobNumber} rescheduled from ${current.scheduledDate ?? "unscheduled"} to ${job.scheduledDate ?? "unscheduled"}`,
          performedBy: getPerformedBy(req),
        });
      }
      if (crewChanged) {
        await tx.insert(activityLogsTable).values({
          entityType: "customer", entityId: current.customerId, action: "job_crew_assigned",
          fromValue: current.crewId ? String(current.crewId) : null,
          toValue: job.crewId ? String(job.crewId) : null,
          note: `Job ${current.jobNumber} crew ${job.crewId ? "assigned" : "cleared"}`,
          performedBy: getPerformedBy(req),
        });
      }
      if (technicianChanged) {
        await tx.insert(activityLogsTable).values({
          entityType: "customer", entityId: current.customerId, action: "job_technician_assigned",
          fromValue: current.assignedTechnicianUserId,
          toValue: job.assignedTechnicianUserId,
          note: `Job ${current.jobNumber} technician ${job.assignedTechnicianUserId ? "assigned" : "cleared"}`,
          performedBy: getPerformedBy(req),
        });
      }
      if (statusChanged && body.status === "completed") {
        await enqueueCommunicationEvent(tx, {
          eventType: "job.completed", aggregateType: "job", aggregateId: job.id,
          payload: { customerId: job.customerId, jobId: job.id, status: job.status },
          source: "jobs.patch", actorId: getPerformedBy(req),
          dedupeKey: `job.completed:${job.id}:${job.completedAt ?? job.updatedAt.toISOString()}`,
        });
      }
      if (dateChanged) {
        const scheduledEvent = current.scheduledDate ? "appointment.changed" : "appointment.scheduled";
        await enqueueCommunicationEvent(tx, {
          eventType: scheduledEvent, aggregateType: "job", aggregateId: job.id,
          payload: {
            customerId: job.customerId, jobId: job.id, scheduledDate: job.scheduledDate,
            changeKind: current.scheduledDate
              ? (job.scheduledDate ? "rescheduled" : "unscheduled")
              : "scheduled",
          },
          source: "jobs.patch", actorId: getPerformedBy(req),
          dedupeKey: `appointment:${scheduledEvent}:${job.id}:${job.updatedAt.toISOString()}`,
        });
      }
      return { kind: "updated" as const, job };
    });
    if (result.kind === "notFound") { res.status(404).json({ error: "Job not found" }); return; }
    if (result.kind === "unassigned") {
      res.status(403).json({ error: "This job is not assigned to you", code: "assigned_work_required" });
      return;
    }
    if (result.kind === "invalidDate" || result.kind === "invalidTime") {
      res.status(400).json({ error: `${result.field} must be a valid ${result.kind === "invalidDate" ? "YYYY-MM-DD date" : "HH:mm or HH:mm:ss time"}` });
      return;
    }
    if (result.kind === "invalidCompletedAt" || result.kind === "invalidCompletedAtValue" || result.kind === "invalidCompletedAtNull") {
      res.status(400).json({
        error: result.kind === "invalidCompletedAt"
          ? "completedAt may only be supplied when the effective status is completed"
          : result.kind === "invalidCompletedAtNull"
            ? "completedAt cannot be null when the effective status is completed"
            : "completedAt must be a valid ISO date-time with an explicit offset",
      });
      return;
    }
    if (result.kind === "scheduleLocked") {
      res.status(409).json({
        error: scheduleLockMessage(result.reason),
        code: "schedule_locked",
        reason: result.reason,
      });
      return;
    }
    if (result.kind === "forbiddenAssignmentChange") {
      res.status(403).json({ error: "Field technicians cannot change job assignments", code: "capability_required" });
      return;
    }
    if (result.kind === "forbiddenTransition") {
      res.status(403).json({
        error: "Field technicians may only start scheduled jobs or complete jobs in progress",
        code: "capability_required",
        capability: "schedule.manage",
      });
      return;
    }
    if (result.kind === "future") {
      res.status(400).json({
        error: "Cannot start or complete a future-dated job",
        code: "future_scheduled_job",
        detail: `Job is scheduled for ${result.scheduledDate}, which is after today (${result.today}). Start and completion are available on or after the scheduled date.`,
        scheduledDate: result.scheduledDate,
        today: result.today,
      });
      return;
    }

    if (fieldTech) {
      res.json(redactAssignedJob(serializeJob(result.job)));
      return;
    }
    const full = fieldTechRepository.getDetails
      ? await fieldTechRepository.getDetails(id)
      : await getJobWithDetails(id);
    res.json(full);
  } catch (err) {
    if (err instanceof AccountRelationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update job" });
  }
});

// Generate invoice from a completed job
router.post("/jobs/:id/generate-invoice", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const idempotency = getIdempotencyContext(req, "invoices.generate_from_job", { jobId: id });
    const result = await db.transaction(async (tx) => {
      const claim = idempotency ? await claimIdempotencyKey(tx, idempotency) : null;
      if (claim && claim.kind !== "claimed") return claim;

      const adapter: GenerateInvoiceAdapter = {
        acquireAdvisoryLock: async (jobId) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${jobId})`);
        },
        findJobById: async (jobId) => {
          const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, jobId));
          return job ?? null;
        },
        findInvoiceByJobId: async (jobId) => {
          const [legacyInvoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.jobId, jobId));
          if (legacyInvoice) return legacyInvoice;
          const [association] = await tx
            .select({ invoiceId: invoiceJobsTable.invoiceId })
            .from(invoiceJobsTable)
            .where(eq(invoiceJobsTable.jobId, jobId));
          if (!association) return null;
          const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, association.invoiceId));
          return invoice ?? null;
        },
        findQuoteById: async (quoteId) => {
          const [quote] = await tx.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
          return quote ?? null;
        },
        insertInvoice: async (values) => {
          const [invoice] = await tx.insert(invoicesTable).values(values).returning();
          return invoice;
        },
      };

      const outcome = await generateInvoiceCore(id, adapter);
      if (outcome.kind === "created") {
        await tx.insert(invoiceJobsTable).values({
          invoiceId: outcome.invoice.id,
          jobId: outcome.job.id,
        });
        // The legacy generator's job/quote total is authoritative. Snapshot it
        // as one attributed service line rather than re-calculating old JSON
        // line items with binary floating point.
        await tx.insert(invoiceLinesTable).values({
          invoiceId: outcome.invoice.id,
          jobId: outcome.job.id,
          description: "Job services",
          quantity: "1",
          unitPrice: outcome.total,
          discountAmount: "0",
          taxAmount: "0",
          lineTotal: outcome.total,
          sortOrder: 0,
        });
      }
      if (claim && (outcome.kind === "created" || outcome.kind === "existing")) {
        await completeIdempotencyKey(tx, claim.record.id, {
          resourceType: "invoice",
          resourceId: outcome.invoice.id,
          responseStatus: outcome.kind === "created" ? 201 : 200,
        });
      } else if (claim) {
        await releaseIdempotencyKey(tx, claim.record.id);
      }
      return { kind: "outcome" as const, outcome };
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
      res.status(result.record.responseStatus ?? 200).json({
        ...replayedInvoice,
        subtotal: Number(replayedInvoice.subtotal),
        taxAmount: Number(replayedInvoice.taxAmount),
        totalAmount: Number(replayedInvoice.totalAmount),
        amountPaid: Number(replayedInvoice.amountPaid),
        balanceDue: Number(replayedInvoice.balanceDue),
        createdAt: replayedInvoice.createdAt instanceof Date ? replayedInvoice.createdAt.toISOString() : replayedInvoice.createdAt,
        updatedAt: replayedInvoice.updatedAt instanceof Date ? replayedInvoice.updatedAt.toISOString() : replayedInvoice.updatedAt,
      });
      return;
    }
    const outcome = result.outcome;
    if (outcome.kind === "notFound") {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (outcome.kind === "notCompleted") {
      res.status(400).json({ error: "Invoice can only be generated from a completed job" });
      return;
    }

    if (outcome.kind === "created") {
      // Log invoice generation only for the first successful effect.
      await db.insert(activityLogsTable).values({
        entityType:  "customer",
        entityId:    outcome.job.customerId,
        action:      "invoice_generated",
        toValue:     outcome.invoice.invoiceNumber,
        note:        `Invoice ${outcome.invoice.invoiceNumber} generated from job ${outcome.job.jobNumber} ($${Number(outcome.total).toFixed(2)})`,
        performedBy: getPerformedBy(req),
      }).catch(() => {});
    }

    const invoice = outcome.invoice;
    // Retries return the canonical invoice with a successful 200 response.
    res.status(outcome.kind === "created" ? 201 : 200).json({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      taxAmount: Number(invoice.taxAmount),
      totalAmount: Number(invoice.totalAmount),
      amountPaid: Number(invoice.amountPaid),
      balanceDue: Number(invoice.balanceDue),
      createdAt: invoice.createdAt instanceof Date ? invoice.createdAt.toISOString() : invoice.createdAt,
      updatedAt: invoice.updatedAt instanceof Date ? invoice.updatedAt.toISOString() : invoice.updatedAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate invoice" });
  }
});

// Delete job
router.delete("/jobs/:id", requireCapability("jobs.manage"), async (req, res): Promise<void> => {
  try {
    // `jobs.manage` authorizes the job domain; assignment-scoped operational
    // roles retain only start/complete/note actions and may never delete.
    if (isAssignmentScopedOperationalRole(req.user?.role)) {
      res.status(403).json({
        error: "Field technicians cannot delete jobs",
        code: "capability_required",
        capability: "jobs.manage",
      });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Job id must be a positive integer" });
      return;
    }
    const result = await mutationDatabase.transaction(async (tx) => {
      const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, id)).for("update");
      if (!job) return { kind: "notFound" as const };
      const [[legacyLink], [junctionLink]] = await Promise.all([
        tx.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.jobId, id)).limit(1),
        tx.select({ invoiceId: invoiceJobsTable.invoiceId }).from(invoiceJobsTable)
          .where(eq(invoiceJobsTable.jobId, id)).limit(1),
      ]);
      // Kyle (2026-09-23, #3): jobs delete from the profile, completed ones
      // included. An invoice still blocks it — deleting a job an invoice bills
      // for would corrupt the billing record. Deleting the whole profile does
      // take the invoice with it.
      if (legacyLink || junctionLink) return { kind: "invoiced" as const };
      const [deleted] = await tx.delete(jobsTable).where(eq(jobsTable.id, id)).returning();
      if (!deleted) return { kind: "notFound" as const };
      // The calendar entry the sync trigger keeps for this job goes with it.
      await tx.delete(scheduleEntriesTable).where(eq(scheduleEntriesTable.jobId, id));
      await tx.insert(activityLogsTable).values({
        entityType: "customer",
        entityId: job.customerId,
        action: "job_deleted",
        fromValue: job.status,
        note: `Job ${job.jobNumber} deleted`,
        performedBy: getPerformedBy(req),
      });
      return { kind: "deleted" as const };
    });
    if (result.kind === "notFound") {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (result.kind !== "deleted") {
      res.status(409).json({
        error: "This job is billed on an invoice. Delete that invoice first, or delete the whole profile.",
        code: "invoice_linked_job",
      });
      return;
    }
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete job" });
  }
});

return router;
}

const drizzleJobFieldTechRepository: JobFieldTechRepository = {
  listAssigned: async (userId, query) => {
    const assigned = assignedJobCondition(userId);
    if (query.view === "today") {
      const today = businessDateStr();
      const rows = await db.select().from(jobsTable).where(and(eq(jobsTable.scheduledDate, today), assigned)).orderBy(jobsTable.scheduledStartTime);
      return { rows, total: rows.length };
    }
    if (query.start && query.end) {
      const rows = await db.select().from(jobsTable).where(and(
        gte(jobsTable.scheduledDate, String(query.start)), lte(jobsTable.scheduledDate, String(query.end)),
        isNotNull(jobsTable.scheduledDate), assigned,
      )).orderBy(jobsTable.scheduledDate);
      return { rows, total: rows.length };
    }
    if (query.customerId) {
      const rows = await db.select().from(jobsTable).where(and(
        eq(jobsTable.customerId, Number(query.customerId)), assigned,
      )).orderBy(desc(jobsTable.scheduledDate));
      return { rows, total: rows.length };
    }
    if (query.date) {
      const rows = await db.select().from(jobsTable).where(and(
        eq(jobsTable.scheduledDate, String(query.date)), assigned,
      )).orderBy(jobsTable.scheduledStartTime);
      return { rows, total: rows.length };
    }
    const conditions: any[] = [assigned];
    if (query.status) conditions.push(eq(jobsTable.status, String(query.status)));
    if (query.crewId) conditions.push(eq(jobsTable.crewId, Number(query.crewId)));
    const pageSize = Math.min(300, Math.max(1, Number.parseInt(String(query.limit ?? "200"), 10)));
    const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10));
    const where = and(...conditions);
    const [rows, count] = await Promise.all([
      db.select().from(jobsTable).where(where).orderBy(desc(jobsTable.scheduledDate))
        .limit(pageSize).offset((page - 1) * pageSize),
      db.select({ count: sql<number>`count(*)` }).from(jobsTable).where(where),
    ]);
    return { rows, total: Number(count[0]?.count ?? 0) };
  },
  listUnscheduled: (userId) => db.select().from(jobsTable).where(and(
    isNull(jobsTable.scheduledDate), inArray(jobsTable.status, ["unscheduled", "scheduled"]),
    assignedJobCondition(userId),
  )).orderBy(jobsTable.createdAt),
  find: async (id) => (await db.select().from(jobsTable).where(eq(jobsTable.id, id)))[0] ?? null,
  findAssigned: async (id, userId) => (await db.select().from(jobsTable).where(and(
    eq(jobsTable.id, id), assignedJobCondition(userId),
  )))[0] ?? null,
};

export default createJobsRouter();
