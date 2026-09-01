/**
 * Orchestration and pure helpers for quote → job conversion.
 *
 * All DB I/O is delegated to a ConvertAdapter so that:
 *   • Production code runs with DrizzleTxAdapter (routes/quotes.ts), which
 *     binds every operation to a single Drizzle transaction that holds the
 *     pg_advisory_xact_lock for the entire operation.
 *   • Tests run with in-memory fakes; concurrency tests replace the lock with
 *     an AsyncMutex.withLock() wrapper around the convertQuoteCore call.
 *
 * No drizzle / pg imports here.
 */

// ── Minimal row-shape interfaces ──────────────────────────────────────────────
// Structural subsets of the actual Drizzle inferred types — only the fields
// this module needs.  DrizzleTxAdapter satisfies these structurally.

export interface QuoteRow {
  id: number;
  customerId: number | null;
  leadId: number | null;
  propertyId: number | null;
  quoteNumber: string;
  totalAmount: string;
  notes: string | null;
}

export interface LeadRow {
  id: number;
  convertedCustomerId: number | null;
}

export interface JobRow {
  id: number;
  quoteId: number | null;
  customerId: number;
  propertyId: number | null;
  jobNumber: string;
  status: string;
  totalAmount: string;
  notes: string | null;
  lineItems: string | null;
  isRecurring: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface LineItemInput {
  description: string;
  /** DB numeric columns arrive as strings; numbers are also accepted. */
  quantity: string | number;
  unitPrice: string | number;
  totalPrice: string | number;
}

export interface JobInsertValues {
  customerId: number;
  propertyId: number | null;
  quoteId: number;
  jobNumber: string;
  status: string;
  totalAmount: string;
  notes: string | null;
  lineItems: string | null;
  isRecurring: boolean;
  /** Legacy conversion has no appointment data; keep that state explicit. */
  scheduledDate: null;
  scheduledStartTime: null;
  scheduledEndTime: null;
  estimatedDuration: null;
}

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * All DB operations required by convertQuoteCore.
 *
 * Implementation contract:
 *   acquireAdvisoryLock MUST be the first method called.  If it throws,
 *   convertQuoteCore propagates the error immediately without calling any
 *   other method.
 *
 * Production (DrizzleTxAdapter):
 *   All methods share a single Drizzle transaction.  acquireAdvisoryLock runs
 *   `SELECT pg_advisory_xact_lock(quoteId)` inside that transaction.
 *   PostgreSQL guarantees the lock is exclusive and blocks competing callers;
 *   it is released when the transaction commits or rolls back.
 *
 *   If db.transaction() cannot obtain a pool connection, it throws before
 *   DrizzleTxAdapter is instantiated — the request fails with 500 and
 *   acquireAdvisoryLock is never reached.  Pool exhaustion therefore causes
 *   a hard failure, NOT a silent lock bypass.
 *
 *   Residual risk (no schema migration required to fix, but not closed here):
 *   POST /jobs accepts an arbitrary quoteId and is NOT protected by this lock.
 *   A direct call to POST /jobs { quoteId: X } can create a second job for
 *   quote X without triggering the idempotency guard.  A UNIQUE constraint
 *   on jobs.quote_id would close this gap permanently.
 *
 * Test (FakeConvertAdapter):
 *   acquireAdvisoryLock is a noop; correctness of serialisation is instead
 *   provided by wrapping the convertQuoteCore call in AsyncMutex.withLock().
 *   Tests separately verify that acquireAdvisoryLock is called before
 *   findJobByQuoteId and that a throw from acquireAdvisoryLock aborts the
 *   operation without any DB mutation.
 */
export interface ConvertAdapter {
  /**
   * Acquire a transaction-scoped exclusive advisory lock for quoteId.
   * Called as the FIRST statement in convertQuoteCore.
   * A throw here propagates to the caller; no other method is invoked.
   */
  acquireAdvisoryLock(quoteId: number): Promise<void>;

  /** Return the existing job for this quote, or null if none exists yet. */
  findJobByQuoteId(quoteId: number): Promise<JobRow | null>;

  /** Return the quote, or null if not found. */
  findQuoteById(quoteId: number): Promise<QuoteRow | null>;

  /** Return the lead, or null if not found. */
  findLeadById(leadId: number): Promise<LeadRow | null>;

  /** Return line items in ascending sort order. */
  fetchLineItems(quoteId: number): Promise<LineItemInput[]>;

  /**
   * Set quote.status = "approved".
   * Called only when a new job is being created (not on idempotency path).
   */
  setQuoteApproved(quoteId: number): Promise<void>;

  /** Insert and return the new job row. */
  insertJob(values: JobInsertValues): Promise<JobRow>;
}

// ── Outcome type ──────────────────────────────────────────────────────────────

export type ConvertOutcome =
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "existing"; job: JobRow }
  | {
      kind: "created";
      job: JobRow;
      /**
       * Data for post-commit activity logging.
       * Carried out of the transaction so a logging failure cannot roll
       * back the already-committed job.
       */
      forLog: {
        customerId: number;
        leadId: number | null;
        quoteNumber: string;
        jobNumber: string;
      };
    };

// ── Pure helper ───────────────────────────────────────────────────────────────

/**
 * Converts quote line-item rows to the JSON string stored in jobs.lineItems.
 *
 * jobs.lineItems is a plain text column that holds a JSON array:
 *   [{ description, quantity, unitPrice, totalPrice }, ...]
 * where all numeric fields are JavaScript numbers (not strings).
 *
 * Returns null when the quote has no line items (consistent with manually-
 * created jobs that have no line items).
 */
export function buildJobLineItemsJson(lineItems: LineItemInput[]): string | null {
  if (lineItems.length === 0) return null;
  return JSON.stringify(
    lineItems.map((li) => ({
      description: li.description,
      quantity:    Number(li.quantity),
      unitPrice:   Number(li.unitPrice),
      totalPrice:  Number(li.totalPrice),
    })),
  );
}

// ── Shared advisory-lock key ──────────────────────────────────────────────────

/**
 * Returns the pg_advisory_lock integer key for a given quoteId.
 *
 * BOTH quote-conversion (POST /quotes/:id/convert) and direct quote-linked
 * job creation (POST /jobs with quoteId) MUST pass this value to
 * pg_advisory_xact_lock so the two endpoints share the same lock namespace
 * and cannot race each other.
 *
 * Keeping this in one place ensures neither endpoint can silently drift to a
 * different key.
 */
export function quoteAdvisoryLockKey(quoteId: number): number {
  return quoteId;
}

// ── Direct job creation (quote-linked path) ───────────────────────────────────

/**
 * Full set of fields passed by POST /jobs, minus quoteId (supplied separately
 * as the first arg to createQuotedJobCore).
 */
export interface DirectJobInsertValues {
  customerId: number;
  propertyId: number | null;
  crewId: number | null;
  recurringPlanId: number | null;
  jobNumber: string;
  status: string;
  serviceType: string | null;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  estimatedDuration: number | null;
  isRecurring: boolean;
  recurringFrequency: string | null;
  totalAmount: string;
  notes: string | null;
  lineItems: string | null;
}

/**
 * DB operations required by createQuotedJobCore.
 * Uses the same advisory-lock key as ConvertAdapter — both must call
 * quoteAdvisoryLockKey(quoteId) in acquireAdvisoryLock.
 */
export interface CreateQuotedJobAdapter {
  /**
   * Acquire pg_advisory_xact_lock(quoteAdvisoryLockKey(quoteId)).
   * MUST be called first; throw propagates immediately without any DB mutation.
   */
  acquireAdvisoryLock(quoteId: number): Promise<void>;
  /** Return any existing job for this quoteId, or null. */
  findJobByQuoteId(quoteId: number): Promise<JobRow | null>;
  /** Return the quote record, or null if not found. */
  findQuoteById(quoteId: number): Promise<QuoteRow | null>;
  /** Insert the job and return the new row. */
  insertJob(values: DirectJobInsertValues & { quoteId: number }): Promise<JobRow>;
}

export type CreateQuotedJobOutcome =
  | { kind: "quoteNotFound" }
  | { kind: "conflict"; existingJobId: number }
  | { kind: "created"; job: JobRow };

/**
 * Guard for POST /jobs when the caller provides a quoteId.
 *
 * Enforces one-job-per-quote using the same advisory lock as convertQuoteCore.
 * Step order:
 *   1. acquireAdvisoryLock  — FIRST; throw → 500, no mutation
 *   2. findJobByQuoteId     — 409 Conflict if a job already exists
 *   3. findQuoteById        — 404 if the quote does not exist
 *   4. insertJob            — only on first create
 *
 * Returns:
 *   "created"      — new job created
 *   "conflict"     — job already exists; caller returns 409
 *   "quoteNotFound"— quote does not exist; caller returns 404
 */
export async function createQuotedJobCore(
  quoteId: number,
  jobValues: DirectJobInsertValues,
  adapter: CreateQuotedJobAdapter,
): Promise<CreateQuotedJobOutcome> {
  // Step 1 ── Advisory lock (same key as convertQuoteCore) ───────────────────
  await adapter.acquireAdvisoryLock(quoteId);

  // Step 2 ── Conflict check (inside lock) ───────────────────────────────────
  const existing = await adapter.findJobByQuoteId(quoteId);
  if (existing) return { kind: "conflict", existingJobId: existing.id };

  // Step 3 ── Validate quote exists (prevent dangling association) ────────────
  const quote = await adapter.findQuoteById(quoteId);
  if (!quote) return { kind: "quoteNotFound" };

  // Step 4 ── Insert ──────────────────────────────────────────────────────────
  const job = await adapter.insertJob({ ...jobValues, quoteId });
  return { kind: "created", job };
}

// ── Core orchestration ────────────────────────────────────────────────────────

/**
 * Convert a quote to a job — idempotent, advisory-lock-serialised.
 *
 * Fixed step order:
 *   1. acquireAdvisoryLock  — FIRST; throws on failure → caller gets 500
 *   2. findJobByQuoteId     — idempotency check (inside lock)
 *   3. findQuoteById
 *   4. resolve customerId   — findLeadById if quote is lead-owned
 *   5. fetchLineItems
 *   6. setQuoteApproved     — only on first conversion
 *   7. insertJob            — only on first conversion
 *
 * Returns:
 *   "existing"  — job already created; caller returns 200, skips activity log
 *   "created"   — new job created; caller logs activity, returns 200
 *   "notFound"  — caller returns 404
 *   "error"     — caller returns 400 with message
 */
export async function convertQuoteCore(
  quoteId: number,
  adapter: ConvertAdapter,
): Promise<ConvertOutcome> {
  // Step 1 ── Advisory lock ──────────────────────────────────────────────────
  // MUST be first. Any throw here propagates before any DB mutation.
  await adapter.acquireAdvisoryLock(quoteId);

  // Step 2 ── Idempotency check (inside lock) ────────────────────────────────
  const existingJob = await adapter.findJobByQuoteId(quoteId);
  if (existingJob) {
    return { kind: "existing", job: existingJob };
  }

  // Step 3 ── Load quote ─────────────────────────────────────────────────────
  const quote = await adapter.findQuoteById(quoteId);
  if (!quote) {
    return { kind: "notFound" };
  }

  // Step 4 ── Resolve customerId ─────────────────────────────────────────────
  // Lead-owned quotes require the lead to be converted first.
  // We do NOT backfill quote.customerId — leadId preserves the audit trail.
  let customerId = quote.customerId;
  if (!customerId) {
    if (!quote.leadId) {
      return { kind: "error", message: "Quote has no associated customer or lead" };
    }
    const lead = await adapter.findLeadById(quote.leadId);
    if (!lead) {
      return { kind: "error", message: "Associated lead not found" };
    }
    if (lead.convertedCustomerId) {
      customerId = lead.convertedCustomerId;
    } else {
      return {
        kind: "error",
        message:
          "This quote is linked to a lead that has not been converted to a customer yet. Please convert the lead first.",
      };
    }
  }

  // Step 5 ── Line items ─────────────────────────────────────────────────────
  const lineItemRows = await adapter.fetchLineItems(quoteId);
  const lineItemsJson = buildJobLineItemsJson(lineItemRows);

  // Step 6 ── Mark quote approved ────────────────────────────────────────────
  await adapter.setQuoteApproved(quoteId);

  // Step 7 ── Insert job ─────────────────────────────────────────────────────
  const jobNumber = `J-${Date.now()}`;
  const job = await adapter.insertJob({
    customerId,
    propertyId:  quote.propertyId,
    quoteId,
    jobNumber,
    status:      "unscheduled",
    // In this legacy path conversion is not scheduling. Keep both workflow
    // status and appointment fields coherent rather than claiming it is booked.
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    estimatedDuration: null,
    totalAmount: quote.totalAmount,
    notes:       quote.notes,
    lineItems:   lineItemsJson,
    isRecurring: false,
  });

  return {
    kind: "created",
    job,
    forLog: {
      customerId,
      leadId:      quote.leadId,
      quoteNumber: quote.quoteNumber,
      jobNumber,
    },
  };
}
