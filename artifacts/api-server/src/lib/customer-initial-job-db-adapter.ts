import {
  activityLogsTable,
  contactsTable,
  crewsTable,
  customersTable,
  db,
  jobsTable,
  propertiesTable,
  propertyAccountRelationshipsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { canonicalContactValues, canonicalPropertyValues } from "./account-relations.ts";
import { enqueueCommunicationEvent } from "./communication-outbox.ts";
import type { CustomerInitialJobServiceDependencies } from "./customer-initial-job-service.ts";
import {
  CustomerInitialJobValidationError,
  initialJobIdempotencyResourceType,
  initialJobSnapshot,
} from "./customer-initial-job.ts";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
} from "./idempotency.ts";
import {
  findStrongDuplicateCandidatesForCustomer,
  normalizeEmail,
  normalizePhone,
} from "./lead-duplicate-candidates.ts";

type Customer = typeof customersTable.$inferSelect;
type Property = typeof propertiesTable.$inferSelect;
type Job = typeof jobsTable.$inferSelect;

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

async function lockProposedContactSignals(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], fields: Record<string, unknown>) {
  const contact = proposedContactFields(fields);
  const signals = Array.from(new Set([
    normalizeEmail(contact.email),
    ...[contact.phone, contact.homePhone, contact.workPhone, contact.cellPhone, contact.altPhone, contact.alternatePhone].map(normalizePhone),
  ].filter((signal): signal is string => Boolean(signal)))).sort();
  for (const signal of signals) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3, hashtext(${`customer-contact:${signal}`}))`);
  }
}

export function customerInitialJobDbDependencies(input: {
  idempotency: { scope: string; operation: string; clientKey: string; requestHash: string };
  actorId: string | null;
}): CustomerInitialJobServiceDependencies<Customer, Property, Job> {
  return {
    transaction: (work) => db.transaction((tx) => work({
      claimIdempotency: async () => {
        const claim = await claimIdempotencyKey(tx, input.idempotency);
        if (claim.kind === "claimed") return { kind: "claimed", recordId: claim.record.id };
        if (claim.kind === "conflict" || claim.kind === "inProgress") return { kind: claim.kind };
        if (!claim.record.resourceId) return { kind: "inProgress" };
        return { kind: "replay", customerId: claim.record.resourceId, resourceType: claim.record.resourceType };
      },
      completeIdempotency: (recordId, customerId, jobId) => completeIdempotencyKey(tx, recordId, {
        resourceType: initialJobIdempotencyResourceType(jobId),
        resourceId: customerId,
        responseStatus: 201,
      }),
      lockContactSignals: (fields) => lockProposedContactSignals(tx, fields),
      findStrongDuplicateCandidates: (fields) => findStrongDuplicateCandidatesForCustomer(tx, proposedContactFields(fields)),
      findCustomerBundle: async (customerId, initialJobId) => {
        const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
        if (!customer) return null;
        const [job] = await tx.select().from(jobsTable)
          .where(and(eq(jobsTable.id, initialJobId), eq(jobsTable.customerId, customerId))).limit(1);
        return job ? { id: customer.id, customer, initialJob: job } : null;
      },
      loadActiveReferences: async (initialJob) => {
        const serviceIds = [...new Set(initialJob.serviceSnapshot.map((line) => line.serviceId))];
        const crew = await tx.select({ id: crewsTable.id }).from(crewsTable)
          .where(and(eq(crewsTable.id, initialJob.crewId), eq(crewsTable.isActive, true))).for("update");
        const employees = await tx.select({ id: usersTable.id }).from(usersTable)
          .where(and(
            inArray(usersTable.id, initialJob.employeeIds),
            eq(usersTable.isActive, true),
            eq(usersTable.role, "field_tech"),
          )).for("update");
        const services = await tx.select({ id: servicesTable.id, name: servicesTable.name }).from(servicesTable)
          .where(and(inArray(servicesTable.id, serviceIds), eq(servicesTable.isActive, true))).for("update");
        return { crewActive: Boolean(crew[0]), activeEmployeeIds: employees.map((employee) => employee.id), activeServices: services };
      },
      insertCustomer: async (fields) => {
        const [customer] = await tx.insert(customersTable)
          .values(fields as typeof customersTable.$inferInsert).returning();
        if (!customer) throw new Error("Customer was not created");
        return customer;
      },
      insertPrimaryContact: async (customer) => {
        const contact = canonicalContactValues(customer);
        if (!contact) throw new CustomerInitialJobValidationError("A primary contact is required");
        await tx.insert(contactsTable).values({ customerId: customer.id, ...contact, isPrimary: true, notes: customer.notes });
      },
      insertPrimaryProperty: async (customer) => {
        const propertyValues = canonicalPropertyValues(customer);
        if (!propertyValues) throw new CustomerInitialJobValidationError("A complete service property is required");
        const [property] = await tx.insert(propertiesTable).values({
          customerId: customer.id,
          name: customer.companyName?.trim() || "Primary service property",
          ...propertyValues,
          propertyType: customer.clientType ?? "residential",
          windowCount: customer.windowCount,
          isPrimary: true,
          isManualDefault: false,
          isBillingAddress: true,
        }).returning();
        return property;
      },
      insertOwnerRelationship: async (customerId, propertyId) => {
        await tx.insert(propertyAccountRelationshipsTable).values({ propertyId, customerId, relationshipType: "owner", isPrimary: true });
      },
      setDefaultProperty: async (customerId, propertyId) => {
        const [customer] = await tx.update(customersTable).set({ defaultPropertyId: propertyId })
          .where(eq(customersTable.id, customerId)).returning();
        if (!customer) throw new Error("Customer disappeared while setting default property");
        return customer;
      },
      insertInitialJob: async (customer, property, initialJob) => {
        const totalAmount = initialJob.serviceSnapshot.reduce((sum, line) => sum + line.totalPrice, 0);
        const [job] = await tx.insert(jobsTable).values({
          customerId: customer.id,
          propertyId: property.id,
          crewId: initialJob.crewId,
          jobNumber: `J-${Date.now()}`,
          status: "scheduled",
          serviceType: initialJob.serviceSnapshot.map((line) => line.serviceName).join(", "),
          scheduledDate: initialJob.scheduledDate,
          scheduledStartTime: initialJob.scheduledStartTime,
          scheduledEndTime: initialJob.scheduledEndTime,
          totalAmount: String(totalAmount),
          notes: initialJob.notes,
          lineItems: JSON.stringify(initialJobSnapshot(initialJob, property)),
        }).returning();
        return job;
      },
      insertActivity: async (activity) => {
        const { customerId, ...values } = activity;
        await tx.insert(activityLogsTable).values({
          entityType: "customer",
          entityId: customerId,
          ...values,
          performedBy: input.actorId,
        });
      },
      enqueueAppointment: async (customerId, job, initialJob) => {
        await enqueueCommunicationEvent(tx, {
          eventType: "appointment.scheduled",
          aggregateType: "job",
          aggregateId: job.id,
          payload: { customerId, jobId: job.id, scheduledDate: initialJob.scheduledDate, changeKind: "scheduled" },
          source: "customers.create_with_initial_job",
          actorId: input.actorId,
          idempotencyKey: input.idempotency.clientKey,
          dedupeKey: `appointment.scheduled:${job.id}:${job.updatedAt.toISOString()}`,
        });
      },
    })),
  };
}