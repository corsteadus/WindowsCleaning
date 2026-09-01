/**
 * Unit tests for quote → job conversion helpers and orchestration.
 *
 * Run with:
 *   node --test --experimental-strip-types src/lib/quote-convert.test.ts
 *
 * No database required.  convertQuoteCore is exercised through a FakeConvert-
 * Adapter that uses in-memory Maps.  Concurrency tests wrap each call in an
 * AsyncMutex.withLock() to simulate the serialisation that
 * pg_advisory_xact_lock provides in production.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildJobLineItemsJson,
  convertQuoteCore,
  type ConvertAdapter,
  type JobRow,
  type QuoteRow,
  type LeadRow,
  type LineItemInput,
} from "./quote-convert.ts";

// ── AsyncMutex ─────────────────────────────────────────────────────────────────
//
// Simulates the serialisation guarantee of pg_advisory_xact_lock held inside a
// DB transaction: only one holder runs at a time; subsequent callers queue up
// and begin only after the current holder finishes (success OR failure).
//
// Usage in concurrency tests:
//   const mutex = new AsyncMutex();
//   await Promise.all([
//     mutex.withLock(() => convertQuoteCore(id, adapterA)),
//     mutex.withLock(() => convertQuoteCore(id, adapterB)),
//   ]);
// Both calls share the same in-memory state.  Because the mutex serialises
// them, the second call always finds the job inserted by the first.

class AsyncMutex {
  #queue = Promise.resolve();

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn);
    // Always advance the queue — even if fn() rejects — so later callers proceed.
    this.#queue = next.then(() => undefined, () => undefined);
    return next;
  }
}

// ── In-memory state and fake adapter ──────────────────────────────────────────

interface FakeState {
  jobs:            Map<number, JobRow>;
  quotes:          Map<number, QuoteRow>;
  leads:           Map<number, LeadRow>;
  lineItems:       Map<number, LineItemInput[]>;
  approvedQuotes:  Set<number>;
  insertCount:     number;
  setApprovedCount: number;
  /** Names of adapter methods in the order they were called. */
  callLog: string[];
}

function makeFakeState(): FakeState {
  return {
    jobs:            new Map(),
    quotes:          new Map(),
    leads:           new Map(),
    lineItems:       new Map(),
    approvedQuotes:  new Set(),
    insertCount:     0,
    setApprovedCount: 0,
    callLog:         [],
  };
}

// Module-level counter: each fake job gets a unique id across all test cases.
let jobIdSeq = 0;

function makeAdapter(
  state: FakeState,
  opts: { lockThrows?: boolean } = {},
): ConvertAdapter {
  return {
    acquireAdvisoryLock: async (quoteId) => {
      state.callLog.push(`lock:${quoteId}`);
      if (opts.lockThrows) throw new Error("simulated: lock acquisition failed");
    },
    findJobByQuoteId: async (quoteId) => {
      state.callLog.push(`findJob:${quoteId}`);
      return state.jobs.get(quoteId) ?? null;
    },
    findQuoteById:  async (id) => state.quotes.get(id) ?? null,
    findLeadById:   async (id) => state.leads.get(id) ?? null,
    fetchLineItems: async (quoteId) => state.lineItems.get(quoteId) ?? [],
    setQuoteApproved: async (quoteId) => {
      state.setApprovedCount++;
      state.approvedQuotes.add(quoteId);
    },
    insertJob: async (values) => {
      state.insertCount++;
      const job: JobRow = {
        id:       ++jobIdSeq,
        ...values,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      };
      state.jobs.set(values.quoteId, job);
      return job;
    },
  };
}

// ── Test-data builders ─────────────────────────────────────────────────────────

const CUSTOMER_QUOTE: QuoteRow = {
  id:          42,
  customerId:  7,
  leadId:      null,
  propertyId:  3,
  quoteNumber: "Q-42",
  totalAmount: "250.00",
  notes:       "paint the fence",
};

const LEAD_QUOTE: QuoteRow = {
  id:          99,
  customerId:  null,
  leadId:      5,
  propertyId:  null,
  quoteNumber: "Q-99",
  totalAmount: "100.00",
  notes:       null,
};

const CONVERTED_LEAD:   LeadRow = { id: 5, convertedCustomerId: 12 };
const UNCONVERTED_LEAD: LeadRow = { id: 5, convertedCustomerId: null };

/** Build a FakeState seeded with one quote, an optional lead, and optional line items. */
function stateWith(quote: QuoteRow, lead?: LeadRow, items?: LineItemInput[]): FakeState {
  const s = makeFakeState();
  s.quotes.set(quote.id, quote);
  if (lead)  s.leads.set(lead.id, lead);
  if (items) s.lineItems.set(quote.id, items);
  return s;
}

/** Unwrap job from a created/existing outcome, or throw if another kind. */
function getJob(outcome: Awaited<ReturnType<typeof convertQuoteCore>>): JobRow {
  if (outcome.kind === "created" || outcome.kind === "existing") return outcome.job;
  throw new Error(`unexpected outcome kind: ${outcome.kind}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// buildJobLineItemsJson
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildJobLineItemsJson — empty input", () => {
  it("returns null for an empty array", () => {
    assert.strictEqual(buildJobLineItemsJson([]), null);
  });
});

describe("buildJobLineItemsJson — single item", () => {
  const item: LineItemInput = {
    description: "Window Cleaning - Exterior",
    quantity:    "2",
    unitPrice:   "150.00",
    totalPrice:  "300.00",
  };

  it("returns a non-null string",     () => { assert.ok(buildJobLineItemsJson([item]) !== null); });
  it("produces valid JSON",            () => { assert.doesNotThrow(() => JSON.parse(buildJobLineItemsJson([item])!)); });

  it("result is an array with one element", () => {
    const result = JSON.parse(buildJobLineItemsJson([item])!) as unknown[];
    assert.strictEqual(result.length, 1);
  });

  it("description is preserved exactly", () => {
    const [row] = JSON.parse(buildJobLineItemsJson([item])!) as Array<Record<string, unknown>>;
    assert.strictEqual(row.description, "Window Cleaning - Exterior");
  });

  it("quantity is a JS number (not a string)", () => {
    const [row] = JSON.parse(buildJobLineItemsJson([item])!) as Array<Record<string, unknown>>;
    assert.strictEqual(typeof row.quantity, "number");
    assert.strictEqual(row.quantity, 2);
  });

  it("unitPrice is a JS number with correct value", () => {
    const [row] = JSON.parse(buildJobLineItemsJson([item])!) as Array<Record<string, unknown>>;
    assert.strictEqual(typeof row.unitPrice, "number");
    assert.strictEqual(row.unitPrice, 150);
  });

  it("totalPrice is a JS number with correct value", () => {
    const [row] = JSON.parse(buildJobLineItemsJson([item])!) as Array<Record<string, unknown>>;
    assert.strictEqual(typeof row.totalPrice, "number");
    assert.strictEqual(row.totalPrice, 300);
  });
});

describe("buildJobLineItemsJson — numeric inputs", () => {
  it("accepts JS number values in addition to DB string numerics", () => {
    const item: LineItemInput = { description: "Interior", quantity: 3, unitPrice: 75, totalPrice: 225 };
    const [row] = JSON.parse(buildJobLineItemsJson([item])!) as Array<Record<string, unknown>>;
    assert.strictEqual(row.quantity, 3);
    assert.strictEqual(row.unitPrice, 75);
    assert.strictEqual(row.totalPrice, 225);
  });
});

describe("buildJobLineItemsJson — multiple items", () => {
  const items: LineItemInput[] = [
    { description: "Exterior windows", quantity: "1", unitPrice: "200.00", totalPrice: "200.00" },
    { description: "Screen cleaning",  quantity: "2", unitPrice: "25.00",  totalPrice: "50.00"  },
    { description: "Hard water treat", quantity: "1", unitPrice: "80.00",  totalPrice: "80.00"  },
  ];

  it("result has the correct item count", () => {
    const result = JSON.parse(buildJobLineItemsJson(items)!) as unknown[];
    assert.strictEqual(result.length, 3);
  });

  it("preserves order", () => {
    const result = JSON.parse(buildJobLineItemsJson(items)!) as Array<Record<string, unknown>>;
    assert.strictEqual(result[0].description, "Exterior windows");
    assert.strictEqual(result[1].description, "Screen cleaning");
    assert.strictEqual(result[2].description, "Hard water treat");
  });

  it("all amounts are numbers, not strings", () => {
    const result = JSON.parse(buildJobLineItemsJson(items)!) as Array<Record<string, unknown>>;
    for (const row of result) {
      assert.strictEqual(typeof row.quantity,   "number", `quantity of '${row.description}' must be a number`);
      assert.strictEqual(typeof row.unitPrice,  "number", `unitPrice of '${row.description}' must be a number`);
      assert.strictEqual(typeof row.totalPrice, "number", `totalPrice of '${row.description}' must be a number`);
    }
  });

  it("amounts are preserved correctly", () => {
    const result = JSON.parse(buildJobLineItemsJson(items)!) as Array<Record<string, unknown>>;
    assert.strictEqual(result[0].totalPrice, 200);
    assert.strictEqual(result[1].unitPrice,  25);
    assert.strictEqual(result[2].totalPrice, 80);
  });
});

describe("buildJobLineItemsJson — edge cases", () => {
  it("handles zero-priced items", () => {
    const item: LineItemInput = { description: "Free add-on", quantity: "1", unitPrice: "0", totalPrice: "0" };
    const [row] = JSON.parse(buildJobLineItemsJson([item])!) as Array<Record<string, unknown>>;
    assert.strictEqual(row.unitPrice,  0);
    assert.strictEqual(row.totalPrice, 0);
  });

  it("handles decimal quantities", () => {
    const item: LineItemInput = { description: "Partial job", quantity: "0.5", unitPrice: "100.00", totalPrice: "50.00" };
    const [row] = JSON.parse(buildJobLineItemsJson([item])!) as Array<Record<string, unknown>>;
    assert.strictEqual(row.quantity, 0.5);
  });

  it("handles items with long descriptions", () => {
    const desc = "A".repeat(500);
    const item: LineItemInput = { description: desc, quantity: "1", unitPrice: "10", totalPrice: "10" };
    const [row] = JSON.parse(buildJobLineItemsJson([item])!) as Array<Record<string, unknown>>;
    assert.strictEqual(row.description, desc);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// convertQuoteCore — first conversion
// ═══════════════════════════════════════════════════════════════════════════════

describe("convertQuoteCore — first conversion", () => {
  it("returns kind='created'", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    assert.strictEqual(outcome.kind, "created");
  });

  it("insertJob is called exactly once", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    await convertQuoteCore(42, makeAdapter(s));
    assert.strictEqual(s.insertCount, 1);
  });

  it("setQuoteApproved is called exactly once", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    await convertQuoteCore(42, makeAdapter(s));
    assert.strictEqual(s.setApprovedCount, 1);
  });

  it("returned job has the correct quoteId", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    assert.strictEqual(getJob(outcome).quoteId, 42);
  });

  it("creates a coherent unscheduled legacy job with no appointment fields", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    const job = getJob(outcome) as JobRow & {
      scheduledDate: null; scheduledStartTime: null; scheduledEndTime: null; estimatedDuration: null;
    };
    assert.strictEqual(job.status, "unscheduled");
    assert.strictEqual(job.scheduledDate, null);
    assert.strictEqual(job.scheduledStartTime, null);
    assert.strictEqual(job.scheduledEndTime, null);
    assert.strictEqual(job.estimatedDuration, null);
  });

  it("forLog carries the correct customerId", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    assert.ok(outcome.kind === "created");
    assert.strictEqual(outcome.forLog.customerId, 7);
  });

  it("forLog carries null leadId for a customer-owned quote", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    assert.ok(outcome.kind === "created");
    assert.strictEqual(outcome.forLog.leadId, null);
  });

  it("forLog carries the correct quoteNumber", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    assert.ok(outcome.kind === "created");
    assert.strictEqual(outcome.forLog.quoteNumber, "Q-42");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// convertQuoteCore — idempotency (repeat call)
// ═══════════════════════════════════════════════════════════════════════════════

describe("convertQuoteCore — idempotency (repeat call)", () => {
  it("second call returns kind='existing'", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    await convertQuoteCore(42, makeAdapter(s));
    const second = await convertQuoteCore(42, makeAdapter(s));
    assert.strictEqual(second.kind, "existing");
  });

  it("second call returns the same job id as the first", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    const first  = await convertQuoteCore(42, makeAdapter(s));
    const second = await convertQuoteCore(42, makeAdapter(s));
    assert.strictEqual(getJob(first).id, getJob(second).id);
  });

  it("insertJob is NOT called a second time (total stays at 1)", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    await convertQuoteCore(42, makeAdapter(s));
    await convertQuoteCore(42, makeAdapter(s));
    assert.strictEqual(s.insertCount, 1);
  });

  it("setQuoteApproved is NOT called a second time (total stays at 1)", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    await convertQuoteCore(42, makeAdapter(s));
    await convertQuoteCore(42, makeAdapter(s));
    assert.strictEqual(s.setApprovedCount, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// convertQuoteCore — concurrent calls, same quoteId
// ═══════════════════════════════════════════════════════════════════════════════

describe("convertQuoteCore — concurrent calls, same quoteId", () => {
  // The AsyncMutex serialises both calls, matching what pg_advisory_xact_lock
  // does in production.  The second call therefore always finds the job already
  // inserted by the first and takes the idempotency path.

  it("exactly one insertJob call across two concurrent requests", async () => {
    const s     = stateWith(CUSTOMER_QUOTE);
    const mutex = new AsyncMutex();

    await Promise.all([
      mutex.withLock(() => convertQuoteCore(42, makeAdapter(s))),
      mutex.withLock(() => convertQuoteCore(42, makeAdapter(s))),
    ]);

    assert.strictEqual(s.insertCount, 1, "insertJob must fire exactly once");
  });

  it("both concurrent callers receive the same job id", async () => {
    const s     = stateWith(CUSTOMER_QUOTE);
    const mutex = new AsyncMutex();

    const [r1, r2] = await Promise.all([
      mutex.withLock(() => convertQuoteCore(42, makeAdapter(s))),
      mutex.withLock(() => convertQuoteCore(42, makeAdapter(s))),
    ]);

    assert.strictEqual(
      getJob(r1).id,
      getJob(r2).id,
      "both callers must receive the same job id",
    );
  });

  it("one result is 'created', the other is 'existing'", async () => {
    const s     = stateWith(CUSTOMER_QUOTE);
    const mutex = new AsyncMutex();

    const [r1, r2] = await Promise.all([
      mutex.withLock(() => convertQuoteCore(42, makeAdapter(s))),
      mutex.withLock(() => convertQuoteCore(42, makeAdapter(s))),
    ]);

    const kinds = new Set([r1.kind, r2.kind]);
    assert.ok(kinds.has("created"),  "one result must be 'created'");
    assert.ok(kinds.has("existing"), "one result must be 'existing'");
  });

  it("setQuoteApproved fires exactly once across both concurrent calls", async () => {
    const s     = stateWith(CUSTOMER_QUOTE);
    const mutex = new AsyncMutex();

    await Promise.all([
      mutex.withLock(() => convertQuoteCore(42, makeAdapter(s))),
      mutex.withLock(() => convertQuoteCore(42, makeAdapter(s))),
    ]);

    assert.strictEqual(s.setApprovedCount, 1, "quote status must be set exactly once");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// convertQuoteCore — concurrent calls, different quoteIds
// ═══════════════════════════════════════════════════════════════════════════════

describe("convertQuoteCore — concurrent calls, different quoteIds", () => {
  it("calls for different quoteIds each produce their own job without deduplicating", async () => {
    const q10: QuoteRow = { id: 10, customerId: 1, leadId: null, propertyId: null, quoteNumber: "Q-10", totalAmount: "50.00",  notes: null };
    const q20: QuoteRow = { id: 20, customerId: 2, leadId: null, propertyId: null, quoteNumber: "Q-20", totalAmount: "75.00",  notes: null };

    // Both quotes live in the same shared state
    const s = makeFakeState();
    s.quotes.set(10, q10);
    s.quotes.set(20, q20);

    // Per-quoteId mutexes — matches production behaviour where the advisory
    // lock is keyed on quoteId, so different quotes do not block each other.
    const mutex10 = new AsyncMutex();
    const mutex20 = new AsyncMutex();

    const [r1, r2] = await Promise.all([
      mutex10.withLock(() => convertQuoteCore(10, makeAdapter(s))),
      mutex20.withLock(() => convertQuoteCore(20, makeAdapter(s))),
    ]);

    assert.strictEqual(r1.kind, "created",  "quote 10 must produce a new job");
    assert.strictEqual(r2.kind, "created",  "quote 20 must produce a new job");
    assert.strictEqual(s.insertCount, 2,    "two separate jobs must be created");
    assert.notStrictEqual(
      getJob(r1).quoteId,
      getJob(r2).quoteId,
      "the two jobs must reference different quotes",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// convertQuoteCore — line item preservation
// ═══════════════════════════════════════════════════════════════════════════════

describe("convertQuoteCore — line item preservation", () => {
  const ITEMS: LineItemInput[] = [
    { description: "Exterior wash",  quantity: "1", unitPrice: "150.00", totalPrice: "150.00" },
    { description: "Screen clean",   quantity: "4", unitPrice: "12.50",  totalPrice: "50.00"  },
    { description: "Hard water wax", quantity: "1", unitPrice: "75.00",  totalPrice: "75.00"  },
  ];

  it("job.lineItems is non-null when quote has line items", async () => {
    const s = stateWith(CUSTOMER_QUOTE, undefined, ITEMS);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    assert.notStrictEqual(getJob(outcome).lineItems, null);
  });

  it("lineItems JSON parses to the correct item count", async () => {
    const s = stateWith(CUSTOMER_QUOTE, undefined, ITEMS);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    const parsed = JSON.parse(getJob(outcome).lineItems!) as unknown[];
    assert.strictEqual(parsed.length, 3);
  });

  it("lineItems JSON preserves fetchLineItems order", async () => {
    const s = stateWith(CUSTOMER_QUOTE, undefined, ITEMS);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    const parsed = JSON.parse(getJob(outcome).lineItems!) as Array<Record<string, unknown>>;
    assert.strictEqual(parsed[0].description, "Exterior wash");
    assert.strictEqual(parsed[1].description, "Screen clean");
    assert.strictEqual(parsed[2].description, "Hard water wax");
  });

  it("lineItems JSON stores all amounts as JS numbers (not strings)", async () => {
    const s = stateWith(CUSTOMER_QUOTE, undefined, ITEMS);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    const parsed = JSON.parse(getJob(outcome).lineItems!) as Array<Record<string, unknown>>;
    for (const row of parsed) {
      assert.strictEqual(typeof row.quantity,   "number", `quantity of '${row.description}' must be number`);
      assert.strictEqual(typeof row.unitPrice,  "number", `unitPrice of '${row.description}' must be number`);
      assert.strictEqual(typeof row.totalPrice, "number", `totalPrice of '${row.description}' must be number`);
    }
  });

  it("lineItems amounts are correct", async () => {
    const s = stateWith(CUSTOMER_QUOTE, undefined, ITEMS);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    const parsed = JSON.parse(getJob(outcome).lineItems!) as Array<Record<string, unknown>>;
    assert.strictEqual(parsed[0].unitPrice,  150);
    assert.strictEqual(parsed[1].quantity,   4);
    assert.strictEqual(parsed[2].totalPrice, 75);
  });

  it("job.lineItems is null when quote has no line items", async () => {
    const s = stateWith(CUSTOMER_QUOTE, undefined, []);
    const outcome = await convertQuoteCore(42, makeAdapter(s));
    assert.strictEqual(getJob(outcome).lineItems, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// convertQuoteCore — advisory lock ordering
// ═══════════════════════════════════════════════════════════════════════════════

describe("convertQuoteCore — advisory lock ordering", () => {
  it("acquireAdvisoryLock is called before findJobByQuoteId", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    await convertQuoteCore(42, makeAdapter(s));

    const lockIdx    = s.callLog.findIndex((e) => e.startsWith("lock:"));
    const findJobIdx = s.callLog.findIndex((e) => e.startsWith("findJob:"));

    assert.ok(lockIdx    !== -1, "acquireAdvisoryLock must be called");
    assert.ok(findJobIdx !== -1, "findJobByQuoteId must be called");
    assert.ok(
      lockIdx < findJobIdx,
      `lock (pos ${lockIdx}) must precede findJob (pos ${findJobIdx}); log: [${s.callLog.join(", ")}]`,
    );
  });

  it("acquireAdvisoryLock is also called first on the idempotency path", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    // Pre-seed an existing job
    await convertQuoteCore(42, makeAdapter(s));
    s.callLog.length = 0; // reset log for second call

    await convertQuoteCore(42, makeAdapter(s));

    const lockIdx    = s.callLog.findIndex((e) => e.startsWith("lock:"));
    const findJobIdx = s.callLog.findIndex((e) => e.startsWith("findJob:"));
    assert.ok(lockIdx < findJobIdx, "lock must precede findJob even on idempotency path");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// convertQuoteCore — lock failure aborts safely
// ═══════════════════════════════════════════════════════════════════════════════

describe("convertQuoteCore — lock failure aborts safely", () => {
  it("rejects when acquireAdvisoryLock throws", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    await assert.rejects(
      () => convertQuoteCore(42, makeAdapter(s, { lockThrows: true })),
      /simulated: lock acquisition failed/,
    );
  });

  it("insertJob is NOT called when lock acquisition fails", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    await convertQuoteCore(42, makeAdapter(s, { lockThrows: true })).catch(() => {});
    assert.strictEqual(s.insertCount, 0, "no job must be inserted when lock fails");
  });

  it("setQuoteApproved is NOT called when lock acquisition fails", async () => {
    const s = stateWith(CUSTOMER_QUOTE);
    await convertQuoteCore(42, makeAdapter(s, { lockThrows: true })).catch(() => {});
    assert.strictEqual(s.setApprovedCount, 0, "quote status must not be changed when lock fails");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// convertQuoteCore — error and not-found cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("convertQuoteCore — error and not-found cases", () => {
  it("returns kind='notFound' when the quote does not exist", async () => {
    const s = makeFakeState(); // no quotes seeded
    const outcome = await convertQuoteCore(999, makeAdapter(s));
    assert.strictEqual(outcome.kind, "notFound");
  });

  it("returns kind='error' when quote has no customerId and no leadId", async () => {
    const orphan: QuoteRow = {
      id: 55, customerId: null, leadId: null, propertyId: null,
      quoteNumber: "Q-55", totalAmount: "0.00", notes: null,
    };
    const s = makeFakeState();
    s.quotes.set(55, orphan);
    const outcome = await convertQuoteCore(55, makeAdapter(s));
    assert.strictEqual(outcome.kind, "error");
    const msg = outcome.kind === "error" ? outcome.message : "";
    assert.ok(msg.includes("no associated customer"), `message was: "${msg}"`);
  });

  it("lead-owned quote uses lead.convertedCustomerId as the job customerId", async () => {
    const s = stateWith(LEAD_QUOTE, CONVERTED_LEAD);
    const outcome = await convertQuoteCore(99, makeAdapter(s));
    assert.strictEqual(outcome.kind, "created");
    assert.strictEqual(getJob(outcome).customerId, 12);
  });

  it("forLog.leadId is non-null for lead-owned quotes", async () => {
    const s = stateWith(LEAD_QUOTE, CONVERTED_LEAD);
    const outcome = await convertQuoteCore(99, makeAdapter(s));
    assert.ok(outcome.kind === "created");
    assert.strictEqual(outcome.forLog.leadId, 5);
  });

  it("returns kind='error' when lead has not been converted to a customer", async () => {
    const s = stateWith(LEAD_QUOTE, UNCONVERTED_LEAD);
    const outcome = await convertQuoteCore(99, makeAdapter(s));
    assert.strictEqual(outcome.kind, "error");
    const msg = outcome.kind === "error" ? outcome.message : "";
    assert.ok(msg.includes("not been converted"), `message was: "${msg}"`);
  });

  it("returns kind='error' when lead record is not found in the DB", async () => {
    const s = stateWith(LEAD_QUOTE); // no lead seeded
    const outcome = await convertQuoteCore(99, makeAdapter(s));
    assert.strictEqual(outcome.kind, "error");
    const msg = outcome.kind === "error" ? outcome.message : "";
    assert.ok(msg.toLowerCase().includes("lead not found"), `message was: "${msg}"`);
  });
});
