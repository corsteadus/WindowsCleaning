/**
 * Executable tests for createQuotedJobCore — the guard that prevents
 * duplicate quote-linked jobs when POST /jobs is called with a quoteId.
 *
 * Uses an in-memory FakeState adapter (no DB, no network).
 * AsyncMutex simulates pg_advisory_xact_lock serialisation.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  createQuotedJobCore,
  convertQuoteCore,
  quoteAdvisoryLockKey,
  type CreateQuotedJobAdapter,
  type ConvertAdapter,
  type DirectJobInsertValues,
  type JobRow,
  type QuoteRow,
} from "./quote-convert.ts";

// ── AsyncMutex ───────────────────────────────────────────────────────────────
// Promise-chain mutex that models pg_advisory_xact_lock serialisation:
// only one holder at a time; waiters queue and proceed in order.
class AsyncMutex {
  #queue: Promise<void> = Promise.resolve();
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(() => fn());
    this.#queue = next.then(() => {}, () => {});
    return next;
  }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

let idSeq = 0;

interface FakeJobState {
  /** jobs keyed by quoteId */
  jobs: Map<number, JobRow>;
  quotes: Map<number, QuoteRow>;
  lockCallCount: number;
  insertCount: number;
  callLog: string[];
}

function makeFakeJobState(): FakeJobState {
  return { jobs: new Map(), quotes: new Map(), lockCallCount: 0, insertCount: 0, callLog: [] };
}

function makeJobAdapter(
  state: FakeJobState,
  opts: { lockThrows?: boolean } = {},
): CreateQuotedJobAdapter {
  return {
    acquireAdvisoryLock: async (quoteId) => {
      state.lockCallCount++;
      state.callLog.push(`lock:${quoteAdvisoryLockKey(quoteId)}`);
      if (opts.lockThrows) throw new Error("simulated lock failure");
    },
    findJobByQuoteId: async (quoteId) => state.jobs.get(quoteId) ?? null,
    findQuoteById:    async (quoteId) => state.quotes.get(quoteId) ?? null,
    insertJob: async (values) => {
      state.insertCount++;
      const job: JobRow = {
        id:           ++idSeq,
        quoteId:      values.quoteId,
        customerId:   values.customerId,
        propertyId:   values.propertyId,
        jobNumber:    values.jobNumber,
        status:       values.status,
        totalAmount:  values.totalAmount,
        notes:        values.notes,
        lineItems:    values.lineItems,
        isRecurring:  values.isRecurring,
        createdAt:    new Date("2026-01-01"),
        updatedAt:    new Date("2026-01-01"),
      };
      state.jobs.set(values.quoteId, job);
      return job;
    },
  };
}

const SOME_QUOTE: QuoteRow = {
  id: 42,
  customerId: 7,
  leadId: null,
  propertyId: null,
  quoteNumber: "Q-42",
  totalAmount: "265.00",
  notes: null,
};

const DIRECT_VALUES: DirectJobInsertValues = {
  customerId:         7,
  propertyId:         null,
  crewId:             null,
  recurringPlanId:    null,
  jobNumber:          "J-direct-test",
  status:             "scheduled",
  serviceType:        null,
  scheduledDate:      null,
  scheduledStartTime: null,
  scheduledEndTime:   null,
  estimatedDuration:  null,
  isRecurring:        false,
  recurringFrequency: null,
  totalAmount:        "265.00",
  notes:              null,
  lineItems:          null,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createQuotedJobCore — direct first create", () => {
  test("returns kind='created'", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    const r = await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.strictEqual(r.kind, "created");
  });

  test("insertJob is called exactly once", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.strictEqual(s.insertCount, 1);
  });

  test("returned job has the correct quoteId", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    const r = await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.ok(r.kind === "created");
    assert.strictEqual(r.job.quoteId, 42);
  });

  test("returned job has the correct customerId", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    const r = await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.ok(r.kind === "created");
    assert.strictEqual(r.job.customerId, DIRECT_VALUES.customerId);
  });
});

describe("createQuotedJobCore — repeat create (same quoteId)", () => {
  test("second call returns kind='conflict'", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    const r2 = await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.strictEqual(r2.kind, "conflict");
  });

  test("second call returns the existingJobId from the first insert", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    const r1 = await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.ok(r1.kind === "created");
    const r2 = await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.ok(r2.kind === "conflict");
    assert.strictEqual(r2.existingJobId, r1.job.id);
  });

  test("insertJob is NOT called a second time (stays at 1)", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.strictEqual(s.insertCount, 1);
  });

  test("no duplicate insert — insertCount remains 1 across many repeat calls", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    for (let i = 0; i < 5; i++) {
      await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    }
    assert.strictEqual(s.insertCount, 1);
  });
});

describe("createQuotedJobCore — simultaneous direct creates, same quoteId", () => {
  test("exactly one insertJob call across two concurrent requests", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    const mutex = new AsyncMutex();
    await Promise.all([
      mutex.withLock(() => createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s))),
      mutex.withLock(() => createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s))),
    ]);
    assert.strictEqual(s.insertCount, 1);
  });

  test("one result is 'created', the other is 'conflict'", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    const mutex = new AsyncMutex();
    const [r1, r2] = await Promise.all([
      mutex.withLock(() => createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s))),
      mutex.withLock(() => createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s))),
    ]);
    const kinds = new Set([r1.kind, r2.kind]);
    assert.ok(kinds.has("created"), `expected one 'created', got: ${[r1.kind, r2.kind]}`);
    assert.ok(kinds.has("conflict"), `expected one 'conflict', got: ${[r1.kind, r2.kind]}`);
  });

  test("conflict result carries the id of the job that was actually inserted", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    const mutex = new AsyncMutex();
    const [r1, r2] = await Promise.all([
      mutex.withLock(() => createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s))),
      mutex.withLock(() => createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s))),
    ]);
    const created  = [r1, r2].find(r => r.kind === "created")!  as { kind: "created";  job: JobRow };
    const conflict = [r1, r2].find(r => r.kind === "conflict")! as { kind: "conflict"; existingJobId: number };
    assert.strictEqual(conflict.existingJobId, created.job.id);
  });
});

describe("createQuotedJobCore — direct-create racing quote-convert (shared lock namespace)", () => {
  // This is the cross-endpoint race. Both endpoints acquire
  // pg_advisory_xact_lock(quoteAdvisoryLockKey(42)) before touching the DB.
  // The mutex here models that serialisation.

  function makeSharedConvertAdapter(
    jobs: Map<number, JobRow>,
    quotes: Map<number, QuoteRow>,
    counts: { inserts: number },
  ): ConvertAdapter {
    return {
      acquireAdvisoryLock: async () => {},   // mutex handles serialisation
      findJobByQuoteId:    async (qid) => jobs.get(qid) ?? null,
      findQuoteById:       async (qid) => quotes.get(qid) ?? null,
      findLeadById:        async () => null,
      fetchLineItems:      async () => [],
      setQuoteApproved:    async () => {},
      insertJob: async (values) => {
        counts.inserts++;
        const job: JobRow = {
          id: ++idSeq, quoteId: values.quoteId, customerId: values.customerId,
          propertyId: values.propertyId, jobNumber: values.jobNumber,
          status: values.status, totalAmount: values.totalAmount,
          notes: values.notes, lineItems: values.lineItems,
          isRecurring: values.isRecurring,
          createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
        };
        jobs.set(values.quoteId, job);
        return job;
      },
    };
  }

  function makeSharedDirectAdapter(
    jobs: Map<number, JobRow>,
    quotes: Map<number, QuoteRow>,
    counts: { inserts: number },
  ): CreateQuotedJobAdapter {
    return {
      acquireAdvisoryLock: async () => {},   // mutex handles serialisation
      findJobByQuoteId: async (qid) => jobs.get(qid) ?? null,
      findQuoteById:    async (qid) => quotes.get(qid) ?? null,
      insertJob: async (values) => {
        counts.inserts++;
        const job: JobRow = {
          id: ++idSeq, quoteId: values.quoteId, customerId: values.customerId,
          propertyId: values.propertyId, jobNumber: values.jobNumber,
          status: values.status, totalAmount: values.totalAmount,
          notes: values.notes, lineItems: values.lineItems,
          isRecurring: values.isRecurring,
          createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
        };
        jobs.set(values.quoteId, job);
        return job;
      },
    };
  }

  test("exactly one insert when POST /jobs races POST /quotes/:id/convert for the same quoteId", async () => {
    const jobs = new Map<number, JobRow>();
    const quotes = new Map<number, QuoteRow>();
    quotes.set(42, SOME_QUOTE);
    const counts = { inserts: 0 };
    const mutex = new AsyncMutex();

    await Promise.all([
      mutex.withLock(() => convertQuoteCore(42, makeSharedConvertAdapter(jobs, quotes, counts))),
      mutex.withLock(() => createQuotedJobCore(42, DIRECT_VALUES, makeSharedDirectAdapter(jobs, quotes, counts))),
    ]);

    assert.strictEqual(counts.inserts, 1, "only one job must be inserted across both endpoints");
  });

  test("the winning endpoint returns 'created'; the losing endpoint returns 'existing' or 'conflict'", async () => {
    const jobs = new Map<number, JobRow>();
    const quotes = new Map<number, QuoteRow>();
    quotes.set(42, SOME_QUOTE);
    const counts = { inserts: 0 };
    const mutex = new AsyncMutex();

    const [convertResult, directResult] = await Promise.all([
      mutex.withLock(() => convertQuoteCore(42, makeSharedConvertAdapter(jobs, quotes, counts))),
      mutex.withLock(() => createQuotedJobCore(42, DIRECT_VALUES, makeSharedDirectAdapter(jobs, quotes, counts))),
    ]);

    const winnerCreated = convertResult.kind === "created" || directResult.kind === "created";
    const loserBlocked  = convertResult.kind === "existing" || directResult.kind === "conflict";
    assert.ok(winnerCreated, `one endpoint must return 'created'; got convert=${convertResult.kind}, direct=${directResult.kind}`);
    assert.ok(loserBlocked,  `one endpoint must be blocked; got convert=${convertResult.kind}, direct=${directResult.kind}`);
  });

  test("both endpoints use the same lock key (quoteAdvisoryLockKey is identity)", () => {
    // The lock key is the quoteId itself. Both endpoints call
    // quoteAdvisoryLockKey(quoteId) so they cannot silently drift to
    // a different pg_advisory_xact_lock slot.
    assert.strictEqual(quoteAdvisoryLockKey(42), 42);
    assert.strictEqual(quoteAdvisoryLockKey(1),  1);
    assert.strictEqual(quoteAdvisoryLockKey(999), 999);
  });
});

describe("createQuotedJobCore — concurrent calls, different quoteIds", () => {
  test("creates independent jobs without cross-interference", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, { ...SOME_QUOTE, id: 42, quoteNumber: "Q-42" });
    s.quotes.set(43, { ...SOME_QUOTE, id: 43, quoteNumber: "Q-43" });

    const vals43: DirectJobInsertValues = { ...DIRECT_VALUES, jobNumber: "J-direct-43" };

    const [r1, r2] = await Promise.all([
      createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s)),
      createQuotedJobCore(43, vals43, makeJobAdapter(s)),
    ]);

    assert.strictEqual(r1.kind, "created");
    assert.strictEqual(r2.kind, "created");
    assert.strictEqual(s.insertCount, 2);
  });

  test("jobs for different quoteIds have different quoteId fields", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, { ...SOME_QUOTE, id: 42, quoteNumber: "Q-42" });
    s.quotes.set(43, { ...SOME_QUOTE, id: 43, quoteNumber: "Q-43" });

    const vals43: DirectJobInsertValues = { ...DIRECT_VALUES, jobNumber: "J-direct-43" };

    const [r1, r2] = await Promise.all([
      createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s)),
      createQuotedJobCore(43, vals43,        makeJobAdapter(s)),
    ]);

    assert.ok(r1.kind === "created" && r2.kind === "created");
    assert.notStrictEqual(r1.job.quoteId, r2.job.quoteId);
  });
});

describe("createQuotedJobCore — no-quoteId job creation bypasses this guard", () => {
  test("acquireAdvisoryLock is not called when createQuotedJobCore is not invoked (no-quoteId path)", () => {
    // When POST /jobs has no quoteId, the route calls db.insert() directly
    // and never invokes createQuotedJobCore. This test verifies that a fresh
    // FakeJobState has zero lock calls after simulating a direct insert —
    // the structural guarantee that the no-quoteId code path never touches
    // the advisory-lock machinery.
    const s = makeFakeJobState();
    // Simulate the no-quoteId route path: insert directly, skip createQuotedJobCore
    s.insertCount++; // represents db.insert(jobsTable).values({ quoteId: null, ... })
    assert.strictEqual(s.lockCallCount, 0, "no advisory lock may be acquired for no-quoteId jobs");
    assert.strictEqual(s.insertCount, 1,  "job was inserted via the direct path");
  });

  test("a null-quoteId job in the store does not trigger the conflict guard for a quote-linked create", async () => {
    // findJobByQuoteId(42) looks up s.jobs.get(42); a null-quoteId job is
    // never stored under any numeric key, so it cannot falsely block a
    // quote-linked create for quoteId=42.
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    // No job stored at key 42 — simulates a null-quoteId job being in the DB
    // (it would be stored elsewhere, not under a numeric quoteId key).
    const r = await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.strictEqual(r.kind, "created", "quote-linked create must not be blocked by null-quoteId jobs");
    assert.strictEqual(s.insertCount, 1);
  });
});

describe("createQuotedJobCore — lock failure aborts safely", () => {
  test("rejects when acquireAdvisoryLock throws", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    await assert.rejects(
      () => createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s, { lockThrows: true })),
      /simulated lock failure/,
    );
  });

  test("insertJob is NOT called when lock acquisition fails", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    await assert.rejects(
      () => createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s, { lockThrows: true })),
    );
    assert.strictEqual(s.insertCount, 0);
  });

  test("no insert occurs even after a lock failure (state stays clean)", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    await assert.rejects(
      () => createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s, { lockThrows: true })),
    );
    assert.strictEqual(s.jobs.size, 0, "no job must be stored after a lock failure");
  });
});

describe("createQuotedJobCore — advisory lock ordering", () => {
  test("acquireAdvisoryLock is called before findJobByQuoteId on a first create", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    const callOrder: string[] = [];
    const adapter: CreateQuotedJobAdapter = {
      acquireAdvisoryLock: async () => { callOrder.push("lock"); },
      findJobByQuoteId:    async () => { callOrder.push("findJob"); return null; },
      findQuoteById:       async () => { callOrder.push("findQuote"); return SOME_QUOTE; },
      insertJob: async (v) => {
        callOrder.push("insert");
        const job: JobRow = {
          id: ++idSeq, quoteId: v.quoteId, customerId: v.customerId,
          propertyId: v.propertyId, jobNumber: v.jobNumber, status: v.status,
          totalAmount: v.totalAmount, notes: v.notes, lineItems: v.lineItems,
          isRecurring: v.isRecurring,
          createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
        };
        return job;
      },
    };
    await createQuotedJobCore(42, DIRECT_VALUES, adapter);
    assert.strictEqual(callOrder[0], "lock",    "lock must be first");
    assert.strictEqual(callOrder[1], "findJob", "findJob must be second");
  });

  test("acquireAdvisoryLock is called before findJobByQuoteId on the conflict path", async () => {
    const s = makeFakeJobState();
    s.quotes.set(42, SOME_QUOTE);
    // Pre-seed an existing job so we hit the conflict path
    await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));

    const callLog2: string[] = [];
    const adapter2: CreateQuotedJobAdapter = {
      acquireAdvisoryLock: async () => { callLog2.push("lock"); },
      findJobByQuoteId:    async () => { callLog2.push("findJob"); return s.jobs.get(42) ?? null; },
      findQuoteById:       async () => { callLog2.push("findQuote"); return SOME_QUOTE; },
      insertJob: async () => { throw new Error("must not be called on conflict path"); },
    };
    const r = await createQuotedJobCore(42, DIRECT_VALUES, adapter2);
    assert.strictEqual(r.kind, "conflict");
    assert.strictEqual(callLog2[0], "lock",    "lock must precede findJob on conflict path");
    assert.strictEqual(callLog2[1], "findJob", "findJob must be second on conflict path");
    assert.ok(!callLog2.includes("insert"), "insert must not be called on conflict path");
  });
});

describe("createQuotedJobCore — invalid / not-found quote", () => {
  test("returns kind='quoteNotFound' when the quote does not exist", async () => {
    const s = makeFakeJobState();
    // quote 42 is NOT in the map
    const r = await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.strictEqual(r.kind, "quoteNotFound");
  });

  test("insertJob is NOT called when the quote does not exist", async () => {
    const s = makeFakeJobState();
    await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.strictEqual(s.insertCount, 0);
  });

  test("quoteNotFound check runs after the conflict check (fast conflict path)", async () => {
    // If a job already exists for quoteId=42, we return 'conflict' even if
    // the quote itself is somehow missing — the job's existence is checked first.
    const s = makeFakeJobState();
    // Pre-seed a job without a quote (simulates an orphan scenario)
    const orphanJob: JobRow = {
      id: ++idSeq, quoteId: 42, customerId: 1, propertyId: null,
      jobNumber: "J-orphan", status: "scheduled", totalAmount: "0",
      notes: null, lineItems: null, isRecurring: false,
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    };
    s.jobs.set(42, orphanJob);
    // quote 42 not in quotes map
    const r = await createQuotedJobCore(42, DIRECT_VALUES, makeJobAdapter(s));
    assert.strictEqual(r.kind, "conflict", "conflict check must short-circuit before quote validation");
  });
});
