import {
  createCustomerCore,
  type CustomerCreateAudit,
  type CustomerCreateIdempotencyClaim,
} from "./customer-create-core.ts";
import {
  assertActiveInitialJobReferences,
  duplicateOverrideActivity,
  initialJobIdFromResourceType,
  type InitialJobInput,
} from "./customer-initial-job.ts";
import type { DuplicateCandidate } from "./lead-duplicate-candidates.ts";

export type InitialJobBundle<Customer, Job> = {
  id: number;
  customer: Customer;
  initialJob: Job;
};

export type InitialJobServiceClaim =
  | { kind: "claimed"; recordId: number }
  | { kind: "replay"; customerId: number; resourceType: string | null }
  | { kind: "conflict" }
  | { kind: "inProgress" };

export interface CustomerInitialJobTransactionAdapter<
  Customer extends { id: number },
  Property extends { id: number },
  Job extends { id: number },
> {
  claimIdempotency(): Promise<InitialJobServiceClaim>;
  completeIdempotency(recordId: number, customerId: number, jobId: number): Promise<void>;
  lockContactSignals(fields: Record<string, unknown>): Promise<void>;
  findStrongDuplicateCandidates(fields: Record<string, unknown>): Promise<DuplicateCandidate[]>;
  findCustomerBundle(customerId: number, initialJobId: number): Promise<InitialJobBundle<Customer, Job> | null>;
  /** Must validate and lock these active rows in this service transaction. */
  loadActiveReferences(input: InitialJobInput): Promise<{
    crewActive: boolean;
    activeEmployeeIds: string[];
    activeServices: Array<{ id: number; name: string }>;
  }>;
  insertCustomer(fields: Record<string, unknown>): Promise<Customer>;
  insertPrimaryContact(customer: Customer): Promise<void>;
  insertPrimaryProperty(customer: Customer): Promise<Property>;
  insertOwnerRelationship(customerId: number, propertyId: number): Promise<void>;
  setDefaultProperty(customerId: number, propertyId: number): Promise<Customer>;
  insertInitialJob(customer: Customer, property: Property, input: InitialJobInput): Promise<Job>;
  insertActivity(input: {
    customerId: number;
    action: string;
    toValue: string | null;
    note: string;
  }): Promise<void>;
  enqueueAppointment(customerId: number, job: Job, input: InitialJobInput): Promise<void>;
}

export interface CustomerInitialJobServiceDependencies<
  Customer extends { id: number },
  Property extends { id: number },
  Job extends { id: number },
> {
  transaction<T>(work: (adapter: CustomerInitialJobTransactionAdapter<Customer, Property, Job>) => Promise<T>): Promise<T>;
}

export interface CreateCustomerInitialJobServiceInput {
  fields: Record<string, unknown>;
  initialJob: InitialJobInput;
  idempotencyKey: string;
  createSeparateAccount: boolean;
  overrideReason: string;
}

export type CustomerInitialJobServiceResult<Customer, Job> = {
  kind: "created" | "replay" | "existing";
  bundle: InitialJobBundle<Customer, Job>;
  audit: CustomerCreateAudit | null;
};

export async function createCustomerWithInitialJobService<
  Customer extends { id: number; firstName?: string | null; lastName?: string | null },
  Property extends { id: number },
  Job extends { id: number },
>(
  input: CreateCustomerInitialJobServiceInput,
  dependencies: CustomerInitialJobServiceDependencies<Customer, Property, Job>,
): Promise<CustomerInitialJobServiceResult<Customer, Job>> {
  return dependencies.transaction(async (adapter) => {
    let claimedRecordId: number | null = null;
    let replayInitialJobId: number | null = null;
    let createdJobId: number | null = null;
    const outcome = await createCustomerCore<InitialJobBundle<Customer, Job>>({
      fields: input.fields,
      createSeparateAccount: input.createSeparateAccount,
      overrideReason: input.overrideReason,
      idempotencyKey: input.idempotencyKey,
    }, {
      lockContactSignals: (fields) => adapter.lockContactSignals(fields),
      findStrongDuplicateCandidates: (fields) => adapter.findStrongDuplicateCandidates(fields),
      findCustomerById: async (customerId) => {
        if (!replayInitialJobId) throw new Error("Idempotency metadata is missing the initial job binding");
        return adapter.findCustomerBundle(customerId, replayInitialJobId);
      },
      claimIdempotency: async (): Promise<CustomerCreateIdempotencyClaim> => {
        const claim = await adapter.claimIdempotency();
        if (claim.kind === "claimed") {
          claimedRecordId = claim.recordId;
          return { kind: "claimed", key: input.idempotencyKey };
        }
        if (claim.kind === "replay") {
          replayInitialJobId = initialJobIdFromResourceType(claim.resourceType);
          return { kind: "replay", customerId: claim.customerId };
        }
        return claim;
      },
      completeIdempotency: async (_, customerId) => {
        if (claimedRecordId === null || createdJobId === null) {
          throw new Error("Cannot complete idempotency before the initial job exists");
        }
        await adapter.completeIdempotency(claimedRecordId, customerId, createdJobId);
      },
      createCustomer: async () => {
        assertActiveInitialJobReferences(input.initialJob, await adapter.loadActiveReferences(input.initialJob));
        const customer = await adapter.insertCustomer(input.fields);
        await adapter.insertPrimaryContact(customer);
        const property = await adapter.insertPrimaryProperty(customer);
        await adapter.insertOwnerRelationship(customer.id, property.id);
        const updatedCustomer = await adapter.setDefaultProperty(customer.id, property.id);
        const job = await adapter.insertInitialJob(updatedCustomer, property, input.initialJob);
        createdJobId = job.id;
        await adapter.insertActivity({
          customerId: customer.id,
          action: "customer_created",
          toValue: `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim(),
          note: "Customer created with accepted initial job",
        });
        await adapter.insertActivity({
          customerId: customer.id,
          action: "job_created",
          toValue: "scheduled",
          note: `Initial job #${job.id} accepted and scheduled for ${input.initialJob.scheduledDate}`,
        });
        await adapter.enqueueAppointment(customer.id, job, input.initialJob);
        return { id: customer.id, customer: updatedCustomer, initialJob: job };
      },
    });
    if (outcome.kind === "created" && outcome.audit) {
      const activity = duplicateOverrideActivity(outcome.audit);
      await adapter.insertActivity({
        customerId: outcome.customer.customer.id,
        ...activity,
      });
    }
    return {
      kind: outcome.kind,
      bundle: outcome.customer,
      audit: outcome.kind === "created" ? outcome.audit : null,
    };
  });
}