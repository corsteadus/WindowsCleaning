/**
 * Unit tests for lead → customer conversion orchestration.
 *
 * Run with:
 *   node --test --experimental-strip-types src/lib/lead-convert.test.ts
 *
 * No database required. convertLeadCore is exercised through a FakeLeadAdapter
 * that uses in-memory Maps. Concurrency tests wrap each call in an
 * AsyncMutex.withLock() to simulate the serialisation that
 * pg_advisory_xact_lock provides in production.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  convertLeadCore,
  leadAdvisoryLockKey,
  LEAD_LOCK_CLASSID,
  type ConvertLeadAdapter,
  type CustomerInsertValues,
  type CustomerRow,
  type LeadRow,
} from "./lead-convert.ts";
import type { DuplicateCandidate } from "./lead-duplicate-candidates.ts";
import { quoteAdvisoryLockKey } from "./quote-convert.ts";

// ── AsyncMutex ────────────────────────────────────────────────────────────────
// Simulates the serialisation guarantee of pg_advisory_xact_lock held inside a
// DB transaction: only one holder runs at a time; later callers queue and run
// only after the current holder finishes (success OR failure).

class AsyncMutex {
  #queue = Promise.resolve();

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn);
    this.#queue = next.then(() => undefined, () => undefined);
    return next;
  }
}

// ── In-memory state and fake adapter ──────────────────────────────────────────

interface FakeCustomer extends CustomerRow {
  values: CustomerInsertValues;
}

interface FakeState {
  leads: Map<number, LeadRow>;
  customers: Map<number, FakeCustomer>;
  insertCount: number;
  markConvertedCount: number;
  /** Adapter method names in call order. */
  callLog: string[];
}

function makeFakeState(): FakeState {
  return {
    leads: new Map(),
    customers: new Map(),
    insertCount: 0,
    markConvertedCount: 0,
    callLog: [],
  };
}

let customerIdSeq = 0;

function makeAdapter(
  state: FakeState,
  opts: { lockError?: Error; insertError?: Error; duplicateCandidates?: DuplicateCandidate[] } = {},
): ConvertLeadAdapter<FakeCustomer> {
  return {
    async acquireAdvisoryLock(leadId) {
      state.callLog.push(`lock:${leadId}`);
      if (opts.lockError) throw opts.lockError;
    },
    async findLeadById(leadId) {
      state.callLog.push(`findLead:${leadId}`);
      return state.leads.get(leadId) ?? null;
    },
    async findCustomerById(customerId) {
      state.callLog.push(`findCustomer:${customerId}`);
      return state.customers.get(customerId) ?? null;
    },
    async findStrongDuplicateCandidates() {
      state.callLog.push("findStrongDuplicateCandidates");
      return opts.duplicateCandidates ?? [];
    },
    async lockCustomerRow(customerId) {
      state.callLog.push(`lockCustomer:${customerId}`);
    },
    async insertCustomer(values) {
      state.callLog.push("insertCustomer");
      if (opts.insertError) throw opts.insertError;
      state.insertCount++;
      const customer: FakeCustomer = {
        id: ++customerIdSeq,
        firstName: values.firstName,
        lastName: values.lastName,
        values,
      };
      state.customers.set(customer.id, customer);
      return customer;
    },
    async promoteCustomerToActive(customerId) {
      const customer = state.customers.get(customerId);
      if (!customer) throw new Error(`Customer ${customerId} not found`);
      customer.values = {
        ...customer.values,
        status: "active",
        lifecycleStatus: "customer",
      };
      customer.status = "active";
      customer.lifecycleStatus = "customer";
      state.callLog.push(`promoteCustomer:${customerId}`);
      return customer;
    },
    async markLeadConverted(leadId, customerId) {
      state.callLog.push(`markConverted:${leadId}:${customerId}`);
      const lead = state.leads.get(leadId);
      // Contract: zero rows updated (lead deleted concurrently) MUST throw so
      // the shared transaction rolls back the customer insert.
      if (!lead) throw new Error(`Lead ${leadId} disappeared during conversion; rolled back`);
      state.markConvertedCount++;
      lead.status = "won";
      lead.convertedCustomerId = customerId;
    },
  };
}

function makeLead(id: number, overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id,
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "555-0100",
    address: "1 Main St",
    city: "Springfield",
    state: "IL",
    zip: "62701",
    source: "referral",
    notes: "north windows",
    clientType: "residential",
    status: "new",
    convertedCustomerId: null,
    ...overrides,
  };
}

function makeExistingCustomer(
  id: number,
  lifecycleStatus: "prospect" | "customer" | "inactive" | "archived",
): FakeCustomer {
  const status = lifecycleStatus === "customer" ? "active" : lifecycleStatus;
  const values: CustomerInsertValues = {
    firstName: "Existing",
    lastName: "Customer",
    email: "existing@example.com",
    phone: "555-0200",
    billingAddress: "2 Main St",
    billingCity: "Springfield",
    billingState: "IL",
    billingZip: "62701",
    source: "manual",
    notes: null,
    clientType: "residential",
    status,
    lifecycleStatus,
    customerDate: DATE,
  };
  return {
    id,
    firstName: values.firstName,
    lastName: values.lastName,
    status,
    lifecycleStatus,
    values,
  };
}

const DATE = "2026-08-09";

// ── Lock-key namespace ────────────────────────────────────────────────────────

describe("leadAdvisoryLockKey", () => {
  it("returns the (classid, objid) pair for the two-int advisory-lock form", () => {
    assert.deepEqual(leadAdvisoryLockKey(1), [LEAD_LOCK_CLASSID, 1]);
    assert.deepEqual(leadAdvisoryLockKey(42), [LEAD_LOCK_CLASSID, 42]);
  });

  it("occupies a keyspace structurally disjoint from quote lock keys", () => {
    // Quote locks use the single-int8 pg_advisory_xact_lock form; lead locks
    // use the (int4, int4) form, which PostgreSQL keeps fully separate — so
    // collision is impossible by construction, for ANY id values.
    for (const leadId of [1, 999, 500_000, 2_000_000_000]) {
      const key = leadAdvisoryLockKey(leadId);
      assert.equal(key.length, 2);
      assert.equal(key[0], LEAD_LOCK_CLASSID);
      // A two-element pair is never equal to a scalar quote key.
      assert.notEqual(key as unknown, quoteAdvisoryLockKey(leadId));
    }
  });
});

// ── convertLeadCore ───────────────────────────────────────────────────────────

describe("convertLeadCore — first conversion", () => {
  it("creates a customer copying lead fields and marks the lead won", async () => {
    const state = makeFakeState();
    state.leads.set(7, makeLead(7));

    const outcome = await convertLeadCore(7, DATE, makeAdapter(state));
    assert.equal(outcome.kind, "created");
    if (outcome.kind !== "created") return;

    const inserted = outcome.customer.values;
    assert.equal(inserted.firstName, "Jane");
    assert.equal(inserted.lastName, "Doe");
    assert.equal(inserted.email, "jane@example.com");
    assert.equal(inserted.billingAddress, "1 Main St");
    assert.equal(inserted.billingCity, "Springfield");
    assert.equal(inserted.billingState, "IL");
    assert.equal(inserted.billingZip, "62701");
    assert.equal(inserted.clientType, "residential");
    assert.equal(inserted.status, "active");

    const lead = state.leads.get(7)!;
    assert.equal(lead.status, "won");
    assert.equal(lead.convertedCustomerId, outcome.customer.id);
    assert.equal(state.insertCount, 1);
    assert.equal(state.markConvertedCount, 1);
    assert.deepEqual(outcome.forLog, {
      leadId: 7,
      customerId: outcome.customer.id,
      audit: {
        candidateCount: 0,
        matchTypes: [],
        overrideReason: null,
      },
    });
  });

  it("sets customerDate to the provided business date", async () => {
    const state = makeFakeState();
    state.leads.set(1, makeLead(1));
    const outcome = await convertLeadCore(1, "2026-01-15", makeAdapter(state));
    assert.equal(outcome.kind, "created");
    if (outcome.kind !== "created") return;
    assert.equal(outcome.customer.values.customerDate, "2026-01-15");
  });

  it("defaults null clientType to residential", async () => {
    const state = makeFakeState();
    state.leads.set(1, makeLead(1, { clientType: null }));
    const outcome = await convertLeadCore(1, DATE, makeAdapter(state));
    assert.equal(outcome.kind, "created");
    if (outcome.kind !== "created") return;
    assert.equal(outcome.customer.values.clientType, "residential");
  });

  it("acquires the advisory lock before any read", async () => {
    const state = makeFakeState();
    state.leads.set(3, makeLead(3));
    await convertLeadCore(3, DATE, makeAdapter(state));
    assert.equal(state.callLog[0], "lock:3");
    assert.equal(state.callLog[1], "findLead:3");
  });
});

describe("convertLeadCore — idempotency", () => {
  it("repeat conversion returns the existing customer without inserting again", async () => {
    const state = makeFakeState();
    state.leads.set(5, makeLead(5));
    const adapter = makeAdapter(state);

    const first = await convertLeadCore(5, DATE, adapter);
    assert.equal(first.kind, "created");
    const second = await convertLeadCore(5, DATE, adapter);
    assert.equal(second.kind, "existing");
    if (first.kind !== "created" || second.kind !== "existing") return;

    assert.equal(second.customer.id, first.customer.id);
    assert.equal(state.insertCount, 1);
    assert.equal(state.markConvertedCount, 1);
  });

  it("returns staleLink when convertedCustomerId points at a missing customer", async () => {
    const state = makeFakeState();
    state.leads.set(9, makeLead(9, { status: "won", convertedCustomerId: 12345 }));
    const outcome = await convertLeadCore(9, DATE, makeAdapter(state));
    assert.deepEqual(outcome, { kind: "staleLink", convertedCustomerId: 12345 });
    assert.equal(state.insertCount, 0);
  });
});

describe("convertLeadCore — explicit existing-customer linking", () => {
  it("links an active customer without inserting a duplicate", async () => {
    const state = makeFakeState();
    state.leads.set(20, makeLead(20));
    state.customers.set(88, makeExistingCustomer(88, "customer"));

    const outcome = await convertLeadCore(20, DATE, makeAdapter(state), 88);

    assert.equal(outcome.kind, "linked");
    if (outcome.kind !== "linked") return;
    assert.equal(outcome.customer.id, 88);
    assert.equal(state.insertCount, 0);
    assert.equal(state.markConvertedCount, 1);
    assert.equal(state.leads.get(20)?.convertedCustomerId, 88);
  });

  it("promotes a prospect target before linking", async () => {
    const state = makeFakeState();
    state.leads.set(21, makeLead(21));
    state.customers.set(89, makeExistingCustomer(89, "prospect"));

    const outcome = await convertLeadCore(21, DATE, makeAdapter(state), 89);

    assert.equal(outcome.kind, "linked");
    assert.equal(state.customers.get(89)?.status, "active");
    assert.equal(state.customers.get(89)?.lifecycleStatus, "customer");
    assert.equal(state.callLog.includes("promoteCustomer:89"), true);
    assert.equal(state.insertCount, 0);
  });

  it("rejects inactive and archived targets without changing the lead", async () => {
    for (const lifecycleStatus of ["inactive", "archived"] as const) {
      const state = makeFakeState();
      state.leads.set(22, makeLead(22));
      state.customers.set(90, makeExistingCustomer(90, lifecycleStatus));

      const outcome = await convertLeadCore(22, DATE, makeAdapter(state), 90);

      assert.deepEqual(outcome, {
        kind: "blockedTarget",
        customerId: 90,
        lifecycleStatus,
      });
      assert.equal(state.leads.get(22)?.convertedCustomerId, null);
      assert.equal(state.markConvertedCount, 0);
      assert.equal(state.insertCount, 0);
    }
  });

  it("rejects a requested target that conflicts with an existing conversion", async () => {
    const state = makeFakeState();
    state.leads.set(23, makeLead(23, { status: "won", convertedCustomerId: 91 }));
    state.customers.set(91, makeExistingCustomer(91, "customer"));

    const outcome = await convertLeadCore(23, DATE, makeAdapter(state), 92);

    assert.deepEqual(outcome, {
      kind: "conflict",
      existingCustomerId: 91,
      requestedCustomerId: 92,
    });
    assert.equal(state.insertCount, 0);
    assert.equal(state.markConvertedCount, 0);
  });
});

describe("convertLeadCore — strong duplicate review", () => {
  const candidate: DuplicateCandidate = {
    id: 88,
    firstName: "Existing",
    lastName: "Customer",
    companyName: null,
    lifecycleStatus: "customer",
    accountType: "residential",
    matchTypes: ["email"],
  };

  it("blocks new-account conversion when strong candidates exist", async () => {
    const state = makeFakeState();
    state.leads.set(30, makeLead(30));

    const outcome = await convertLeadCore(
      30,
      DATE,
      makeAdapter(state, { duplicateCandidates: [candidate] }),
    );

    assert.deepEqual(outcome, { kind: "duplicateCandidates", candidates: [candidate] });
    assert.equal(state.insertCount, 0);
    assert.equal(state.markConvertedCount, 0);
  });

  it("requires a reason before allowing a separate account override", async () => {
    const state = makeFakeState();
    state.leads.set(31, makeLead(31));

    const outcome = await convertLeadCore(
      31,
      DATE,
      makeAdapter(state, { duplicateCandidates: [candidate] }),
      null,
      { createSeparateAccount: true },
    );

    assert.equal(outcome.kind, "duplicateCandidates");
    assert.equal(state.insertCount, 0);
  });

  it("allows an explicitly reasoned separate-account override", async () => {
    const state = makeFakeState();
    state.leads.set(32, makeLead(32));

    const outcome = await convertLeadCore(
      32,
      DATE,
      makeAdapter(state, { duplicateCandidates: [candidate] }),
      null,
      { createSeparateAccount: true, overrideReason: "Separate household" },
    );

    assert.equal(outcome.kind, "created");
    if (outcome.kind !== "created") return;
    assert.equal(outcome.forLog.audit.candidateCount, 1);
    assert.deepEqual(outcome.forLog.audit.matchTypes, ["email"]);
    assert.equal(outcome.forLog.audit.overrideReason, "Separate household");
  });

  it("allows explicit existing-account linking without auto-selecting it", async () => {
    const state = makeFakeState();
    state.leads.set(33, makeLead(33));
    state.customers.set(88, makeExistingCustomer(88, "customer"));

    const outcome = await convertLeadCore(
      33,
      DATE,
      makeAdapter(state, { duplicateCandidates: [candidate] }),
      88,
    );

    assert.equal(outcome.kind, "linked");
    if (outcome.kind !== "linked") return;
    assert.equal(outcome.forLog.audit.selectedCustomerId, 88);
    assert.equal(state.insertCount, 0);
  });
});

describe("convertLeadCore — failure paths", () => {
  it("returns notFound for a missing lead", async () => {
    const state = makeFakeState();
    const outcome = await convertLeadCore(404, DATE, makeAdapter(state));
    assert.deepEqual(outcome, { kind: "notFound" });
    assert.equal(state.insertCount, 0);
  });

  it("a lock failure aborts before any other adapter call", async () => {
    const state = makeFakeState();
    state.leads.set(2, makeLead(2));
    const boom = new Error("lock unavailable");
    await assert.rejects(
      () => convertLeadCore(2, DATE, makeAdapter(state, { lockError: boom })),
      boom,
    );
    assert.deepEqual(state.callLog, ["lock:2"]);
    assert.equal(state.insertCount, 0);
    assert.equal(state.markConvertedCount, 0);
  });

  it("an insert failure propagates without marking the lead converted", async () => {
    // In production the shared transaction rolls back the insert too; the fake
    // verifies convertLeadCore never calls markLeadConverted after a failed insert.
    const state = makeFakeState();
    state.leads.set(2, makeLead(2));
    const boom = new Error("insert failed");
    await assert.rejects(
      () => convertLeadCore(2, DATE, makeAdapter(state, { insertError: boom })),
      boom,
    );
    assert.equal(state.markConvertedCount, 0);
    const lead = state.leads.get(2)!;
    assert.equal(lead.status, "new");
    assert.equal(lead.convertedCustomerId, null);
  });
});

describe("convertLeadCore — lead deleted mid-conversion", () => {
  it("markLeadConverted throwing (zero rows) propagates so the transaction rolls back", async () => {
    const state = makeFakeState();
    state.leads.set(41, makeLead(41));
    const adapter = makeAdapter(state);
    // Simulate DELETE /leads/:id committing between findLeadById and
    // markLeadConverted (delete does not take the conversion advisory lock).
    const original = adapter.insertCustomer.bind(adapter);
    adapter.insertCustomer = async (values) => {
      state.leads.delete(41);
      return original(values);
    };
    await assert.rejects(
      () => convertLeadCore(41, DATE, adapter),
      /disappeared during conversion/,
    );
    assert.equal(state.markConvertedCount, 0);
  });
});

describe("convertLeadCore — concurrency (AsyncMutex simulates pg_advisory_xact_lock)", () => {
  it("simultaneous conversions of the same lead create exactly one customer", async () => {
    const state = makeFakeState();
    state.leads.set(11, makeLead(11));
    const mutex = new AsyncMutex();
    const adapter = makeAdapter(state);

    const [a, b] = await Promise.all([
      mutex.withLock(() => convertLeadCore(11, DATE, adapter)),
      mutex.withLock(() => convertLeadCore(11, DATE, adapter)),
    ]);

    const kinds = [a.kind, b.kind].sort();
    assert.deepEqual(kinds, ["created", "existing"]);
    assert.equal(state.insertCount, 1);
    const created = a.kind === "created" ? a : b;
    const existing = a.kind === "existing" ? a : b;
    if (created.kind !== "created" || existing.kind !== "existing") return;
    assert.equal(existing.customer.id, created.customer.id);
  });

  it("different leads convert independently (separate lock keys)", async () => {
    const state = makeFakeState();
    state.leads.set(21, makeLead(21, { firstName: "A" }));
    state.leads.set(22, makeLead(22, { firstName: "B" }));
    // Distinct leads use distinct advisory keys, so no shared mutex is needed.
    assert.notEqual(leadAdvisoryLockKey(21), leadAdvisoryLockKey(22));
    const adapter = makeAdapter(state);

    const [a, b] = await Promise.all([
      convertLeadCore(21, DATE, adapter),
      convertLeadCore(22, DATE, adapter),
    ]);
    assert.equal(a.kind, "created");
    assert.equal(b.kind, "created");
    assert.equal(state.insertCount, 2);
    if (a.kind !== "created" || b.kind !== "created") return;
    assert.notEqual(a.customer.id, b.customer.id);
  });

  it("a queued caller whose predecessor failed still proceeds (lock released on rollback)", async () => {
    const state = makeFakeState();
    state.leads.set(31, makeLead(31));
    const mutex = new AsyncMutex();
    const failing = makeAdapter(state, { insertError: new Error("tx failed") });
    const working = makeAdapter(state);

    const results = await Promise.allSettled([
      mutex.withLock(() => convertLeadCore(31, DATE, failing)),
      mutex.withLock(() => convertLeadCore(31, DATE, working)),
    ]);
    assert.equal(results[0].status, "rejected");
    assert.equal(results[1].status, "fulfilled");
    if (results[1].status !== "fulfilled") return;
    assert.equal(results[1].value.kind, "created");
    assert.equal(state.insertCount, 1);
  });
});
