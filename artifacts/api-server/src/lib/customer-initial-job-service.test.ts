import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCustomerWithInitialJobService,
  type CustomerInitialJobTransactionAdapter,
  type InitialJobServiceClaim,
} from "./customer-initial-job-service.ts";
import { initialJobIdempotencyResourceType, normalizeInitialJob } from "./customer-initial-job.ts";

type Customer = { id: number; firstName: string; lastName: string; defaultPropertyId?: number };
type Property = { id: number };
type Job = { id: number };

const input = {
  fields: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  initialJob: normalizeInitialJob({
    accepted: true,
    scheduledDate: "2027-04-10",
    scheduledStartTime: "09:00",
    scheduledEndTime: "11:00",
    crewId: 2,
    employeeIds: ["user-1"],
    serviceSnapshot: [{ serviceId: 3, serviceName: "Exterior", quantity: 1, unitPrice: 125, totalPrice: 125 }],
  }),
  idempotencyKey: "key-1",
  createSeparateAccount: false,
  overrideReason: "",
};

function harness(options: {
  failAt?: string;
  claim?: InitialJobServiceClaim;
  duplicate?: boolean;
  crewActive?: boolean;
} = {}) {
  let committed: string[] = [];
  const calls: string[] = [];
  const mutate = (name: string) => {
    calls.push(name);
    committed.push(name);
    if (options.failAt === name) throw new Error(`failed:${name}`);
  };
  const adapter: CustomerInitialJobTransactionAdapter<Customer, Property, Job> = {
    claimIdempotency: async () => options.claim ?? { kind: "claimed", recordId: 77 },
    completeIdempotency: async (recordId, customerId, jobId) => {
      assert.deepEqual({ recordId, customerId, jobId }, { recordId: 77, customerId: 1, jobId: 9 });
      mutate("idempotency");
    },
    lockContactSignals: async () => { calls.push("lock"); },
    findStrongDuplicateCandidates: async () => {
      calls.push("duplicates");
      return options.duplicate ? [{
        id: 20,
        firstName: "Ada",
        lastName: "Other",
        companyName: null,
        lifecycleStatus: "active" as const,
        accountType: "residential" as const,
        matchTypes: ["email" as const],
      }] : [];
    },
    findCustomerBundle: async (customerId, jobId) => {
      calls.push(`replay:${customerId}:${jobId}`);
      return { id: customerId, customer: { id: customerId, firstName: "Ada", lastName: "Lovelace" }, initialJob: { id: jobId } };
    },
    loadActiveReferences: async () => {
      calls.push("references");
      return { crewActive: options.crewActive ?? true, activeEmployeeIds: ["user-1"], activeServices: [{ id: 3, name: "Exterior" }] };
    },
    insertCustomer: async () => { mutate("customer"); return { id: 1, firstName: "Ada", lastName: "Lovelace" }; },
    insertPrimaryContact: async () => { mutate("contact"); },
    insertPrimaryProperty: async () => { mutate("property"); return { id: 5 }; },
    insertOwnerRelationship: async () => { mutate("relationship"); },
    setDefaultProperty: async () => { mutate("default-property"); return { id: 1, firstName: "Ada", lastName: "Lovelace", defaultPropertyId: 5 }; },
    insertInitialJob: async () => { mutate("job"); return { id: 9 }; },
    insertActivity: async ({ action }) => { mutate(`activity:${action}`); },
    enqueueAppointment: async () => { mutate("outbox"); },
  };
  return {
    calls,
    committed: () => committed,
    dependencies: {
      transaction: async <T>(work: (tx: typeof adapter) => Promise<T>) => {
        const before = [...committed];
        try {
          return await work(adapter);
        } catch (error) {
          committed = before;
          throw error;
        }
      },
    },
  };
}

describe("customer with initial job application service", () => {
  it("executes the exact persistence boundary and completes idempotency with customer and job", async () => {
    const test = harness();
    const result = await createCustomerWithInitialJobService(input, test.dependencies);
    assert.equal(result.kind, "created");
    assert.deepEqual(test.calls, [
      "lock", "duplicates", "references", "customer", "contact", "property", "relationship",
      "default-property", "job", "activity:customer_created", "activity:job_created", "outbox", "idempotency",
    ]);
    assert.deepEqual(test.committed(), [
      "customer", "contact", "property", "relationship", "default-property", "job",
      "activity:customer_created", "activity:job_created", "outbox", "idempotency",
    ]);
  });

  it("rejects a deactivated locked assignment before any write", async () => {
    const test = harness({ crewActive: false });
    await assert.rejects(createCustomerWithInitialJobService(input, test.dependencies), /crew is not active/);
    assert.deepEqual(test.calls, ["lock", "duplicates", "references"]);
    assert.deepEqual(test.committed(), []);
  });

  for (const step of [
    "customer", "contact", "property", "relationship", "default-property", "job",
    "activity:customer_created", "activity:job_created", "outbox", "idempotency",
  ]) {
    it(`rejects and rolls back all staged writes when ${step} fails`, async () => {
      const test = harness({ failAt: step });
      await assert.rejects(createCustomerWithInitialJobService(input, test.dependencies), new RegExp(`failed:${step}`));
      assert.deepEqual(test.committed(), []);
    });
  }

  it("replays the exactly bound job and performs no mutation", async () => {
    const test = harness({
      claim: { kind: "replay", customerId: 1, resourceType: initialJobIdempotencyResourceType(91) },
    });
    const result = await createCustomerWithInitialJobService(input, test.dependencies);
    assert.equal(result.kind, "replay");
    assert.equal(result.bundle.initialJob.id, 91);
    assert.deepEqual(test.calls, ["replay:1:91"]);
    assert.deepEqual(test.committed(), []);
  });

  it("writes duplicate override audit in the transaction and rolls everything back if it fails", async () => {
    const test = harness({ duplicate: true, failAt: "activity:customer_duplicate_override" });
    await assert.rejects(createCustomerWithInitialJobService({
      ...input,
      createSeparateAccount: true,
      overrideReason: "Separate legal entity",
    }, test.dependencies), /failed:activity:customer_duplicate_override/);
    assert.ok(test.calls.includes("activity:customer_duplicate_override"));
    assert.deepEqual(test.committed(), []);
  });
});