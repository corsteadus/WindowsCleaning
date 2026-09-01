import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCustomerCore,
  CustomerCreateIdempotencyError,
  CustomerDuplicateResolutionError,
  CustomerExistingAccountError,
  findCandidatesInMemory,
  type CustomerCreateAdapter,
  type CustomerCreateAudit,
} from "./customer-create-core.ts";
import type { DuplicateCustomerContact } from "./lead-duplicate-candidates.ts";

type FakeCustomer = DuplicateCustomerContact & {
  id: number;
  lifecycleStatus: string;
  clientType: string;
};

type FakeState = {
  customers: Map<number, FakeCustomer>;
  nextCustomerId: number;
  createCalls: number;
  locks: number;
  idempotency: Map<string, { status: "in_progress" | "completed"; customerId?: number }>;
  idempotencyConflicts: Set<string>;
  auditSummaries: CustomerCreateAudit[];
};

function customer(
  id: number,
  overrides: Partial<FakeCustomer> = {},
): FakeCustomer {
  return {
    id,
    firstName: "Existing",
    lastName: "Customer",
    companyName: "Existing Company",
    email: null,
    phone: null,
    homePhone: null,
    workPhone: null,
    cellPhone: null,
    altPhone: null,
    alternatePhone: null,
    lifecycleStatus: "customer",
    clientType: "residential",
    ...overrides,
  };
}

function makeState(seed: FakeCustomer[] = []): FakeState {
  return {
    customers: new Map(seed.map((row) => [row.id, row])),
    nextCustomerId: Math.max(0, ...seed.map((row) => row.id)) + 1,
    createCalls: 0,
    locks: 0,
    idempotency: new Map(),
    idempotencyConflicts: new Set(),
    auditSummaries: [],
  };
}

function adapterFor(state: FakeState): CustomerCreateAdapter<FakeCustomer> {
  return {
    async lockContactSignals() {
      state.locks += 1;
    },
    async findStrongDuplicateCandidates(fields) {
      return findCandidatesInMemory(fields, [...state.customers.values()]);
    },
    async findCustomerById(id) {
      return state.customers.get(id) ?? null;
    },
    async createCustomer() {
      state.createCalls += 1;
      const created = customer(state.nextCustomerId++, {
        firstName: "New",
        lastName: "Customer",
      });
      state.customers.set(created.id, created);
      return created;
    },
    async claimIdempotency(key) {
      if (state.idempotencyConflicts.has(key)) return { kind: "conflict" };
      const existing = state.idempotency.get(key);
      if (!existing) {
        state.idempotency.set(key, { status: "in_progress" });
        return { kind: "claimed", key };
      }
      if (existing.status === "completed" && existing.customerId) {
        return { kind: "replay", customerId: existing.customerId };
      }
      return { kind: "inProgress" };
    },
    async completeIdempotency(key, customerId) {
      state.idempotency.set(key, { status: "completed", customerId });
    },
  };
}

async function inTransaction<T>(state: FakeState, fn: () => Promise<T>): Promise<T> {
  const customers = new Map(state.customers);
  const idempotency = new Map(state.idempotency);
  const nextCustomerId = state.nextCustomerId;
  const createCalls = state.createCalls;
  try {
    return await fn();
  } catch (error) {
    state.customers = customers;
    state.idempotency = idempotency;
    state.nextCustomerId = nextCustomerId;
    state.createCalls = createCalls;
    throw error;
  }
}

async function create(
  state: FakeState,
  input: Parameters<typeof createCustomerCore<FakeCustomer>>[0],
) {
  const result = await inTransaction(state, () => createCustomerCore(input, adapterFor(state)));
  if (result.kind === "created" && result.audit) {
    state.auditSummaries.push(result.audit);
  }
  return result;
}

describe("transactional direct customer creation safety", () => {
  it("allows normal creation when no strong candidate exists", async () => {
    const state = makeState([customer(1, { email: "different@example.com" })]);

    const result = await create(state, {
      fields: { firstName: "New", lastName: "Person", email: "new@example.com" },
    });

    assert.equal(result.kind, "created");
    assert.equal(state.customers.size, 2);
    assert.equal(state.createCalls, 1);
  });

  it("blocks an unconfirmed exact normalized email candidate", async () => {
    const state = makeState([customer(1, { email: "Person@Example.com" })]);

    await assert.rejects(
      create(state, {
        fields: { firstName: "New", lastName: "Person", email: " person@example.com " },
      }),
      (error: unknown) => error instanceof CustomerDuplicateResolutionError
        && error.candidates.length === 1
        && error.candidates[0]?.matchTypes.includes("email"),
    );
    assert.equal(state.createCalls, 0);
    assert.equal(state.customers.size, 1);
  });

  it("blocks an unconfirmed exact normalized phone candidate", async () => {
    const state = makeState([customer(1, { phone: "(312) 555-0199" })]);

    await assert.rejects(
      create(state, {
        fields: { firstName: "New", lastName: "Person", phone: "312-555-0199" },
      }),
      (error: unknown) => error instanceof CustomerDuplicateResolutionError
        && error.candidates[0]?.matchTypes.includes("phone"),
    );
    assert.equal(state.createCalls, 0);
  });

  it("blocks multiple strong candidates without an explicit resolution", async () => {
    const state = makeState([
      customer(1, { email: "shared@example.com" }),
      customer(2, { phone: "3125550199" }),
    ]);

    await assert.rejects(
      create(state, {
        fields: {
          firstName: "New",
          lastName: "Person",
          email: "shared@example.com",
          phone: "312-555-0199",
        },
      }),
      (error: unknown) => error instanceof CustomerDuplicateResolutionError
        && error.candidates.length === 2,
    );
    assert.equal(state.createCalls, 0);
  });

  it("requires confirmation and a non-blank reason for create-separate", async () => {
    const state = makeState([customer(1, { email: "shared@example.com" })]);

    for (const input of [
      { createSeparateAccount: true, overrideReason: "   " },
      { createSeparateAccount: false, overrideReason: "Valid reason" },
    ]) {
      await assert.rejects(
        create(state, {
          fields: { firstName: "New", lastName: "Person", email: "shared@example.com" },
          ...input,
        }),
        CustomerDuplicateResolutionError,
      );
    }
    assert.equal(state.createCalls, 0);
  });

  it("creates exactly once for explicit create-separate and records only a sanitized audit summary", async () => {
    const state = makeState([customer(1, { email: "shared@example.com" })]);
    const input = {
      fields: {
        firstName: "New",
        lastName: "Person",
        email: "shared@example.com",
      },
      createSeparateAccount: true,
      overrideReason: "Household split for shared@example.com; call +1 (312) 555-0199",
      idempotencyKey: "customer-create-separate-1",
    };

    const first = await create(state, input);
    const replay = await create(state, input);

    assert.equal(first.kind, "created");
    assert.equal(replay.kind, "replay");
    assert.equal(state.createCalls, 1);
    assert.equal(state.customers.size, 2);
    assert.equal(state.auditSummaries.length, 1);
    assert.equal(state.auditSummaries[0]?.candidateCount, 1);
    assert.deepEqual(state.auditSummaries[0]?.matchTypes, ["email"]);
    assert.doesNotMatch(JSON.stringify(state.auditSummaries[0]), /shared@example\.com/i);
    assert.doesNotMatch(JSON.stringify(state.auditSummaries[0]), /312/);
    assert.match(state.auditSummaries[0]?.reason ?? "", /\[email\]/);
    assert.match(state.auditSummaries[0]?.reason ?? "", /\[phone\]/);
  });

  it("does not block name, company, or address-only similarity", async () => {
    const state = makeState([customer(1, {
      firstName: "Same",
      lastName: "Person",
      companyName: "Same Company",
    })]);

    const result = await create(state, {
      fields: {
        firstName: "Same",
        lastName: "Person",
        companyName: "Same Company",
        billingAddress: "100 Main Street",
        billingCity: "Chicago",
        billingState: "IL",
        billingZip: "60601",
      },
    });

    assert.equal(result.kind, "created");
    assert.equal(state.createCalls, 1);
  });

  it("does not use property or address data as an account duplicate key", async () => {
    const state = makeState([customer(1, {
      companyName: "Property Owner",
    })]);

    const result = await create(state, {
      fields: {
        firstName: "Different",
        lastName: "Person",
        billingAddress: "500 Property Lane",
        billingCity: "Chicago",
        billingState: "IL",
        billingZip: "60601",
        propertyId: 1,
      },
    });

    assert.equal(result.kind, "created");
    assert.equal(state.createCalls, 1);
  });

  for (const lifecycleStatus of ["inactive", "archived"] as const) {
    it(`cannot select an ${lifecycleStatus} candidate as an existing account`, async () => {
      const state = makeState([customer(1, {
        email: "shared@example.com",
        lifecycleStatus,
      })]);

      await assert.rejects(
        create(state, {
          fields: { firstName: "New", lastName: "Person", email: "shared@example.com" },
          existingCustomerId: 1,
        }),
        (error: unknown) => error instanceof CustomerExistingAccountError
          && /cannot be selected/i.test(error.message),
      );
      assert.equal(state.createCalls, 0);
      assert.equal(state.customers.size, 1);
    });
  }

  it("uses an eligible existing-account outcome without creating a duplicate", async () => {
    const state = makeState([customer(1, { email: "shared@example.com" })]);

    const result = await create(state, {
      fields: { firstName: "New", lastName: "Person", email: "shared@example.com" },
      existingCustomerId: 1,
    });

    assert.equal(result.kind, "existing");
    assert.equal(result.customer.id, 1);
    assert.equal(state.createCalls, 0);
    assert.equal(state.customers.size, 1);
  });

  it("replays an idempotent request without creating a second customer", async () => {
    const state = makeState();
    const input = {
      fields: { firstName: "New", lastName: "Person", email: "new@example.com" },
      idempotencyKey: "customer-create-1",
    };

    const first = await create(state, input);
    const second = await create(state, input);

    assert.equal(first.kind, "created");
    assert.equal(second.kind, "replay");
    assert.equal(state.createCalls, 1);
    assert.equal(state.customers.size, 1);
  });

  it("rechecks candidates on the server and ignores client-supplied counts", async () => {
    const state = makeState([customer(1, { email: "shared@example.com" })]);

    await assert.rejects(
      create(state, {
        fields: { firstName: "New", lastName: "Person", email: "shared@example.com" },
        clientCandidateCount: 0,
      }),
      CustomerDuplicateResolutionError,
    );
    assert.equal(state.createCalls, 0);
    assert.equal(state.customers.size, 1);
  });

  it("rolls back an idempotency claim when candidate enforcement rejects the transaction", async () => {
    const state = makeState([customer(1, { email: "shared@example.com" })]);

    await assert.rejects(
      create(state, {
        fields: { firstName: "New", lastName: "Person", email: "shared@example.com" },
        idempotencyKey: "rejected-create-1",
      }),
      CustomerDuplicateResolutionError,
    );

    assert.equal(state.idempotency.size, 0);
    assert.equal(state.createCalls, 0);
  });

  it("surfaces idempotency conflict and in-progress outcomes without inserting", async () => {
    const state = makeState();
    state.idempotencyConflicts.add("conflict");
    state.idempotency.set("in-progress", { status: "in_progress" });

    await assert.rejects(
      create(state, {
        fields: { firstName: "New", lastName: "Person" },
        idempotencyKey: "conflict",
      }),
      (error: unknown) => error instanceof CustomerCreateIdempotencyError
        && error.code === "idempotency_conflict",
    );
    await assert.rejects(
      create(state, {
        fields: { firstName: "New", lastName: "Person" },
        idempotencyKey: "in-progress",
      }),
      (error: unknown) => error instanceof CustomerCreateIdempotencyError
        && error.code === "idempotency_in_progress",
    );
    assert.equal(state.createCalls, 0);
  });
});