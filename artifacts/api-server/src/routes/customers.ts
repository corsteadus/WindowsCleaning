import { Router, type IRouter, type Request } from "express";
import { eq, ilike, or, desc, asc, sql, and, inArray, isNull } from "drizzle-orm";
import {
  db,
  customersTable,
  jobsTable,
  quotesTable,
  invoicesTable,
  propertiesTable,
  contactsTable,
  propertyAccountRelationshipsTable,
  messageLogsTable,
  activityLogsTable,
  paymentsTable,
  paymentAllocationsTable,
} from "@workspace/db";
import {
  maskCommunicationDestination,
} from "../lib/communication-safety-store.ts";
import { normalizeCommunicationDestination } from "../lib/communication-safety-core.ts";
import {
  customerLifecycleStatus,
  legacyStatusFromLifecycleStatus,
  lifecycleStatusFromLegacyStatus,
  normalizeAccountType,
  parseLifecycleStatus,
} from "../lib/account-lifecycle.ts";
import {
  canonicalContactValues,
  canonicalPropertyValues,
  lockAccount,
  syncPrimaryContactFromLegacy,
  syncPrimaryPropertyFromLegacy,
} from "../lib/account-relations.ts";
import {
  findStrongDuplicateCandidatesForCustomer,
  normalizeEmail,
  normalizePhone,
} from "../lib/lead-duplicate-candidates.ts";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyContext,
  markIdempotencyReplay,
} from "../lib/idempotency.ts";
import {
  createCustomerCore,
  CustomerCreateIdempotencyError,
  CustomerDuplicateResolutionError,
  type CustomerCreateAudit,
  type CustomerCreateIdempotencyClaim,
} from "../lib/customer-create-core.ts";
import { businessDateStr } from "../lib/date.ts";
import {
  canonicalProspectCreateBody,
  prospectLifecycleTransition,
} from "../lib/prospect-account.ts";
import {
  CustomerInitialJobValidationError,
  normalizeInitialJob,
} from "../lib/customer-initial-job.ts";
import { createCustomerWithInitialJobService } from "../lib/customer-initial-job-service.ts";
import { customerInitialJobDbDependencies } from "../lib/customer-initial-job-db-adapter.ts";
import { canCreateCustomerWithInitialJob, hasCapability, isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { assignedJobCondition, redactAssignedJob } from "../lib/field-tech-scope.ts";

function getPerformedBy(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || String((req.user as { id: string }).id);
}

export type CustomerFieldTechRepository = {
  list(where: unknown, pageSize: number, offset: number, userId: string): Promise<(typeof customersTable.$inferSelect)[]>;
  count(where: unknown, userId: string): Promise<number>;
  findCustomer(id: number, prospectOnly: boolean, userId: string): Promise<typeof customersTable.$inferSelect | null>;
  listAssignedJobs(customerId: number, userId: string): Promise<(typeof jobsTable.$inferSelect)[]>;
  listProperties(ids: number[]): Promise<(typeof propertiesTable.$inferSelect)[]>;
  listContacts(customerId: number): Promise<(typeof contactsTable.$inferSelect)[]>;
};

export function createCustomersRouter(fieldTechRepository: CustomerFieldTechRepository = drizzleCustomerFieldTechRepository): IRouter {
const router: IRouter = Router();

function proposedContactFields(fields: Record<string, unknown>) {
  return {
    email: typeof fields.email === "string" ? fields.email : null,
    phone: typeof fields.phone === "string" ? fields.phone : null,
    homePhone: typeof fields.homePhone === "string" ? fields.homePhone : null,
    workPhone: typeof fields.workPhone === "string" ? fields.workPhone : null,
    cellPhone: typeof fields.cellPhone === "string" ? fields.cellPhone : null,
    altPhone: typeof fields.altPhone === "string" ? fields.altPhone : null,
    alternatePhone: typeof fields.alternatePhone === "string" ? fields.alternatePhone : null,
  };
}

async function lockProposedContactSignals(tx: any, fields: Record<string, unknown>): Promise<void> {
  const contact = proposedContactFields(fields);
  const signals = Array.from(new Set([
    normalizeEmail(contact.email),
    ...[
      contact.phone,
      contact.homePhone,
      contact.workPhone,
      contact.cellPhone,
      contact.altPhone,
      contact.alternatePhone,
    ].map(normalizePhone),
  ].filter((signal): signal is string => Boolean(signal)))).sort();

  for (const signal of signals) {
    // Separate namespace from account-relation, lead, quote, and job locks.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3, hashtext(${`customer-contact:${signal}`}))`);
  }
}

// ─── List customers (paginated) ───────────────────────────────────────────────
router.get(["/customers", "/prospects"], async (req, res): Promise<void> => {
  const { search, status, lifecycleStatus, clientType, accountType, page, limit } = req.query;
  const isProspectRoute = req.path === "/prospects";
  const effectiveLifecycleStatus = isProspectRoute ? "prospect" : lifecycleStatus;

  const pageNum  = Math.max(1, parseInt(String(page  || "1"),  10));
  const pageSize = Math.min(200, Math.max(1, parseInt(String(limit || "75"), 10)));
  const offset   = (pageNum - 1) * pageSize;

  // Build WHERE conditions
  const conditions = [];
  if (isAssignmentScopedOperationalRole(req.user?.role)) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${jobsTable}
       WHERE ${jobsTable.customerId} = ${customersTable.id}
         AND ${assignedJobCondition(req.user!.id)}
    )`);
  }

  if (search) {
    const term = String(search).trim();
    const likeTerm = `%${term}%`;

    // Full-name concat (handles "Kyle Stafford", "stafford kyle", partial first+last)
    const fullNameMatch = sql`UPPER(CONCAT(${customersTable.firstName}, ' ', ${customersTable.lastName})) LIKE UPPER(${likeTerm})`;

    conditions.push(or(
      fullNameMatch,
      ilike(customersTable.firstName,        likeTerm),
      ilike(customersTable.lastName,         likeTerm),
      ilike(customersTable.companyName,      likeTerm),
      ilike(customersTable.email,            likeTerm),
      ilike(customersTable.homePhone,        likeTerm),
      ilike(customersTable.cellPhone,        likeTerm),
      ilike(customersTable.workPhone,        likeTerm),
      ilike(customersTable.billingCity,      likeTerm),
      ilike(customersTable.importExternalId, likeTerm),
    ));
  }

  if (status) {
    conditions.push(eq(customersTable.status, String(status)));
  }

  if (effectiveLifecycleStatus) {
    const lifecycle = parseLifecycleStatus(effectiveLifecycleStatus);
    if (!lifecycle) {
      res.status(400).json({ error: "Unsupported lifecycleStatus" });
      return;
    }
    // lifecycle_status is the canonical, non-null field after the Sandbox
    // backfill. Filtering on the legacy status as an OR fallback can surface a
    // drifted row whose serializer correctly reports a different canonical
    // lifecycle (for example, status=prospect + lifecycle_status=customer).
    conditions.push(eq(customersTable.lifecycleStatus, lifecycle));
  }

  const requestedAccountType = accountType ?? clientType;
  if (requestedAccountType) {
    conditions.push(eq(customersTable.clientType, normalizeAccountType(requestedAccountType)));
  }

  const where = conditions.length === 0
    ? undefined
    : conditions.length === 1
      ? conditions[0]
      : and(...conditions);

  const fieldTech = isAssignmentScopedOperationalRole(req.user?.role);
  const [rows, total] = fieldTech
    ? await Promise.all([
        fieldTechRepository.list(where, pageSize, offset, req.user!.id),
        fieldTechRepository.count(where, req.user!.id),
      ])
    : await Promise.all([
        db.select().from(customersTable)
          .where(where)
          .orderBy(asc(customersTable.lastName), asc(customersTable.firstName))
          .limit(pageSize)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(customersTable).where(where)
          .then((result) => Number(result[0]?.count ?? 0)),
      ]);
  res.json({
    customers: rows.map((row) => fieldTech ? serializeFieldCustomer(row) : serialize(row)),
    total,
    page: pageNum,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
});

// ─── Read-only strong duplicate candidates for a proposed customer ─────────────
router.post(["/customers/duplicate-candidates", "/prospects/duplicate-candidates"], async (req, res): Promise<void> => {
  const normalized = normalizeCustomerFields(req.body ?? {});
  if (normalized.error) {
    res.status(400).json({ error: normalized.error });
    return;
  }

  const candidates = await findStrongDuplicateCandidatesForCustomer(
    db,
    proposedContactFields(normalized.fields),
  );
  res.json({
    candidateCount: candidates.length,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      canLink: !["inactive", "archived"].includes(candidate.lifecycleStatus),
    })),
  });
});

// ─── Create customer ──────────────────────────────────────────────────────────
router.post("/customers/with-initial-job", async (req, res): Promise<void> => {
  if (!canCreateCustomerWithInitialJob(req.user?.role)) {
    res.status(403).json({ error: "Customer management and scheduling permissions are required", code: "forbidden" });
    return;
  }
  const body = req.body ?? {};
  if (!body.firstName || !body.lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  const normalized = normalizeCustomerFields(body);
  if (normalized.error) {
    res.status(400).json({ error: normalized.error });
    return;
  }
  for (const field of ["billingAddress", "billingCity", "billingState", "billingZip"] as const) {
    if (typeof normalized.fields[field] !== "string" || !String(normalized.fields[field]).trim()) {
      res.status(400).json({ error: `${field} is required for the service property` });
      return;
    }
  }

  try {
    const initialJob = normalizeInitialJob(body.initialJob);
    const createSeparateAccount = body.createSeparateAccount === true;
    const overrideReason = typeof body.overrideReason === "string" ? body.overrideReason : "";
    const idempotency = getIdempotencyContext(req, "customers.create_with_initial_job", {
      fields: normalized.fields,
      createSeparateAccount,
      overrideReason,
      initialJob,
    });
    if (!idempotency) {
      res.status(400).json({ error: "Idempotency-Key is required", code: "idempotency_key_required" });
      return;
    }

    const serviceResult = await createCustomerWithInitialJobService<
      typeof customersTable.$inferSelect,
      typeof propertiesTable.$inferSelect,
      typeof jobsTable.$inferSelect
    >({
      fields: normalized.fields,
      initialJob,
      idempotencyKey: idempotency.clientKey,
      createSeparateAccount,
      overrideReason,
    }, customerInitialJobDbDependencies({
      idempotency,
      actorId: getPerformedBy(req),
    }));
    const { bundle, kind: finalKind } = serviceResult;
    if (finalKind === "replay") markIdempotencyReplay(res);
    res.status(finalKind === "existing" ? 200 : 201).json({
      customer: serialize(bundle.customer),
      initialJob: { ...bundle.initialJob, totalAmount: Number(bundle.initialJob.totalAmount) },
      created: finalKind === "created",
      replayed: finalKind === "replay",
    });
  } catch (error) {
    if (error instanceof CustomerInitialJobValidationError) {
      res.status(400).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof CustomerDuplicateResolutionError) {
      res.status(409).json({
        error: error.message,
        code: error.code,
        candidateCount: error.candidates.length,
        candidates: error.candidates.map((candidate) => ({
          ...candidate,
          canLink: !["inactive", "archived"].includes(candidate.lifecycleStatus),
        })),
      });
      return;
    }
    if (error instanceof CustomerCreateIdempotencyError) {
      if (error.code === "idempotency_in_progress") res.setHeader("Retry-After", "1");
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

router.post(["/customers", "/prospects"], async (req, res): Promise<void> => {
  const body = req.path === "/prospects"
    ? canonicalProspectCreateBody(req.body, businessDateStr())
    : req.body;
  if (!body.firstName || !body.lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  const normalized = normalizeCustomerFields(body);
  if (normalized.error) {
    res.status(400).json({ error: normalized.error });
    return;
  }
  const existingCustomerId = body.existingCustomerId === undefined || body.existingCustomerId === null || body.existingCustomerId === ""
    ? null
    : Number(body.existingCustomerId);
  if (existingCustomerId !== null && (!Number.isInteger(existingCustomerId) || existingCustomerId <= 0)) {
    res.status(400).json({ error: "existingCustomerId must be a positive integer" });
    return;
  }
  const createSeparateAccount = body.createSeparateAccount === true;
  const overrideReason = typeof body.overrideReason === "string" ? body.overrideReason : "";
  const idempotency = getIdempotencyContext(req, "customers.create", {
    fields: normalized.fields,
    createSeparateAccount,
    overrideReason,
    existingCustomerId,
  });

  type CustomerCreateRecord = {
    id: number;
    customer: typeof customersTable.$inferSelect;
    createdContact: typeof contactsTable.$inferSelect | null;
    createdProperty: typeof propertiesTable.$inferSelect | null;
  };
  let transactionKind: "created" | "existing" | "replay" = "created";
  let transactionAudit: CustomerCreateAudit | null = null;

  try {
    const { customer, createdContact, createdProperty } = await db.transaction(async (tx) => {
      let claimedIdempotencyRecordId: number | null = null;
      const transactionOutcome = await createCustomerCore(
        {
          fields: normalized.fields,
          createSeparateAccount,
          overrideReason,
          existingCustomerId,
          idempotencyKey: idempotency?.clientKey ?? null,
        },
        {
        lockContactSignals: (fields) => lockProposedContactSignals(tx, fields),
        findStrongDuplicateCandidates: (fields) => findStrongDuplicateCandidatesForCustomer(
          tx,
          proposedContactFields(fields),
        ),
        findCustomerById: async (id) => {
          const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, id)).limit(1);
          return customer
            ? { id: customer.id, customer, createdContact: null, createdProperty: null }
            : null;
        },
          claimIdempotency: async (key): Promise<CustomerCreateIdempotencyClaim> => {
            if (!idempotency || idempotency.clientKey !== key) return { kind: "claimed", key };
            const claim = await claimIdempotencyKey(tx, idempotency);
            if (claim.kind === "claimed") {
              claimedIdempotencyRecordId = claim.record.id;
              return { kind: "claimed", key };
            }
            if (claim.kind === "conflict") return { kind: "conflict" };
            if (claim.kind === "inProgress") return { kind: "inProgress" };
            if (!claim.record.resourceId) return { kind: "inProgress" };
            return { kind: "replay", customerId: claim.record.resourceId };
          },
          completeIdempotency: async (key, customerId) => {
            if (idempotency?.clientKey === key && claimedIdempotencyRecordId !== null) {
              await completeIdempotencyKey(tx, claimedIdempotencyRecordId, {
                resourceType: "customer",
                resourceId: customerId,
                responseStatus: 201,
              });
            }
          },
          createCustomer: async () => {
          const [created] = await tx.insert(customersTable)
            .values(normalized.fields as typeof customersTable.$inferInsert)
            .returning();
          if (!created) throw new Error("Customer was not created");

          const contact = canonicalContactValues({
            firstName: created.firstName,
            lastName: created.lastName,
            email: created.email,
            phone: created.phone,
            homePhone: created.homePhone,
            workPhone: created.workPhone,
            cellPhone: created.cellPhone,
            altPhone: created.altPhone,
            alternatePhone: created.alternatePhone,
          });
          let createdContact: typeof contactsTable.$inferSelect | null = null;
          if (contact) {
            [createdContact] = await tx.insert(contactsTable).values({
              customerId: created.id,
              ...contact,
              isPrimary: true,
              notes: created.notes,
            }).returning();
          }

          const property = canonicalPropertyValues({
            billingAddress: created.billingAddress,
            billingCity: created.billingCity,
            billingState: created.billingState,
            billingZip: created.billingZip,
          });
          let createdProperty: typeof propertiesTable.$inferSelect | null = null;
          if (property) {
            [createdProperty] = await tx.insert(propertiesTable).values({
              customerId: created.id,
              name: created.companyName?.trim() || "Primary service property",
              ...property,
              propertyType: created.clientType ?? "residential",
              windowCount: created.windowCount,
              isPrimary: true,
              isManualDefault: false,
              isBillingAddress: true,
            }).returning();
            await tx.insert(propertyAccountRelationshipsTable).values({
              propertyId: createdProperty.id,
              customerId: created.id,
              relationshipType: "owner",
              isPrimary: true,
            });
            const [withDefault] = await tx.update(customersTable)
              .set({ defaultPropertyId: createdProperty.id })
              .where(eq(customersTable.id, created.id))
              .returning();
            return {
              id: created.id,
              customer: withDefault ?? created,
              createdContact,
              createdProperty,
            };
          }
          return { id: created.id, customer: created, createdContact, createdProperty };
          },
        },
      );
      transactionKind = transactionOutcome.kind;
      transactionAudit = transactionOutcome.kind === "created" ? transactionOutcome.audit : null;
      return transactionOutcome.customer;
    });
    const finalKind = transactionKind as "created" | "existing" | "replay";
    const finalAudit = transactionAudit as CustomerCreateAudit | null;
    if (finalKind === "replay") {
      markIdempotencyReplay(res);
    }
    if (finalKind === "created") {
      await db.insert(activityLogsTable).values({
        entityType:  "customer",
        entityId:    customer.id,
        action:      req.path === "/prospects" ? "prospect_created" : "customer_created",
        toValue:     `${customer.firstName} ${customer.lastName}`,
        note:        `${req.path === "/prospects" ? "Prospect" : "Customer"} ${customer.firstName} ${customer.lastName} created`,
        performedBy: getPerformedBy(req),
      }).catch(() => {});
    }
    if (finalKind === "created" && finalAudit) {
      await db.insert(activityLogsTable).values({
        entityType: "customer",
        entityId: customer.id,
        action: "customer_duplicate_override",
        toValue: JSON.stringify({
          candidateCount: finalAudit.candidateCount,
          matchTypes: finalAudit.matchTypes,
        }),
        note: `Separate account created after strong contact match review. Reason: ${finalAudit.reason}`,
        performedBy: getPerformedBy(req),
      }).catch(() => {});
    }

    res.status(finalKind === "created" ? 201 : 200).json({
      ...serialize(customer),
      createdContactId: createdContact?.id ?? null,
      createdPropertyId: createdProperty?.id ?? null,
      created: finalKind === "created",
      replayed: finalKind === "replay",
    });
  } catch (error) {
    if (error instanceof CustomerDuplicateResolutionError) {
      res.status(error.status).json({
        error: error.message,
        candidateCount: error.candidates.length,
        candidates: error.candidates.map((candidate) => ({
          ...candidate,
          canLink: !["inactive", "archived"].includes(candidate.lifecycleStatus),
        })),
      });
      return;
    }
    if (error instanceof CustomerCreateIdempotencyError) {
      if (error.code === "idempotency_in_progress") res.setHeader("Retry-After", "1");
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof Error && "status" in error && (error as { status?: number }).status === 409) {
      res.status(409).json({ error: error.message, code: "customer_existing_account_invalid" });
      return;
    }
    throw error;
  }

});

// ─── Get customer detail (with related data + activity log) ───────────────────
router.get(["/customers/:id", "/prospects/:id"], async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const isProspectRoute = req.path.startsWith("/prospects/");
  const target = isProspectRoute
    ? and(eq(customersTable.id, id), eq(customersTable.lifecycleStatus, "prospect"))
    : eq(customersTable.id, id);
  const fieldTech = isAssignmentScopedOperationalRole(req.user?.role);
  const customer = fieldTech
    ? await fieldTechRepository.findCustomer(id, isProspectRoute, req.user!.id)
    : (await db.select().from(customersTable).where(target))[0];
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  if (fieldTech) {
    const assignedJobs = await fieldTechRepository.listAssignedJobs(id, req.user!.id);
    if (!assignedJobs.length) {
      res.status(403).json({ error: "This customer is not connected to your assigned work", code: "assigned_work_required" });
      return;
    }
    const propertyIds = [...new Set(assignedJobs
      .map((job) => job.propertyId)
      .filter((propertyId): propertyId is number => propertyId !== null))];
    const [properties, contacts] = await Promise.all([
      propertyIds.length ? fieldTechRepository.listProperties(propertyIds) : Promise.resolve([]),
      fieldTechRepository.listContacts(id),
    ]);
    res.json({
      ...serializeFieldCustomer(customer),
      jobs: assignedJobs.map((job) => redactAssignedJob({
        ...job,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      })),
      properties: properties.map(serializeFieldProperty),
      contacts: contacts.map(serializeFieldContact),
      activityLogs: [],
      messages: [],
    });
    return;
  }
  const canViewPayments = hasCapability(req.user?.role, "payments.view");
  const canViewCommunications = hasCapability(req.user?.role, "communication.view");

  const [jobs, quotes, invoices, ownedProperties, sharedRelationships, contacts, activityLogs, payments] = await Promise.all([
    db.select().from(jobsTable).where(and(eq(jobsTable.customerId, id), eq(jobsTable.isHidden, false))).orderBy(desc(jobsTable.scheduledDate)),
    db.select().from(quotesTable).where(eq(quotesTable.customerId, id)).orderBy(desc(quotesTable.createdAt)),
    db.select().from(invoicesTable).where(eq(invoicesTable.customerId, id)).orderBy(desc(invoicesTable.createdAt)),
    db.select().from(propertiesTable).where(eq(propertiesTable.customerId, id)).orderBy(propertiesTable.id),
    db.select().from(propertyAccountRelationshipsTable).where(eq(propertyAccountRelationshipsTable.customerId, id)).orderBy(propertyAccountRelationshipsTable.id),
    db.select().from(contactsTable).where(eq(contactsTable.customerId, id)).orderBy(contactsTable.id),
    db.select().from(activityLogsTable)
      .where(and(eq(activityLogsTable.entityType, "customer"), eq(activityLogsTable.entityId, id)))
      .orderBy(desc(activityLogsTable.createdAt)),
    canViewPayments
      ? db.select().from(paymentsTable).where(eq(paymentsTable.customerId, id))
        .orderBy(desc(paymentsTable.paymentDate), desc(paymentsTable.id))
      : Promise.resolve([]),
  ]);
  const communicationScopes = [
    and(eq(messageLogsTable.relatedType, "customer"), eq(messageLogsTable.relatedId, id)),
    ...(jobs.length ? [and(eq(messageLogsTable.relatedType, "job"), inArray(messageLogsTable.relatedId, jobs.map((job) => job.id)))] : []),
    ...(quotes.length ? [and(eq(messageLogsTable.relatedType, "quote"), inArray(messageLogsTable.relatedId, quotes.map((quote) => quote.id)))] : []),
    ...(invoices.length ? [and(eq(messageLogsTable.relatedType, "invoice"), inArray(messageLogsTable.relatedId, invoices.map((invoice) => invoice.id)))] : []),
  ];
  const messages = canViewCommunications
    ? await db.select().from(messageLogsTable)
      .where(or(...communicationScopes))
      .orderBy(desc(messageLogsTable.createdAt))
    : [];
  const paymentIds = payments.map((payment) => payment.id);
  const paymentAllocations = paymentIds.length
    ? await db.select().from(paymentAllocationsTable)
      .where(inArray(paymentAllocationsTable.paymentId, paymentIds))
      .orderBy(paymentAllocationsTable.id)
    : [];
  const sharedPropertyIds = sharedRelationships
    .map((relationship) => relationship.propertyId)
    .filter((propertyId) => !ownedProperties.some((property) => property.id === propertyId));
  const sharedProperties = sharedPropertyIds.length > 0
    ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, sharedPropertyIds))
    : [];
  const relationByPropertyId = new Map(sharedRelationships.map((relationship) => [relationship.propertyId, relationship]));
  const properties = [...ownedProperties, ...sharedProperties]
    .sort((a, b) => a.id - b.id)
    .map((property) => {
      const relationship = relationByPropertyId.get(property.id);
      return {
        ...property,
        isPrimary: relationship ? relationship.isPrimary : property.isPrimary,
        relationshipId: relationship?.id ?? null,
        relationshipType: relationship?.relationshipType ?? "owner",
        isOwner: property.customerId === id,
        archivedAt: relationship?.archivedAt ?? property.archivedAt,
      };
    });
  const safeMessages = messages.map((message) => {
    if (message.recipient && (message.channel === "email" || message.channel === "sms")) {
      try {
        const normalized = normalizeCommunicationDestination(
          message.channel,
          message.recipient,
        ).normalized;
        return {
          ...message,
          recipient: maskCommunicationDestination(message.channel, normalized),
          body: "[redacted]",
        };
      } catch {
        return {
          ...message,
          recipient: message.recipient.includes("*") ? message.recipient : null,
          body: "[redacted]",
        };
      }
    }
    return { ...message, body: "[redacted]" };
  });

  let effectiveDefaultPropertyId: number | null = null;
  let defaultPropertySource: "manual" | "auto" = "auto";

  const activeProperties = properties.filter((property) => !property.archivedAt);
  if (customer.defaultPropertyId && activeProperties.some(p => p.id === customer.defaultPropertyId)) {
    effectiveDefaultPropertyId = customer.defaultPropertyId;
    defaultPropertySource = "manual";
  } else if (activeProperties.length > 0) {
    const legacyPrimary = activeProperties.find(p => p.isPrimary);
    if (legacyPrimary) {
      effectiveDefaultPropertyId = legacyPrimary.id;
      defaultPropertySource = "manual";
      db.update(customersTable)
        .set({ defaultPropertyId: legacyPrimary.id })
        .where(eq(customersTable.id, id))
        .execute()
        .catch(() => {});
    } else {
      const mostRecentJob = jobs.find(j => (j as any).propertyId != null);
      if (mostRecentJob && activeProperties.some(p => p.id === (mostRecentJob as any).propertyId)) {
        effectiveDefaultPropertyId = (mostRecentJob as any).propertyId;
      } else {
        const billingProp = activeProperties.find(p => p.isBillingAddress);
        effectiveDefaultPropertyId = billingProp ? billingProp.id : activeProperties[0].id;
      }
    }
  }

  res.json({
    ...serialize(customer),
    effectiveDefaultPropertyId,
    defaultPropertySource,
    jobs: jobs.map(j => ({ ...j, createdAt: j.createdAt.toISOString(), updatedAt: j.updatedAt.toISOString() })),
    quotes: quotes.map(q => ({ ...q, createdAt: q.createdAt.toISOString(), updatedAt: q.updatedAt.toISOString() })),
    invoices: invoices.map(i => ({ ...i, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() })),
    payments: payments.map((payment) => ({
      ...payment,
      allocations: paymentAllocations
        .filter((allocation) => allocation.paymentId === payment.id)
        .map((allocation) => ({ ...allocation, createdAt: allocation.createdAt.toISOString() })),
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    })),
    contacts: contacts.map((contact) => ({
      ...contact,
      title: contact.role,
      archivedAt: contact.archivedAt?.toISOString() ?? null,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    })),
    properties: properties.map(p => ({
      ...p,
      archivedAt: p.archivedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    messages: safeMessages,
    activityLogs: activityLogs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
  });
});

function serializeFieldCustomer(customer: typeof customersTable.$inferSelect) {
  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    companyName: customer.companyName,
    email: customer.email,
    phone: customer.phone,
    homePhone: customer.homePhone,
    workPhone: customer.workPhone,
    cellPhone: customer.cellPhone,
    altPhone: customer.altPhone,
    billingAddress: customer.billingAddress,
    billingCity: customer.billingCity,
    billingState: customer.billingState,
    billingZip: customer.billingZip,
    preferredContactMethod: customer.preferredContactMethod,
    status: customer.status,
    lifecycleStatus: customerLifecycleStatus(customer),
    accountType: normalizeAccountType(customer.clientType),
    directions: customer.directions,
    windowCount: customer.windowCount,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

function serializeFieldProperty(property: typeof propertiesTable.$inferSelect) {
  return {
    id: property.id,
    customerId: property.customerId,
    name: property.name,
    address: property.address,
    city: property.city,
    state: property.state,
    zip: property.zip,
    directions: property.directions,
    locationNotes: property.locationNotes,
    accessNotes: property.accessNotes,
    gateCode: property.gateCode,
    riskNotes: property.riskNotes,
    serviceNotes: property.serviceNotes,
    stories: property.stories,
    windowCount: property.windowCount,
    hasScreens: property.hasScreens,
    hasHardWater: property.hasHardWater,
    hasTracks: property.hasTracks,
    propertyType: property.propertyType,
  };
}

function serializeFieldContact(contact: typeof contactsTable.$inferSelect) {
  return {
    id: contact.id,
    customerId: contact.customerId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    alternatePhone: contact.alternatePhone,
    role: contact.role,
    title: contact.role,
    isPrimary: contact.isPrimary,
  };
}

// ─── Update customer ──────────────────────────────────────────────────────────
router.patch(["/customers/:id", "/prospects/:id"], async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const isProspectRoute = req.path.startsWith("/prospects/");
  const body = isProspectRoute
    ? { ...req.body, status: "prospect", lifecycleStatus: "prospect" }
    : req.body;
  const target = isProspectRoute
    ? and(eq(customersTable.id, id), eq(customersTable.lifecycleStatus, "prospect"))
    : eq(customersTable.id, id);
  const normalized = normalizeCustomerFields(body, { partial: true });
  if (normalized.error) {
    res.status(400).json({ error: normalized.error });
    return;
  }
  const updateData = normalized.fields;

  const { before, customer } = await db.transaction(async (tx) => {
    await lockAccount(tx, id);
    const [before] = await tx.select({
      notes: customersTable.notes,
      specificNotes: customersTable.specificNotes,
      callbackNotes: customersTable.callbackNotes,
      firstName: customersTable.firstName,
      lastName: customersTable.lastName,
      email: customersTable.email,
      phone: customersTable.phone,
      homePhone: customersTable.homePhone,
      workPhone: customersTable.workPhone,
      cellPhone: customersTable.cellPhone,
      altPhone: customersTable.altPhone,
      alternatePhone: customersTable.alternatePhone,
    }).from(customersTable).where(target);
    const [customer] = await tx.update(customersTable)
      .set(updateData as typeof customersTable.$inferInsert)
      .where(target)
      .returning();
    if (!customer) return { before, customer: null };

    const legacyContactFields = [
      "firstName", "lastName", "email", "phone", "homePhone", "workPhone",
      "cellPhone", "altPhone", "alternatePhone",
    ];
    if (legacyContactFields.some((field) => body[field] !== undefined)) {
      await syncPrimaryContactFromLegacy(tx, id, customer);
    }
    const legacyBillingFields = ["billingAddress", "billingCity", "billingState", "billingZip"];
    if (legacyBillingFields.some((field) => body[field] !== undefined)) {
      await syncPrimaryPropertyFromLegacy(tx, id, customer);
    }
    return { before, customer };
  });
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const performedBy = getPerformedBy(req);

  // Log note changes
  const noteFields: Array<{ key: "notes" | "specificNotes" | "callbackNotes"; label: string }> = [
    { key: "notes", label: "General notes" },
    { key: "specificNotes", label: "Specific notes" },
    { key: "callbackNotes", label: "Callback notes" },
  ];
  for (const { key, label } of noteFields) {
    if (body[key] !== undefined && body[key] !== before?.[key]) {
      await db.insert(activityLogsTable).values({
        entityType:  "customer",
        entityId:    id,
        action:      "note_updated",
        toValue:     String(body[key] ?? "").substring(0, 200),
        note:        `${label} updated`,
        performedBy,
      }).catch(() => {});
    }
  }

  // Log key contact field changes (names, email, phone)
  const contactFields = ["firstName", "lastName", "email", "cellPhone", "homePhone", "workPhone"] as const;
  const changedFields = contactFields.filter(
    (f) => body[f] !== undefined && before && body[f] !== (before as Record<string, unknown>)[f]
  );
  if (changedFields.length > 0 && !noteFields.some((n) => body[n.key] !== undefined)) {
    await db.insert(activityLogsTable).values({
      entityType:  "customer",
      entityId:    id,
      action:      "customer_updated",
      toValue:     changedFields.join(", "),
      note:        `Profile updated: ${changedFields.join(", ")}`,
      performedBy,
    }).catch(() => {});
  }

  res.json(serialize(customer));
});

// ─── Change customer status (deactivation requires reason) ────────────────────
router.post(["/customers/:id/status", "/prospects/:id/status"], async (req, res): Promise<void> => {
  const id      = parseId(req.params.id);
  const isProspectRoute = req.path.startsWith("/prospects/");
  const target = isProspectRoute
    ? and(eq(customersTable.id, id), eq(customersTable.lifecycleStatus, "prospect"))
    : eq(customersTable.id, id);
  const {
    status,
    lifecycleStatus: requestedLifecycleStatus,
    reason,
  } = req.body as {
    status?: string;
    lifecycleStatus?: string;
    reason?: string;
  };
  const performedBy = getPerformedBy(req);

  const lifecycle = requestedLifecycleStatus !== undefined
    ? parseLifecycleStatus(requestedLifecycleStatus)
    : lifecycleStatusFromLegacyStatus(status);
  if (!lifecycle) {
    res.status(400).json({ error: "A supported status or lifecycleStatus is required" });
    return;
  }
  if (
    requestedLifecycleStatus !== undefined
    && status !== undefined
    && lifecycleStatusFromLegacyStatus(status) !== lifecycle
  ) {
    res.status(400).json({ error: "status and lifecycleStatus do not agree" });
    return;
  }
  const normalizedStatus = legacyStatusFromLifecycleStatus(lifecycle);

  const deactivating = ["inactive", "archived"].includes(lifecycle);
  if (deactivating && !reason?.trim()) {
    res.status(400).json({ error: "A reason is required when deactivating a customer" });
    return;
  }

  const [current] = await db.select({
    status: customersTable.status,
    lifecycleStatus: customersTable.lifecycleStatus,
  }).from(customersTable).where(target);
  if (!current) { res.status(404).json({ error: "Customer not found" }); return; }

  const updatePayload: Record<string, unknown> = {
    status: normalizedStatus,
    lifecycleStatus: lifecycle,
  };
  const transition = prospectLifecycleTransition(
    isProspectRoute,
    customerLifecycleStatus(current),
    lifecycle,
    businessDateStr(),
  );
  if (transition.customerDate) {
    updatePayload.customerDate = transition.customerDate;
  }
  if (deactivating) {
    updatePayload.deactivatedAt     = new Date();
    updatePayload.deactivationReason = reason?.trim() ?? null;
    updatePayload.deactivatedBy     = performedBy ?? null;
  } else {
    // Reactivating — clear deactivation fields
    updatePayload.deactivatedAt      = null;
    updatePayload.deactivationReason = null;
    updatePayload.deactivatedBy      = null;
  }

  const [customer] = await db.update(customersTable).set(updatePayload).where(target).returning();
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  // Log the status change to activity_logs
  await db.insert(activityLogsTable).values({
    entityType:  "customer",
    entityId:    id,
    action:      transition.action,
    fromValue:   customerLifecycleStatus(current),
    toValue:     lifecycle,
    reason:      reason?.trim() ?? null,
    performedBy: performedBy ?? null,
  });

  res.json(serialize(customer));
});

// ─── Delete customer ──────────────────────────────────────────────────────────
router.delete(["/customers/:id", "/prospects/:id"], async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const isProspectRoute = req.path.startsWith("/prospects/");
  const target = isProspectRoute
    ? and(eq(customersTable.id, id), eq(customersTable.lifecycleStatus, "prospect"))
    : eq(customersTable.id, id);
  const [customer] = await db.delete(customersTable).where(target).returning();
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  res.sendStatus(204);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

const ALL_FIELDS = [
  "firstName","lastName","email",
  "phone","homePhone","workPhone","cellPhone","altPhone","altPhoneType","alternatePhone",
  "fax","altContact","companyName","salutation","starRating",
  "billingAddress","billingCity","billingState","billingZip","county","subdivision",
  "isNonProfit","ccFeeExempt","taxExempt",
  "preferredContactMethod","sendingPreferences",
  "windowCount","windowType","houseSize","laddersNeeded",
  "source","howHeard","tags","status","clientType","lifecycleStatus","accountType",
  "notes","specificNotes","callbackNotes","directions",
  "prospectDate","customerDate","birthday",
];

function normalizeCustomerFields(
  body: Record<string, unknown>,
  options: { partial?: boolean } = {},
): { fields: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {};
  for (const f of ALL_FIELDS) {
    if (f !== "accountType" && body[f] !== undefined) out[f] = body[f];
  }

  const rawType = body.accountType ?? body.clientType;
  if (rawType !== undefined) out.clientType = normalizeAccountType(rawType);

  const hasLifecycle = body.lifecycleStatus !== undefined;
  const hasLegacyStatus = body.status !== undefined;
  if (hasLifecycle || hasLegacyStatus || !options.partial) {
    const lifecycle = hasLifecycle
      ? parseLifecycleStatus(body.lifecycleStatus)
      : lifecycleStatusFromLegacyStatus(body.status ?? "active");
    if (!lifecycle) {
      return { fields: {}, error: "Unsupported lifecycleStatus or status" };
    }
    if (
      hasLifecycle
      && hasLegacyStatus
      && lifecycleStatusFromLegacyStatus(body.status) !== lifecycle
    ) {
      return { fields: {}, error: "status and lifecycleStatus do not agree" };
    }
    if (["inactive", "archived"].includes(lifecycle)) {
      return {
        fields: {},
        error: "Use POST /customers/:id/status with a reason to deactivate or archive a customer",
      };
    }
    out.lifecycleStatus = lifecycle;
    out.status = legacyStatusFromLifecycleStatus(lifecycle);
  }
  return { fields: out };
}

function serialize(c: typeof customersTable.$inferSelect) {
  return {
    ...c,
    lifecycleStatus: customerLifecycleStatus(c),
    accountType: normalizeAccountType(c.clientType),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deactivatedAt: c.deactivatedAt?.toISOString() ?? null,
  };
}

return router;
}

const drizzleCustomerFieldTechRepository: CustomerFieldTechRepository = {
  list: async (where, pageSize, offset) => db.select().from(customersTable)
    .where(where as any).orderBy(asc(customersTable.lastName), asc(customersTable.firstName)).limit(pageSize).offset(offset),
  count: async (where) => {
    const rows = await db.select({ count: sql<number>`count(*)` }).from(customersTable).where(where as any);
    return Number(rows[0]?.count ?? 0);
  },
  findCustomer: async (id, prospectOnly, userId) => (await db.select().from(customersTable).where(and(
    eq(customersTable.id, id),
    ...(prospectOnly ? [eq(customersTable.lifecycleStatus, "prospect")] : []),
    sql`EXISTS (
      SELECT 1 FROM ${jobsTable}
       WHERE ${jobsTable.customerId} = ${customersTable.id}
         AND ${assignedJobCondition(userId)}
    )`,
  ),
  ))[0] ?? null,
  listAssignedJobs: (customerId, userId) => db.select().from(jobsTable).where(and(
    eq(jobsTable.customerId, customerId), eq(jobsTable.isHidden, false), assignedJobCondition(userId),
  )).orderBy(desc(jobsTable.scheduledDate)),
  listProperties: (ids) => db.select().from(propertiesTable).where(inArray(propertiesTable.id, ids)),
  listContacts: (customerId) => db.select().from(contactsTable).where(and(
    eq(contactsTable.customerId, customerId), isNull(contactsTable.archivedAt),
  )).orderBy(contactsTable.id),
};

export default createCustomersRouter();
