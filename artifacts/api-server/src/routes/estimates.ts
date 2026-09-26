import { acceptedSnapshotFor, EstimateAcceptanceError } from "../lib/estimate-acceptance.ts";
import { officeAcceptedNotice, officeEmailAddress } from "../lib/estimate-accepted-notice.ts";
import { sendEmailTo } from "../lib/email.ts";
import { summariseEstimates } from "../lib/estimate-dashboard.ts";
import { deriveQuoteStatuses } from "../lib/estimate-status-batch.ts";
import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  db, customersTable, propertiesTable, quotesTable, quoteLineItemsTable, jobsTable, usersTable,
  leadsTable, crewsTable, activityLogsTable,
  estimateActivitiesTable, estimateAppointmentsTable, estimateDeliveryRequestsTable,
  estimateLineMetadataTable, estimateLocationsTable, estimatePublicLinksTable, estimateRevisionsTable,
} from "@workspace/db";
import { enqueueCommunicationEvent } from "../lib/communication-outbox.ts";
import {
  buildLocationJobPlans, EstimateConversionValidationError, isAcceptedEstimate, persistAcceptedEstimateJobsCore,
  type AcceptedEstimateSnapshot, type LocationScheduleInput,
} from "../lib/estimate-conversion.ts";
import {
  ActiveAssignmentReferenceError,
  validateAndLockActiveAssignmentReferences,
} from "../lib/active-assignment-references.ts";
import {
  claimIdempotencyKey, completeIdempotencyKey, getIdempotencyContext,
  idempotencyConflictMessage, idempotencyInProgressMessage, markIdempotencyReplay, releaseIdempotencyKey,
} from "../lib/idempotency.ts";
import {
  assertActiveEstimateRevision, assertDecisionTransition, deriveEstimateStatus, isTerminalEstimateStatus,
} from "../lib/estimate-lifecycle.ts";
import {
  isValidPublicEstimateToken,
  publicEstimateIpLimiter,
  publicEstimateLimitKey,
  publicEstimateTokenLimiter,
} from "../lib/public-estimate-guard.ts";
import { businessDateStr } from "../lib/date.ts";
import { normalizeAuthorizationRole } from "../lib/role-normalization.ts";

const router: IRouter = Router();
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const numericId = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const actorId = (req: { user?: { id: string } }) => req.user?.id ?? null;

async function quoteSnapshot(tx: any, quoteId: number) {
  const [quote] = await tx.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1);
  if (!quote) return null;
  const lines = await tx.select().from(quoteLineItemsTable)
    .where(eq(quoteLineItemsTable.quoteId, quoteId)).orderBy(asc(quoteLineItemsTable.sortOrder));
  const locations = await tx.select().from(estimateLocationsTable)
    .where(eq(estimateLocationsTable.quoteId, quoteId));
  const propertyIds = locations.length ? locations.map((x: any) => x.propertyId) : quote.propertyId ? [quote.propertyId] : [];
  const properties = propertyIds.length
    ? await tx.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
    : [];
  const metadata = lines.length
    ? await tx.select().from(estimateLineMetadataTable).where(inArray(estimateLineMetadataTable.lineItemId, lines.map((x: any) => x.id)))
    : [];
  const metadataByLine = new Map<number, any>(metadata.map((x: any) => [x.lineItemId, x]));
  return {
    quote: {
      id: quote.id, quoteNumber: quote.quoteNumber, customerId: quote.customerId,
      leadId: quote.leadId, subtotal: Number(quote.subtotal), taxTotal: Number(quote.taxTotal),
      discountTotal: Number(quote.discountTotal), totalAmount: Number(quote.totalAmount),
      notes: quote.notes, terms: quote.terms, validUntil: quote.validUntil,
    },
    lineItems: lines.map((line: any) => ({
      id: line.id, serviceId: line.serviceId, description: line.description,
      quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), totalPrice: Number(line.totalPrice),
      propertyId: metadataByLine.get(line.id)?.propertyId ?? null,
      isUpsell: metadataByLine.get(line.id)?.isUpsell ?? false,
      serviceNotes: metadataByLine.get(line.id)?.serviceNotes ?? null,
    })),
    locations: properties.map((p: any) => ({
      id: p.id, name: p.name, address: p.address, city: p.city, state: p.state, zip: p.zip,
      notes: locations.find((x: any) => x.propertyId === p.id)?.locationNotes ?? null,
    })),
  };
}

async function lifecycleForQuote(quoteId: number, legacyStatus?: string | null) {
  const [appointment, revision, link, job] = await Promise.all([
    db.select().from(estimateAppointmentsTable).where(eq(estimateAppointmentsTable.quoteId, quoteId)).limit(1),
    db.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.quoteId, quoteId))
      .orderBy(desc(estimateRevisionsTable.revisionNumber)).limit(1),
    db.select().from(estimatePublicLinksTable).where(eq(estimatePublicLinksTable.quoteId, quoteId))
      .orderBy(desc(estimatePublicLinksTable.sentAt)).limit(1),
    db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.quoteId, quoteId)).limit(1),
  ]);
  const effectiveLink = link[0] && revision[0] && link[0].revisionId === revision[0].id ? link[0] : null;
  const status = deriveEstimateStatus({
    legacyStatus, hasAppointment: !!appointment[0], hasFinalizedRevision: !!revision[0],
    sentAt: effectiveLink?.sentAt, firstOpenedAt: effectiveLink?.firstOpenedAt,
    decision: effectiveLink?.decision, hasLinkedJob: !!job[0],
    expiresAt: effectiveLink?.expiresAt,
  });
  return { status, appointment: appointment[0] ?? null, revision: revision[0] ?? null, publicLink: effectiveLink };
}

export type EstimateAppointmentQuote = {
  id: number;
  customerId: number | null;
  status: string | null;
};

export type EstimateAppointmentInput = {
  quote: EstimateAppointmentQuote;
  startsAt: Date;
  durationMinutes: number;
  assignedUserId: string;
  appointmentNotes: string | null;
  estimateNotes: string | null;
  propertyIds: number[];
  actorId: string | null;
};

export interface EstimateAppointmentRepository {
  findQuote(quoteId: number): Promise<EstimateAppointmentQuote | null>;
  findActiveOwnedPropertyIds(customerId: number, propertyIds: number[]): Promise<number[]>;
  findActiveTechnician(userId: string): Promise<{ id: string; role: string } | null>;
  saveAppointment(input: EstimateAppointmentInput): Promise<any>;
  getLifecycle(quoteId: number, legacyStatus?: string | null): Promise<{
    status: string;
    appointment: any;
    revision: any;
    publicLink: any;
    locations: any[];
    deliveries: any[];
    activities: any[];
  }>;
}

export type EstimateEmployee = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isActive: boolean;
};

export interface EstimateEmployeeRepository {
  listActive(): Promise<EstimateEmployee[]>;
}

const estimateEmployeeRepository: EstimateEmployeeRepository = {
  async listActive() {
    return db.select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      isActive: usersTable.isActive,
    }).from(usersTable)
      .where(eq(usersTable.isActive, true))
      .orderBy(asc(usersTable.firstName), asc(usersTable.lastName));
  },
};

export function createEstimateEmployeesRouter(
  repository: EstimateEmployeeRepository = estimateEmployeeRepository,
): IRouter {
  const employeeRouter: IRouter = Router();
  employeeRouter.get("/estimate-employees", async (_req, res): Promise<any> => {
    const users = await repository.listActive();
    res.json(users.map((user) => ({
      ...user,
      displayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.role,
    })));
  });
  return employeeRouter;
}

const estimateAppointmentRepository: EstimateAppointmentRepository = {
  async findQuote(quoteId) {
    const [quote] = await db.select({
      id: quotesTable.id, customerId: quotesTable.customerId, status: quotesTable.status,
    }).from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1);
    return quote ?? null;
  },
  async findActiveOwnedPropertyIds(customerId, propertyIds) {
    return (await db.select({ id: propertiesTable.id }).from(propertiesTable)
      .where(and(
        inArray(propertiesTable.id, propertyIds),
        eq(propertiesTable.customerId, customerId),
        isNull(propertiesTable.archivedAt),
      ))).map((property) => property.id);
  },
  async findActiveTechnician(userId) {
    const [user] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.isActive, true))).limit(1);
    return user ?? null;
  },
  async saveAppointment(input) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${input.quote.id})`);
      const [lockedQuote] = await tx.select({ status: quotesTable.status }).from(quotesTable)
        .where(eq(quotesTable.id, input.quote.id)).limit(1);
      if (isTerminalEstimateStatus(lockedQuote?.status)) {
        throw Object.assign(new Error("Accepted estimate terms are locked; create a revision first"), { statusCode: 409 });
      }
      const [upserted] = await tx.insert(estimateAppointmentsTable).values({
        quoteId: input.quote.id,
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        assignedUserId: input.assignedUserId,
        appointmentNotes: input.appointmentNotes,
        estimateNotes: input.estimateNotes,
        createdBy: input.actorId,
      }).onConflictDoUpdate({
        target: estimateAppointmentsTable.quoteId,
        set: {
          startsAt: input.startsAt,
          durationMinutes: input.durationMinutes,
          assignedUserId: input.assignedUserId,
          appointmentNotes: input.appointmentNotes,
          estimateNotes: input.estimateNotes,
          updatedAt: new Date(),
        },
      }).returning();
      await tx.delete(estimateLocationsTable).where(eq(estimateLocationsTable.quoteId, input.quote.id));
      await tx.insert(estimateLocationsTable).values(input.propertyIds.map((propertyId) => ({
        quoteId: input.quote.id, propertyId,
      })));
      await tx.insert(estimateActivitiesTable).values({
        quoteId: input.quote.id,
        activityType: "appointment_scheduled",
        actorId: input.actorId,
        detail: {
          startsAt: input.startsAt.toISOString(),
          durationMinutes: input.durationMinutes,
          assignedUserId: input.assignedUserId,
          propertyIds: input.propertyIds,
        },
      });
      await enqueueCommunicationEvent(tx, {
        eventType: "appointment.scheduled",
        aggregateType: "quote",
        aggregateId: input.quote.id,
        payload: {
          quoteId: input.quote.id,
          customerId: input.quote.customerId,
          scheduledDate: input.startsAt.toISOString(),
        },
        source: "estimate_lifecycle",
        actorId: input.actorId,
        dedupeKey: `estimate-appointment:${input.quote.id}:${input.startsAt.toISOString()}`,
      });
      return upserted;
    });
  },
  async getLifecycle(quoteId, legacyStatus) {
    const lifecycle = await lifecycleForQuote(quoteId, legacyStatus);
    const [locations, deliveries, activities] = await Promise.all([
      db.select().from(estimateLocationsTable).where(eq(estimateLocationsTable.quoteId, quoteId)),
      db.select().from(estimateDeliveryRequestsTable).where(eq(estimateDeliveryRequestsTable.quoteId, quoteId))
        .orderBy(desc(estimateDeliveryRequestsTable.requestedAt)),
      db.select().from(estimateActivitiesTable).where(eq(estimateActivitiesTable.quoteId, quoteId))
        .orderBy(desc(estimateActivitiesTable.occurredAt)).limit(100),
    ]);
    return { ...lifecycle, locations, deliveries, activities };
  },
};

export function createEstimateAppointmentRouter(
  repository: EstimateAppointmentRepository = estimateAppointmentRepository,
): IRouter {
  const appointmentRouter = Router();

  appointmentRouter.get("/quotes/:id/estimate-lifecycle", async (req, res): Promise<any> => {
    const quoteId = numericId(req.params.id);
    if (!quoteId) return res.status(400).json({ error: "Invalid quote id" });
    const quote = await repository.findQuote(quoteId);
    if (!quote) return res.status(404).json({ error: "Estimate not found" });
    const lifecycle = await repository.getLifecycle(quoteId, quote.status);
    const propertyIds = lifecycle.locations.map((location: any) => location.propertyId);
    res.json({
      ...lifecycle,
      appointment: lifecycle.appointment
        ? { ...lifecycle.appointment, propertyIds }
        : null,
      locked: lifecycle.status === "accepted" || lifecycle.status === "accepted_scheduled",
    });
  });

  appointmentRouter.post("/quotes/:id/appointment", async (req, res): Promise<any> => {
    const quoteId = numericId(req.params.id);
    const startsAtInput = req.body.startsAt;
    const startsAt = new Date(startsAtInput);
    const durationMinutes = Number(req.body.durationMinutes ?? 60);
    if (
      !quoteId
      || typeof startsAtInput !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(startsAtInput)
      || Number.isNaN(startsAt.valueOf())
      || !Number.isInteger(durationMinutes)
      || durationMinutes < 15
      || durationMinutes > 1440
    ) {
      return res.status(400).json({ error: "A valid start time and 15–1440 minute duration are required" });
    }
    const propertyIds = [...new Set(
      (Array.isArray(req.body.propertyIds) ? req.body.propertyIds : []).map(numericId).filter(Boolean),
    )] as number[];
    if (!propertyIds.length) {
      return res.status(400).json({ error: "At least one active account-owned location is required" });
    }
    const assignedUserId = typeof req.body.assignedUserId === "string" && req.body.assignedUserId.trim()
      ? req.body.assignedUserId.trim()
      : null;
    if (!assignedUserId) {
      return res.status(400).json({ error: "An active Field Tech technician is required" });
    }
    const quote = await repository.findQuote(quoteId);
    if (!quote) return res.status(404).json({ error: "Estimate not found" });
    if (!quote.customerId) return res.status(400).json({ error: "Estimate locations require a customer account" });
    const validPropertyIds = await repository.findActiveOwnedPropertyIds(quote.customerId, propertyIds);
    if (validPropertyIds.length !== propertyIds.length) {
      return res.status(400).json({ error: "Every location must belong to this account and be active" });
    }
    const technician = await repository.findActiveTechnician(assignedUserId);
    if (!technician || normalizeAuthorizationRole(technician.role) !== "field_tech") {
      return res.status(400).json({ error: "Assigned technician must be an active Field Tech user" });
    }
    const appointmentNotes = typeof req.body.appointmentNotes === "string" && req.body.appointmentNotes
      ? req.body.appointmentNotes
      : null;
    const estimateNotes = typeof req.body.estimateNotes === "string" && req.body.estimateNotes
      ? req.body.estimateNotes
      : null;
    const appointment = await repository.saveAppointment({
      quote,
      startsAt,
      durationMinutes,
      assignedUserId,
      appointmentNotes,
      estimateNotes,
      propertyIds,
      actorId: actorId(req),
    });
    res.status(201).json({
      ...appointment,
      startsAt: appointment.startsAt.toISOString(),
      propertyIds,
    });
  });

  return appointmentRouter;
}

async function conversionSource(tx: any, quoteId: number) {
  const [quote] = await tx.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1);
  if (!quote) return { kind: "notFound" as const };
  const [revision] = await tx.select().from(estimateRevisionsTable)
    .where(eq(estimateRevisionsTable.quoteId, quoteId))
    .orderBy(desc(estimateRevisionsTable.revisionNumber)).limit(1);
  if (!revision) return { kind: "notFinalized" as const, quote };
  const [acceptedLink] = await tx.select().from(estimatePublicLinksTable)
    .where(and(
      eq(estimatePublicLinksTable.quoteId, quoteId),
      eq(estimatePublicLinksTable.revisionId, revision.id),
      eq(estimatePublicLinksTable.decision, "accepted"),
    )).orderBy(desc(estimatePublicLinksTable.decisionAt)).limit(1);
  return { kind: "ready" as const, quote, revision, acceptedLink: acceptedLink ?? null };
}

function conversionJobResponse(job: typeof jobsTable.$inferSelect) {
  return {
    ...job, totalAmount: Number(job.totalAmount),
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
  };
}

router.get("/quotes/:id/conversion-preview", async (req, res): Promise<any> => {
  const quoteId = numericId(req.params.id);
  if (!quoteId) return res.status(400).json({ error: "Invalid quote id" });
  const source = await conversionSource(db, quoteId);
  if (source.kind === "notFound") return res.status(404).json({ error: "Estimate not found" });
  if (source.kind === "notFinalized") return res.status(409).json({ error: "Finalize the estimate before scheduling work" });
  // The office schedules what the customer accepted. Falling back to the
  // revision covers a verbal acceptance, where there is no customer decision.
  const offered = source.revision.snapshot as AcceptedEstimateSnapshot;
  const snapshot = (source.acceptedLink?.acceptedSnapshot ?? offered) as AcceptedEstimateSnapshot;
  const existingJobs = await db.select().from(jobsTable).where(eq(jobsTable.quoteId, quoteId)).orderBy(asc(jobsTable.id));
  const accepted = isAcceptedEstimate(source.quote.status, !!source.acceptedLink);
  res.json({
    quoteId,
    quoteNumber: source.quote.quoteNumber,
    revisionId: source.revision.id,
    revisionNumber: source.revision.revisionNumber,
    accepted,
    acceptanceMethod: source.acceptedLink ? "customer" : null,
    requiresVerbalAcceptance: !accepted,
    account: {
      customerId: source.quote.customerId,
      leadId: source.quote.leadId,
      lifecycleStatus: null,
    },
    snapshot,
    // What the customer left behind, so the office can see the choice was partial
    // rather than wonder where a service went.
    declinedLineItems: offered.lineItems.filter(
      (line) => !snapshot.lineItems.some((accepted) => accepted.id === line.id),
    ),
    offeredTotal: offered.lineItems.reduce((sum, line) => sum + Number(line.totalPrice), 0),
    existingJobs: existingJobs.map(conversionJobResponse),
  });
});

router.post("/quotes/:id/convert-and-schedule", async (req, res): Promise<any> => {
  const quoteId = numericId(req.params.id);
  if (!quoteId) return res.status(400).json({ error: "Invalid quote id" });
  const schedules = Array.isArray(req.body.schedules) ? req.body.schedules as LocationScheduleInput[] : [];
  const verbalAcceptance = req.body.verbalAcceptance === true;
  const verbalAcceptanceNote = typeof req.body.verbalAcceptanceNote === "string" ? req.body.verbalAcceptanceNote.trim() : "";
  if (verbalAcceptance && verbalAcceptanceNote.length < 10) {
    return res.status(400).json({ error: "Document the verbal acceptance in at least 10 characters" });
  }
  const idempotency = getIdempotencyContext(req, "estimates.convert_and_schedule", {
    quoteId, schedules, verbalAcceptance, verbalAcceptanceNote,
  });
  if (!idempotency) return res.status(400).json({ error: "Idempotency-Key is required" });

  try {
    const result = await db.transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, idempotency);
      if (claim.kind !== "claimed") return claim;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteId})`);

      const existingJobs = await tx.select().from(jobsTable)
        .where(eq(jobsTable.quoteId, quoteId)).orderBy(asc(jobsTable.id));
      if (existingJobs.length) {
        await completeIdempotencyKey(tx, claim.record.id, {
          resourceType: "estimate_conversion", resourceId: existingJobs[0].id, responseStatus: 200,
        });
        return { kind: "existing" as const, jobs: existingJobs };
      }

      const source = await conversionSource(tx, quoteId);
      if (source.kind !== "ready") {
        await releaseIdempotencyKey(tx, claim.record.id);
        return { kind: source.kind } as const;
      }
      const accepted = isAcceptedEstimate(source.quote.status, !!source.acceptedLink);
      if (!accepted && !verbalAcceptance) {
        await releaseIdempotencyKey(tx, claim.record.id);
        return { kind: "acceptanceRequired" as const };
      }
      if (accepted && verbalAcceptance) {
        await releaseIdempotencyKey(tx, claim.record.id);
        return { kind: "alreadyAccepted" as const };
      }

      const snapshot = (source.acceptedLink?.acceptedSnapshot ?? source.revision.snapshot) as AcceptedEstimateSnapshot;
      const plans = buildLocationJobPlans(snapshot, schedules);

      let customerId = source.quote.customerId;
      if (!customerId && source.quote.leadId) {
        const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id, source.quote.leadId)).limit(1);
        customerId = lead?.convertedCustomerId ?? null;
      }
      if (!customerId) {
        await releaseIdempotencyKey(tx, claim.record.id);
        return { kind: "accountRequired" as const };
      }
      await tx.execute(sql`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`);
      const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
      if (!customer) {
        await releaseIdempotencyKey(tx, claim.record.id);
        return { kind: "accountRequired" as const };
      }
      const plannedPropertyIds = plans.map((plan) => plan.propertyId);
      const activeProperties = await tx.select({ id: propertiesTable.id }).from(propertiesTable)
        .where(and(
          inArray(propertiesTable.id, plannedPropertyIds),
          eq(propertiesTable.customerId, customerId),
          isNull(propertiesTable.archivedAt),
        ));
      if (activeProperties.length !== plannedPropertyIds.length) {
        throw new EstimateConversionValidationError("Every scheduled location must still be active and belong to this account");
      }

       await validateAndLockActiveAssignmentReferences({
         crewIds: plans.map((plan) => plan.crewId),
         directUserIds: plans.flatMap((plan) => plan.assignedUserIds ?? []),
       }, {
         lockActiveCrews: async (ids) => (await tx.select({ id: crewsTable.id }).from(crewsTable)
           .where(and(inArray(crewsTable.id, [...ids]), eq(crewsTable.isActive, true)))
           .for("update")).map((row) => row.id),
         lockActiveFieldTechUsers: async (ids) => (await tx.select({ id: usersTable.id }).from(usersTable)
           .where(and(
             inArray(usersTable.id, [...ids]),
             eq(usersTable.isActive, true),
             eq(usersTable.role, "field_tech"),
           ))
           .for("update")).map((row) => row.id),
       });

      const actor = actorId(req);
      const now = new Date();
      if (customer.lifecycleStatus === "prospect" || customer.status === "prospect") {
        await tx.update(customersTable).set({
          lifecycleStatus: "customer", status: "active",
          customerDate: customer.customerDate ?? businessDateStr(now),
        }).where(eq(customersTable.id, customerId));
      }
      if (source.quote.leadId) {
        await tx.update(leadsTable).set({ status: "won", convertedCustomerId: customerId })
          .where(eq(leadsTable.id, source.quote.leadId));
      }
      if (verbalAcceptance) {
        await tx.update(quotesTable).set({ status: "accepted" }).where(eq(quotesTable.id, quoteId));
        await tx.insert(estimateActivitiesTable).values({
          quoteId, activityType: "verbal_acceptance_recorded", actorType: "staff", actorId: actor,
          detail: { note: verbalAcceptanceNote, revisionId: source.revision.id },
        });
      }

      const persisted = await persistAcceptedEstimateJobsCore({
        quoteId, customerId, revisionId: source.revision.id,
        quoteNumber: source.quote.quoteNumber, snapshot, plans,
      }, {
        findJobsByQuoteId: async (id) => tx.select().from(jobsTable)
          .where(eq(jobsTable.quoteId, id)).orderBy(asc(jobsTable.id)),
        validateAndLockActiveAssignments: async (jobPlans) => {
          await validateAndLockActiveAssignmentReferences({
            crewIds: jobPlans.map((plan) => plan.crewId),
            directUserIds: jobPlans.flatMap((plan) => plan.assignedUserIds ?? []),
          }, {
            lockActiveCrews: async (ids) => (await tx.select({ id: crewsTable.id }).from(crewsTable)
              .where(and(inArray(crewsTable.id, [...ids]), eq(crewsTable.isActive, true)))
              .for("update")).map((row) => row.id),
            lockActiveFieldTechUsers: async (ids) => (await tx.select({ id: usersTable.id }).from(usersTable)
              .where(and(
                inArray(usersTable.id, [...ids]),
                eq(usersTable.isActive, true),
                eq(usersTable.role, "field_tech"),
              ))
              .for("update")).map((row) => row.id),
          });
        },
        insertJob: async (values) => {
          const [job] = await tx.insert(jobsTable).values(values as any).returning();
          return job;
        },
        recordScheduledEvent: async (job, plan) => {
          await enqueueCommunicationEvent(tx, {
            eventType: "appointment.scheduled", aggregateType: "job", aggregateId: job.id,
            payload: { jobId: job.id, customerId, quoteId, propertyId: plan.propertyId, scheduledDate: plan.scheduledDate },
            source: "estimate_conversion", actorId: actor, dedupeKey: `estimate-conversion-job:${job.id}`,
          });
        },
      });
      const createdJobs = persisted.jobs;

      await tx.insert(estimateActivitiesTable).values({
        quoteId, activityType: "estimate_converted_and_scheduled", actorType: "staff", actorId: actor,
        detail: {
          customerId, revisionId: source.revision.id, jobIds: createdJobs.map((job) => job.id),
          acceptanceMethod: verbalAcceptance ? "verbal" : "customer",
          verbalAcceptanceNote: verbalAcceptance ? verbalAcceptanceNote : null,
        },
      });
      await tx.insert(activityLogsTable).values({
        entityType: "customer", entityId: customerId, action: "estimate_converted_and_scheduled",
        toValue: createdJobs.map((job) => job.id).join(","), reason: verbalAcceptance ? "verbal_acceptance" : "customer_acceptance",
        performedBy: actor,
      });
      await completeIdempotencyKey(tx, claim.record.id, {
        resourceType: "estimate_conversion", resourceId: createdJobs[0].id, responseStatus: 201,
      });
      return { kind: "created" as const, jobs: createdJobs, customerId };
    });

    if (result.kind === "conflict") return res.status(409).json({ error: idempotencyConflictMessage() });
    if (result.kind === "inProgress") return res.status(409).setHeader("Retry-After", "1").json({ error: idempotencyInProgressMessage() });
    if (result.kind === "replay") {
      const jobs = await db.select().from(jobsTable).where(eq(jobsTable.quoteId, quoteId)).orderBy(asc(jobsTable.id));
      markIdempotencyReplay(res);
      return res.json({ quoteId, jobs: jobs.map(conversionJobResponse), replayed: true });
    }
    if (result.kind === "notFound") return res.status(404).json({ error: "Estimate not found" });
    if (result.kind === "notFinalized") return res.status(409).json({ error: "Finalize the estimate before scheduling work" });
    if (result.kind === "acceptanceRequired") return res.status(409).json({ error: "Customer acceptance or a documented verbal acceptance is required" });
    if (result.kind === "alreadyAccepted") return res.status(400).json({ error: "Do not use a verbal override for an estimate already accepted by the customer" });
    if (result.kind === "accountRequired") return res.status(409).json({ error: "The estimate is not linked to a canonical customer account" });
    if (result.kind !== "created" && result.kind !== "existing") {
      return res.status(500).json({ error: "Unexpected conversion result" });
    }
    return res.status(result.kind === "created" ? 201 : 200).json({
      quoteId, customerId: "customerId" in result ? result.customerId : undefined,
      jobs: result.jobs.map(conversionJobResponse), replayed: result.kind === "existing",
    });
  } catch (error) {
    if (error instanceof EstimateConversionValidationError || error instanceof ActiveAssignmentReferenceError) {
      return res.status(400).json({ error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: "Failed to convert and schedule estimate; no changes were committed" });
  }
});

router.use(createEstimateAppointmentRouter());
router.use(createEstimateEmployeesRouter());

router.post("/quotes/:id/finalize", async (req, res): Promise<any> => {
  const quoteId = numericId(req.params.id);
  if (!quoteId) return res.status(400).json({ error: "Invalid quote id" });
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1);
  if (!quote) return res.status(404).json({ error: "Estimate not found" });
  const lifecycle = await lifecycleForQuote(quoteId, quote.status);
  if (isTerminalEstimateStatus(quote.status) || lifecycle.status === "accepted" || lifecycle.status === "accepted_scheduled") {
    return res.status(409).json({ error: "Accepted estimate terms are locked; create a revision instead", code: "estimate_locked" });
  }
  const lines = Array.isArray(req.body.lineItems) ? req.body.lineItems : null;
  if (!lines?.length) return res.status(400).json({ error: "At least one service is required" });
  const linePropertyIds = [...new Set(lines.map((line: any) => numericId(line.propertyId)).filter(Boolean))] as number[];
  if (linePropertyIds.length) {
    if (!quote.customerId) return res.status(400).json({ error: "Estimate locations require a customer account" });
    const valid = await db.select({ id: propertiesTable.id }).from(propertiesTable)
      .where(and(inArray(propertiesTable.id, linePropertyIds), eq(propertiesTable.customerId, quote.customerId)));
    if (valid.length !== linePropertyIds.length) return res.status(400).json({ error: "Every line-item location must belong to this account" });
  }
  const revision = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteId})`);
    const [lockedQuote] = await tx.select({ status: quotesTable.status }).from(quotesTable)
      .where(eq(quotesTable.id, quoteId)).limit(1);
    if (isTerminalEstimateStatus(lockedQuote?.status)) {
      throw Object.assign(new Error("Accepted estimate terms are locked; create a revision instead"), { status: 409 });
    }
    await tx.delete(quoteLineItemsTable).where(eq(quoteLineItemsTable.quoteId, quoteId));
    const inserted = await tx.insert(quoteLineItemsTable).values(lines.map((line: any, sortOrder: number) => {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      if (!(quantity > 0) || unitPrice < 0) throw Object.assign(new Error("Invalid quantity or price"), { status: 400 });
      return { quoteId, serviceId: numericId(line.serviceId), description: String(line.description ?? "").trim(), quantity: String(quantity), unitPrice: String(unitPrice), totalPrice: String(quantity * unitPrice), sortOrder };
    })).returning();
    const subtotal = inserted.reduce((sum, item) => sum + Number(item.totalPrice), 0);
    await tx.update(quotesTable).set({
      notes: req.body.notes ?? quote.notes, terms: req.body.terms ?? quote.terms,
      subtotal: String(subtotal), totalAmount: String(subtotal), status: "draft",
    }).where(eq(quotesTable.id, quoteId));
    const metas = inserted.map((item, i) => ({
      lineItemId: item.id, propertyId: numericId(lines[i].propertyId),
      isUpsell: !!lines[i].isUpsell, serviceNotes: lines[i].serviceNotes || null,
    }));
    if (metas.length) await tx.insert(estimateLineMetadataTable).values(metas);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${estimateRevisionsTable.revisionNumber}),0)+1` })
      .from(estimateRevisionsTable).where(eq(estimateRevisionsTable.quoteId, quoteId));
    const snapshot = await quoteSnapshot(tx, quoteId);
    const [created] = await tx.insert(estimateRevisionsTable).values({
      quoteId, revisionNumber: Number(next), snapshot: snapshot!, finalizedBy: actorId(req),
    }).returning();
    await tx.insert(estimateActivitiesTable).values({
      quoteId, activityType: "estimate_finalized", actorId: actorId(req),
      detail: { revisionNumber: Number(next), totalAmount: subtotal },
    });
    return created;
  });
  res.status(201).json(revision);
});

router.post("/quotes/:id/revisions", async (req, res): Promise<any> => {
  const quoteId = numericId(req.params.id);
  if (!quoteId) return res.status(400).json({ error: "Invalid quote id" });
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteId})`);
    const [latest] = await tx.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.quoteId, quoteId))
      .orderBy(desc(estimateRevisionsTable.revisionNumber)).limit(1);
    if (!latest) return null;
    const [revision] = await tx.insert(estimateRevisionsTable).values({
      quoteId, revisionNumber: latest.revisionNumber + 1, snapshot: latest.snapshot, finalizedBy: actorId(req),
    }).returning();
    await tx.update(quotesTable).set({ status: "draft" }).where(eq(quotesTable.id, quoteId));
    await tx.insert(estimateActivitiesTable).values({
      quoteId, activityType: "revision_created", actorId: actorId(req), detail: { revisionNumber: revision.revisionNumber },
    });
    return revision;
  });
  if (!created) return res.status(400).json({ error: "Finalize the estimate before creating a revision" });
  res.status(201).json(created);
});

router.post("/quotes/:id/deliver", async (req, res): Promise<any> => {
  const quoteId = numericId(req.params.id);
  const channels = [...new Set(req.body.channels ?? [])].filter((x) => x === "email" || x === "sms") as Array<"email" | "sms">;
  if (!quoteId || !channels.length) return res.status(400).json({ error: "Choose email, SMS, or both" });
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1);
  const [revision] = await db.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.quoteId, quoteId))
    .orderBy(desc(estimateRevisionsTable.revisionNumber)).limit(1);
  if (!quote || !revision) return res.status(400).json({ error: "Finalize the estimate before sending" });
  const [customer] = quote.customerId
    ? await db.select().from(customersTable).where(eq(customersTable.id, quote.customerId)).limit(1) : [];
  const recipients: Record<string, string | null | undefined> = { email: req.body.email || customer?.email, sms: req.body.phone || customer?.phone };
  const missing = channels.find((channel) => !recipients[channel]);
  if (missing) return res.status(400).json({ error: `A ${missing} recipient is required` });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + Math.min(60, Math.max(1, Number(req.body.expiresInDays ?? 30))) * 86_400_000);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${quoteId})`);
    const [lockedQuote] = await tx.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1);
    if (!lockedQuote) throw Object.assign(new Error("Estimate not found"), { statusCode: 404 });
    if (isTerminalEstimateStatus(lockedQuote.status)) {
      throw Object.assign(new Error("Accepted estimate terms are locked; create a revision before delivering again"), { statusCode: 409 });
    }
    const [lockedRevision] = await tx.select().from(estimateRevisionsTable)
      .where(eq(estimateRevisionsTable.quoteId, quoteId))
      .orderBy(desc(estimateRevisionsTable.revisionNumber)).limit(1);
    if (!lockedRevision) throw Object.assign(new Error("Finalize the estimate before sending"), { statusCode: 400 });
    const [link] = await tx.insert(estimatePublicLinksTable).values({
      quoteId, revisionId: lockedRevision.id, tokenHash: tokenHash(token), expiresAt, sendMethods: channels.join(","),
    }).returning();
    const deliveries = await tx.insert(estimateDeliveryRequestsTable).values(channels.map((channel) => ({
      quoteId, publicLinkId: link.id, channel, recipient: recipients[channel]!,
      status: "provider_unconfigured", lastError: "No live delivery provider is configured in this Sandbox", requestedBy: actorId(req),
    }))).returning();
    await tx.update(quotesTable).set({ status: "sent" }).where(eq(quotesTable.id, quoteId));
    await tx.insert(estimateActivitiesTable).values({
      quoteId, publicLinkId: link.id, activityType: "estimate_sent", actorId: actorId(req),
      detail: { channels, expiresAt: expiresAt.toISOString() },
    });
    await enqueueCommunicationEvent(tx, {
      eventType: "quote.sent", aggregateType: "quote", aggregateId: quoteId,
      payload: {
        quoteId, customerId: lockedQuote.customerId, status: "sent",
        estimatePath: `/estimate/${token}`,
        deliveryRequests: channels.map((channel) => ({ channel, recipient: recipients[channel] })),
      },
      source: "estimate_lifecycle", actorId: actorId(req), dedupeKey: `estimate-delivery:${link.id}`,
    });
    return { link, deliveries };
  });
  // This is intentionally the only response containing the raw token.
  res.status(201).json({ ...result, token, path: `/estimate/${token}` });
});

router.get("/estimate-calendar", async (req, res): Promise<any> => {
  const from = new Date(String(req.query.from ?? new Date(0).toISOString()));
  const to = new Date(String(req.query.to ?? new Date("9999-12-31").toISOString()));
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return res.status(400).json({ error: "Invalid date range" });
  const conditions = [gte(estimateAppointmentsTable.startsAt, from), lte(estimateAppointmentsTable.startsAt, to)];
  if (req.query.employeeId) conditions.push(eq(estimateAppointmentsTable.assignedUserId, String(req.query.employeeId)));
  const rows = await db.select({
    id: estimateAppointmentsTable.id, quoteId: estimateAppointmentsTable.quoteId,
    startsAt: estimateAppointmentsTable.startsAt, durationMinutes: estimateAppointmentsTable.durationMinutes,
    assignedUserId: estimateAppointmentsTable.assignedUserId, appointmentNotes: estimateAppointmentsTable.appointmentNotes,
    quoteNumber: quotesTable.quoteNumber, legacyStatus: quotesTable.status, customerId: quotesTable.customerId,
    customerFirstName: customersTable.firstName, customerLastName: customersTable.lastName,
    employeeFirstName: usersTable.firstName, employeeLastName: usersTable.lastName,
  }).from(estimateAppointmentsTable)
    .innerJoin(quotesTable, eq(quotesTable.id, estimateAppointmentsTable.quoteId))
    .leftJoin(customersTable, eq(customersTable.id, quotesTable.customerId))
    .leftJoin(usersTable, eq(usersTable.id, estimateAppointmentsTable.assignedUserId))
    .where(and(...conditions)).orderBy(asc(estimateAppointmentsTable.startsAt));
  res.json(rows.map((row) => ({
    ...row, startsAt: row.startsAt.toISOString(),
    customerName: [row.customerFirstName, row.customerLastName].filter(Boolean).join(" ") || `Customer #${row.customerId}`,
    employeeName: [row.employeeFirstName, row.employeeLastName].filter(Boolean).join(" ") || null,
  })));
});

router.get("/estimates/follow-up", async (_req, res): Promise<any> => {
  const rows = await db.select({
    quoteId: quotesTable.id, quoteNumber: quotesTable.quoteNumber, customerId: quotesTable.customerId,
    totalAmount: quotesTable.totalAmount, decision: estimatePublicLinksTable.decision,
    decisionAt: estimatePublicLinksTable.decisionAt, declineReason: estimatePublicLinksTable.declineReason,
    followUpRequested: estimatePublicLinksTable.followUpRequested,
  }).from(estimatePublicLinksTable)
    .innerJoin(quotesTable, eq(quotesTable.id, estimatePublicLinksTable.quoteId))
    .where(sql`${estimatePublicLinksTable.decision} IS NOT NULL`)
    .orderBy(desc(estimatePublicLinksTable.decisionAt));
  res.json(rows.map((row) => ({ ...row, totalAmount: Number(row.totalAmount) })));
});

/**
 * The Estimate Status module (Kyle 2026-09-24 #2): every estimate in its
 * grouping, and the office's own queue — accepted, nobody has scheduled it —
 * separately, because that is the part that needs somebody to act.
 */
router.get("/dashboard/estimate-status", async (_req, res): Promise<any> => {
  const [quotes, appointments, revisions, links, linkedJobs] = await Promise.all([
    db.select({
      id: quotesTable.id, status: quotesTable.status, quoteNumber: quotesTable.quoteNumber,
      customerId: quotesTable.customerId, totalAmount: quotesTable.totalAmount,
    }).from(quotesTable),
    db.select({ quoteId: estimateAppointmentsTable.quoteId }).from(estimateAppointmentsTable),
    db.select({
      quoteId: estimateRevisionsTable.quoteId, id: estimateRevisionsTable.id,
      revisionNumber: estimateRevisionsTable.revisionNumber,
    }).from(estimateRevisionsTable),
    db.select({
      quoteId: estimatePublicLinksTable.quoteId, revisionId: estimatePublicLinksTable.revisionId,
      sentAt: estimatePublicLinksTable.sentAt, firstOpenedAt: estimatePublicLinksTable.firstOpenedAt,
      decision: estimatePublicLinksTable.decision, decisionAt: estimatePublicLinksTable.decisionAt,
      expiresAt: estimatePublicLinksTable.expiresAt, acceptedSnapshot: estimatePublicLinksTable.acceptedSnapshot,
    }).from(estimatePublicLinksTable),
    db.select({ quoteId: jobsTable.quoteId }).from(jobsTable),
  ]);

  const statuses = deriveQuoteStatuses({ quotes, appointments, revisions, links, jobs: linkedJobs });
  const summary = summariseEstimates(quotes.map((quote) => ({ id: quote.id, status: statuses.get(quote.id) })));

  // Whoever accepted most recently is the one who has waited least; the office
  // wants the oldest wait at the top of its queue.
  const acceptedAt = new Map<number, Date>();
  const acceptedLines = new Map<number, number>();
  for (const link of links) {
    if (link.decision !== "accepted" || !link.decisionAt) continue;
    const current = acceptedAt.get(link.quoteId);
    if (!current || link.decisionAt > current) {
      acceptedAt.set(link.quoteId, link.decisionAt);
      acceptedLines.set(link.quoteId,
        ((link.acceptedSnapshot as { lineItems?: unknown[] } | null)?.lineItems ?? []).length);
    }
  }

  const waiting = quotes.filter((quote) => statuses.get(quote.id) === "accepted");
  const customerIds = [...new Set(waiting.map((quote) => quote.customerId).filter((id): id is number => id !== null))];
  const customers = customerIds.length
    ? await db.select({
        id: customersTable.id, firstName: customersTable.firstName, lastName: customersTable.lastName,
      }).from(customersTable).where(inArray(customersTable.id, customerIds))
    : [];
  const nameOf = new Map(customers.map((customer) =>
    [customer.id, [customer.firstName, customer.lastName].filter(Boolean).join(" ")]));

  res.json({
    ...summary,
    needsAction: waiting
      .map((quote) => ({
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        customerId: quote.customerId,
        customerName: quote.customerId ? nameOf.get(quote.customerId) ?? `Customer #${quote.customerId}` : null,
        totalAmount: Number(quote.totalAmount),
        acceptedAt: acceptedAt.get(quote.id)?.toISOString() ?? null,
        acceptedLineItemCount: acceptedLines.get(quote.id) ?? null,
      }))
      .sort((a, b) => (a.acceptedAt ?? "").localeCompare(b.acceptedAt ?? "")),
  });
});
/**
 * Tell the office an estimate was accepted (Kyle 2026-09-24 #2). Sent after the
 * decision is committed and never awaited by the customer: their acceptance is
 * recorded whatever the mail server does.
 */
async function notifyOfficeOfAcceptance(input: {
  quoteId: number;
  quoteNumber: string;
  customerName: string | null;
  acceptedTotal: number;
  accepted: Array<{ description: string; totalPrice: number }>;
  declined: Array<{ description: string; totalPrice: number }>;
}): Promise<void> {
  const to = officeEmailAddress(process.env);
  if (!to) return;                      // nowhere to send it yet; the dashboard still shows it
  const origin = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const notice = officeAcceptedNotice({
    quoteNumber: input.quoteNumber,
    customerName: input.customerName,
    acceptedTotal: input.acceptedTotal,
    accepted: input.accepted,
    declined: input.declined,
    estimateUrl: origin ? `${origin}/quotes/${input.quoteId}` : null,
  });
  const result = await sendEmailTo({ email: to }, notice.subject, notice.html, notice.text);
  await db.insert(estimateActivitiesTable).values({
    quoteId: input.quoteId,
    activityType: result.success ? "office_notified" : "office_notification_failed",
    actorType: "system",
    detail: { to, provider: result.provider, error: result.error ?? null, subject: notice.subject },
  });
}
async function publicEstimate(token: string) {
  if (!isValidPublicEstimateToken(token)) return null;
  const [link] = await db.select().from(estimatePublicLinksTable).where(eq(estimatePublicLinksTable.tokenHash, tokenHash(token))).limit(1);
  if (!link || link.expiresAt <= new Date()) return null;
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, link.quoteId)).limit(1);
  if (!quote) return null;
  const [customer] = quote.customerId
    ? await db.select().from(customersTable).where(eq(customersTable.id, quote.customerId)).limit(1) : [];
  // What was offered and what was taken are now different things: a customer may
  // tick only some services, and the page still has to show the ones they left.
  const [revision] = await db.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.id, link.revisionId)).limit(1);
  const offered = revision?.snapshot;
  return { link, quote, customer, offered, snapshot: link.acceptedSnapshot ?? offered };
}

router.use("/public/estimates/:token", (req, res, next) => {
  const token = String(req.params.token ?? "");
  if (!isValidPublicEstimateToken(token)) {
    res.status(404).json({ error: "This estimate link is invalid or expired" });
    return;
  }
  const ip = req.ip || "unknown";
  if (!publicEstimateIpLimiter.allow(ip)
    || !publicEstimateTokenLimiter.allow(publicEstimateLimitKey(ip, token))) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Too many estimate link requests; try again shortly" });
    return;
  }
  next();
});

router.get("/public/estimates/:token", async (req, res): Promise<any> => {
  const found = await publicEstimate(req.params.token);
  if (!found) return res.status(404).json({ error: "This estimate link is invalid or expired" });
  const now = new Date();
  await db.update(estimatePublicLinksTable).set({
    firstOpenedAt: found.link.firstOpenedAt ?? now, lastActivityAt: now,
  }).where(eq(estimatePublicLinksTable.id, found.link.id));
  res.json({
    quoteNumber: found.quote.quoteNumber,
    customerName: found.customer ? [found.customer.firstName, found.customer.lastName].filter(Boolean).join(" ") : null,
    snapshot: found.offered ?? found.snapshot,
    acceptedLineItemIds: found.link.decision === "accepted"
      ? ((found.link.acceptedSnapshot as { lineItems?: Array<{ id: number }> } | null)?.lineItems ?? []).map((line) => line.id)
      : null,
    decision: found.link.decision, decisionAt: found.link.decisionAt,
    expiresAt: found.link.expiresAt,
  });
});

router.post("/public/estimates/:token/activity", async (req, res): Promise<any> => {
  const found = await publicEstimate(req.params.token);
  if (!found) return res.status(404).json({ error: "This estimate link is invalid or expired" });
  const allowed = ["downloaded", "printed", "question_requested"];
  const activityType = String(req.body.activityType ?? "");
  if (!allowed.includes(activityType)) return res.status(400).json({ error: "Unsupported activity" });
  const dedupeKey = createHash("sha256").update(JSON.stringify({
    activityType, message: String(req.body.message ?? "").slice(0, 1000) || null,
  })).digest("hex");
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${found.quote.id})`);
    const [existing] = await tx.select({ id: estimateActivitiesTable.id }).from(estimateActivitiesTable)
      .where(and(
        eq(estimateActivitiesTable.publicLinkId, found.link.id),
        eq(estimateActivitiesTable.activityType, activityType),
        sql`${estimateActivitiesTable.detail} @> ${JSON.stringify({ dedupeKey })}::jsonb`,
      )).limit(1);
    await tx.update(estimatePublicLinksTable).set({ lastActivityAt: new Date() }).where(eq(estimatePublicLinksTable.id, found.link.id));
    if (existing) return;
    await tx.insert(estimateActivitiesTable).values({
      quoteId: found.quote.id, publicLinkId: found.link.id, activityType,
      actorType: "customer", detail: { dedupeKey, message: String(req.body.message ?? "").slice(0, 1000) || null },
    });
  });
  res.status(204).end();
});

router.post("/public/estimates/:token/decision", async (req, res): Promise<any> => {
  const found = await publicEstimate(req.params.token);
  if (!found) return res.status(404).json({ error: "This estimate link is invalid or expired" });
  const decision = req.body.decision === "accepted" || req.body.decision === "declined" ? req.body.decision : null;
  if (!decision) return res.status(400).json({ error: "Decision must be accepted or declined" });
  const transition = assertDecisionTransition(found.link.decision, decision);
  if (transition === "idempotent") return res.json({ decision, decisionAt: found.link.decisionAt, idempotent: true });
  // Kyle 2026-09-24 #1: acceptance is per service line. Narrowing the snapshot
  // here means the conversion, the job's services and its total all follow the
  // customer's choice without knowing a choice was made.
  let acceptance = null as ReturnType<typeof acceptedSnapshotFor> | null;
  if (decision === "accepted") {
    try {
      acceptance = acceptedSnapshotFor(
        (found.offered ?? found.snapshot) as Parameters<typeof acceptedSnapshotFor>[0],
        req.body.acceptedLineItemIds ?? null,
      );
    } catch (error) {
      if (error instanceof EstimateAcceptanceError) return res.status(400).json({ error: error.message });
      throw error;
    }
  }
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${found.quote.id})`);
    const [latestRevision] = await tx.select({ id: estimateRevisionsTable.id }).from(estimateRevisionsTable)
      .where(eq(estimateRevisionsTable.quoteId, found.quote.id))
      .orderBy(desc(estimateRevisionsTable.revisionNumber)).limit(1);
    if (!latestRevision) throw Object.assign(new Error("Estimate revision is unavailable"), { statusCode: 409 });
    assertActiveEstimateRevision(found.link.revisionId, latestRevision.id);
    const [locked] = await tx.select().from(estimatePublicLinksTable).where(eq(estimatePublicLinksTable.id, found.link.id)).limit(1);
    const lockedTransition = assertDecisionTransition(locked?.decision, decision);
    if (lockedTransition === "idempotent") {
      return { idempotent: true, decisionAt: locked?.decisionAt ?? now };
    }
    await tx.update(estimatePublicLinksTable).set({
      decision, decisionAt: now, lastActivityAt: now,
      declineReason: decision === "declined" ? String(req.body.declineReason ?? "").slice(0, 2000) || null : null,
      followUpRequested: decision === "accepted" || !!req.body.followUpRequested,
      acceptedSnapshot: acceptance ? acceptance.snapshot : null,
    }).where(eq(estimatePublicLinksTable.id, found.link.id));
    await tx.update(quotesTable).set({ status: decision }).where(eq(quotesTable.id, found.quote.id));
    await tx.insert(estimateActivitiesTable).values({
      quoteId: found.quote.id, publicLinkId: found.link.id,
      activityType: decision === "accepted" ? "estimate_accepted" : "estimate_declined",
      actorType: "customer", detail: decision === "declined"
        ? { declineReason: String(req.body.declineReason ?? "").slice(0, 2000) || null }
        : {
            acceptedLineItemIds: acceptance!.acceptedLineItemIds,
            declinedLineItemIds: acceptance!.declinedLineItemIds,
            whole: acceptance!.whole,
            acceptedTotal: acceptance!.acceptedTotal,
          },
    });
    if (decision === "accepted") await enqueueCommunicationEvent(tx, {
      eventType: "quote.accepted", aggregateType: "quote", aggregateId: found.quote.id,
      payload: {
        quoteId: found.quote.id, customerId: found.quote.customerId, status: "accepted",
        quoteNumber: found.quote.quoteNumber,
        acceptedLineItemIds: acceptance!.acceptedLineItemIds,
        declinedLineItemIds: acceptance!.declinedLineItemIds,
        acceptedTotal: acceptance!.acceptedTotal,
        whole: acceptance!.whole,
      },
      source: "estimate_public_decision", dedupeKey: `estimate-accepted:${found.link.id}`,
    });
    return { idempotent: false, decisionAt: now };
  });
  if (acceptance && !outcome.idempotent) {
    const offeredLines = ((found.offered as { lineItems?: Array<{ id: number; description: string; totalPrice: number }> } | null)?.lineItems) ?? [];
    const acceptedIds = new Set(acceptance.acceptedLineItemIds);
    void notifyOfficeOfAcceptance({
      quoteId: found.quote.id,
      quoteNumber: found.quote.quoteNumber,
      customerName: found.customer
        ? [found.customer.firstName, found.customer.lastName].filter(Boolean).join(" ")
        : null,
      acceptedTotal: acceptance.acceptedTotal,
      accepted: offeredLines.filter((line) => acceptedIds.has(line.id))
        .map((line) => ({ description: line.description, totalPrice: Number(line.totalPrice) })),
      declined: offeredLines.filter((line) => !acceptedIds.has(line.id))
        .map((line) => ({ description: line.description, totalPrice: Number(line.totalPrice) })),
    }).catch((error) => {
      console.error("office acceptance notice failed", error);
    });
  }
  res.json({
    decision, decisionAt: outcome.decisionAt, idempotent: outcome.idempotent,
    acceptedLineItemIds: acceptance?.acceptedLineItemIds ?? null,
    declinedLineItemIds: acceptance?.declinedLineItemIds ?? null,
    acceptedTotal: acceptance?.acceptedTotal ?? null,
  });
});

export default router;