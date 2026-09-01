/**
 * Orchestration for lead → customer conversion.
 *
 * All DB I/O is delegated to a ConvertLeadAdapter so that:
 *   • Production code runs with DrizzleTxLeadAdapter (routes/leads.ts), which
 *     binds every operation to a single Drizzle transaction that holds the
 *     pg_advisory_xact_lock for the entire operation.
 *   • Tests run with in-memory fakes; concurrency tests replace the lock with
 *     an AsyncMutex.withLock() wrapper around the convertLeadCore call.
 *
 * No drizzle / pg imports here.
 */
import {
  customerLifecycleStatus,
  normalizeAccountType,
} from "./account-lifecycle.ts";
import type { DuplicateCandidate, StrongMatchType } from "./lead-duplicate-candidates.ts";

// ── Advisory-lock namespace ───────────────────────────────────────────────────

/**
 * classid discriminator for the TWO-argument form of pg_advisory_xact_lock.
 *
 * PostgreSQL keeps the (int4, int4) advisory-lock keyspace fully separate from
 * the single-int8 keyspace used by quoteAdvisoryLockKey (quote-convert.ts), so
 * lead locks — taken as pg_advisory_xact_lock(LEAD_LOCK_CLASSID, leadId) —
 * can NEVER collide with quote/job locks regardless of id magnitude.
 *
 * MUST be used by every code path that serialises on a lead (currently only
 * POST /leads/:id/convert) so future endpoints share the same namespace.
 */
export const LEAD_LOCK_CLASSID = 2;

/**
 * Returns the [classid, objid] pair to pass to pg_advisory_xact_lock(int, int)
 * for a given leadId.
 */
export function leadAdvisoryLockKey(leadId: number): readonly [number, number] {
  return [LEAD_LOCK_CLASSID, leadId] as const;
}

// ── Minimal row-shape interfaces ──────────────────────────────────────────────
// Structural subsets of the actual Drizzle inferred types — only the fields
// this module needs. DrizzleTxLeadAdapter satisfies these structurally.

export interface LeadRow {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  source: string | null;
  notes: string | null;
  clientType: string | null;
  status: string;
  convertedCustomerId: number | null;
}

export interface CustomerRow {
  id: number;
  firstName: string;
  lastName: string;
  status?: string | null;
  lifecycleStatus?: string | null;
}

export interface CustomerInsertValues {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  source: string | null;
  notes: string | null;
  clientType: string;
  status: string;
  lifecycleStatus: string;
  customerDate: string;
}

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * All DB operations required by convertLeadCore.
 *
 * Implementation contract:
 *   acquireAdvisoryLock MUST be the first method called. If it throws,
 *   convertLeadCore propagates the error immediately without calling any
 *   other method.
 *
 * Production (DrizzleTxLeadAdapter):
 *   All methods share a single Drizzle transaction. acquireAdvisoryLock runs
 *   `SELECT pg_advisory_xact_lock(leadAdvisoryLockKey(leadId))` inside that
 *   transaction — exclusive, blocks competing callers, released on
 *   commit/rollback. Pool exhaustion makes db.transaction() throw before the
 *   adapter exists → hard 500, never a silent lock bypass.
 *
 * Test (FakeLeadAdapter):
 *   acquireAdvisoryLock is a noop; serialisation is provided by wrapping the
 *   convertLeadCore call in AsyncMutex.withLock(). Tests separately verify
 *   call ordering and that a lock failure aborts without mutation.
 */
export interface ConvertLeadAdapter<C extends CustomerRow = CustomerRow> {
  /** FIRST call. Throw propagates; no other method is invoked. */
  acquireAdvisoryLock(leadId: number): Promise<void>;

  /** Return the lead, or null if not found. */
  findLeadById(leadId: number): Promise<LeadRow | null>;

  /** Return the customer, or null if not found. */
  findCustomerById(customerId: number): Promise<C | null>;

  /** Find strong normalized email/phone candidates without mutating data. */
  findStrongDuplicateCandidates(lead: LeadRow): Promise<DuplicateCandidate[]>;

  /** Lock an explicitly selected target row before evaluating its lifecycle. */
  lockCustomerRow(customerId: number): Promise<void>;

  /** Insert and return the new customer row. */
  insertCustomer(values: CustomerInsertValues): Promise<C>;

  /** Promote a prospect customer to the canonical customer/active state. */
  promoteCustomerToActive(customerId: number): Promise<C>;

  /**
   * Atomically set lead.status = "won" and lead.convertedCustomerId.
   * MUST throw if the update affects zero rows (e.g. the lead was deleted
   * concurrently) so the shared transaction rolls back the customer insert.
   */
  markLeadConverted(leadId: number, customerId: number): Promise<void>;
}

// ── Outcome type ──────────────────────────────────────────────────────────────

export type ConvertLeadOutcome<C extends CustomerRow = CustomerRow> =
  | { kind: "notFound" }
  | {
      /**
       * Lead was already converted; the linked customer is returned.
       * Caller responds 200 and MUST NOT write a second activity log.
       */
      kind: "existing";
      customer: C;
    }
  | {
      /**
       * convertedCustomerId points at a customer that no longer exists.
       * Data-integrity error — caller returns 409 rather than silently
       * creating a duplicate customer.
       */
      kind: "staleLink";
      convertedCustomerId: number;
    }
  | {
      kind: "created";
      customer: C;
      /** Post-commit activity-log data (logging failure can't roll back the insert). */
      forLog: { leadId: number; customerId: number; audit: ConversionAudit };
    }
  | {
      kind: "linked";
      customer: C;
      /** Post-commit activity-log data for an explicit existing-account link. */
      forLog: { leadId: number; customerId: number; audit: ConversionAudit };
    }
  | {
      kind: "targetNotFound";
      customerId: number;
    }
  | {
      kind: "blockedTarget";
      customerId: number;
      lifecycleStatus: "inactive" | "archived";
    }
  | {
      kind: "conflict";
      existingCustomerId: number;
      requestedCustomerId: number;
    }
  | {
      kind: "duplicateCandidates";
      candidates: DuplicateCandidate[];
    };

export interface ConvertLeadOptions {
  createSeparateAccount?: boolean;
  overrideReason?: string | null;
}

interface ConversionAudit {
  candidateCount: number;
  matchTypes: StrongMatchType[];
  selectedCustomerId?: number;
  overrideReason?: string | null;
}

// ── Core orchestration ────────────────────────────────────────────────────────

/**
 * Convert a lead to a customer — idempotent, advisory-lock-serialised.
 *
 * Fixed step order:
 *   1. acquireAdvisoryLock  — FIRST; throws on failure → caller gets 500
 *   2. findLeadById         — 404 if missing
 *   3. idempotency check    — convertedCustomerId set → return that customer
 *      (staleLink if the customer row has vanished)
 *   4. findStrongDuplicateCandidates — exact normalized email/phone only
 *   5. insertCustomer       — customerDate = provided business date
 *   6. markLeadConverted    — status "won" + convertedCustomerId, atomically
 *
 * The lead row is preserved; no properties/contacts are created.
 */
export async function convertLeadCore<C extends CustomerRow>(
  leadId: number,
  customerDate: string,
  adapter: ConvertLeadAdapter<C>,
  requestedCustomerId: number | null = null,
  options: ConvertLeadOptions = {},
): Promise<ConvertLeadOutcome<C>> {
  // Step 1 ── Advisory lock ──────────────────────────────────────────────────
  await adapter.acquireAdvisoryLock(leadId);

  // Step 2 ── Load lead ──────────────────────────────────────────────────────
  const lead = await adapter.findLeadById(leadId);
  if (!lead) return { kind: "notFound" };

  // Step 3 ── Idempotency check (inside lock) ────────────────────────────────
  if (lead.convertedCustomerId !== null) {
    if (
      requestedCustomerId !== null
      && requestedCustomerId !== lead.convertedCustomerId
    ) {
      return {
        kind: "conflict",
        existingCustomerId: lead.convertedCustomerId,
        requestedCustomerId,
      };
    }
    const customer = await adapter.findCustomerById(lead.convertedCustomerId);
    if (!customer) {
      return { kind: "staleLink", convertedCustomerId: lead.convertedCustomerId };
    }
    return { kind: "existing", customer };
  }

  const duplicateCandidates = await adapter.findStrongDuplicateCandidates(lead);
  const audit: ConversionAudit = {
    candidateCount: duplicateCandidates.length,
    matchTypes: [...new Set(duplicateCandidates.flatMap((candidate) => candidate.matchTypes))],
  };

  if (
    requestedCustomerId === null
    && duplicateCandidates.length > 0
    && (
      options.createSeparateAccount !== true
      || !options.overrideReason?.trim()
    )
  ) {
    return { kind: "duplicateCandidates", candidates: duplicateCandidates };
  }

  if (requestedCustomerId !== null) {
    await adapter.lockCustomerRow(requestedCustomerId);
    const target = await adapter.findCustomerById(requestedCustomerId);
    if (!target) return { kind: "targetNotFound", customerId: requestedCustomerId };

    const targetLifecycle = customerLifecycleStatus(target);
    if (targetLifecycle === "inactive" || targetLifecycle === "archived") {
      return {
        kind: "blockedTarget",
        customerId: requestedCustomerId,
        lifecycleStatus: targetLifecycle,
      };
    }

    const customer = targetLifecycle === "prospect"
      ? await adapter.promoteCustomerToActive(requestedCustomerId)
      : target;

    await adapter.markLeadConverted(leadId, customer.id);
    return {
      kind: "linked",
      customer,
      forLog: {
        leadId,
        customerId: customer.id,
        audit: { ...audit, selectedCustomerId: customer.id },
      },
    };
  }

  // Step 4 ── Create customer ────────────────────────────────────────────────
  const customer = await adapter.insertCustomer({
    firstName:      lead.firstName,
    lastName:       lead.lastName,
    email:          lead.email,
    phone:          lead.phone,
    billingAddress: lead.address,
    billingCity:    lead.city,
    billingState:   lead.state,
    billingZip:     lead.zip,
    source:         lead.source,
    notes:          lead.notes,
    clientType:     normalizeAccountType(lead.clientType),
    status:         "active",
    lifecycleStatus: "customer",
    customerDate,
  });

  // Step 5 ── Mark lead converted (same transaction in production) ───────────
  await adapter.markLeadConverted(leadId, customer.id);

  return {
    kind: "created",
    customer,
    forLog: {
      leadId,
      customerId: customer.id,
      audit: {
        ...audit,
        overrideReason: options.createSeparateAccount ? options.overrideReason?.trim() ?? null : null,
      },
    },
  };
}
