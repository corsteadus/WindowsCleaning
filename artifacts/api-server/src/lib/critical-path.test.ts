import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type JobRow,
  type LineItemInput,
  type QuoteRow,
} from "./quote-convert.ts";
import {
  generateInvoiceCore,
  recordManualPaymentCore,
  type BillingInvoiceRow,
  type GenerateInvoiceAdapter,
  type ManualPaymentAdapter,
} from "./billing-core.ts";
import { buildJobStatusUpdate } from "./date.ts";
import { customerLifecycleStatus } from "./account-lifecycle.ts";
import { canonicalProspectCreateBody, prospectLifecycleTransition } from "./prospect-account.ts";
import { assertActiveEstimateRevision, assertDecisionTransition, deriveEstimateStatus } from "./estimate-lifecycle.ts";
import { buildLocationJobPlans, persistAcceptedEstimateJobsCore, type AcceptedEstimateSnapshot } from "./estimate-conversion.ts";

interface CustomerFixture {
  id: number;
  firstName: string;
  lastName: string;
}

interface PropertyFixture {
  id: number;
  customerId: number;
  address: string;
}

interface CriticalJobRow extends JobRow {
  completedAt: string | null;
}

interface CriticalPathState {
  customers: Map<number, CustomerFixture>;
  properties: Map<number, PropertyFixture>;
  quotes: Map<number, QuoteRow>;
  quoteStatuses: Map<number, string>;
  lineItems: Map<number, LineItemInput[]>;
  jobs: Map<number, CriticalJobRow>;
  invoices: Map<number, BillingInvoiceRow>;
  jobInsertCount: number;
  invoiceInsertCount: number;
  paymentUpdateCount: number;
}

const CREATED_AT = new Date("2026-08-14T15:00:00.000Z");
const PAYMENT_AT = new Date("2026-08-14T16:00:00.000Z");

/**
 * Models the transaction/advisory-lock serialization used by the production
 * routes. The core itself cannot release a lock because its adapter contract
 * represents one locked transaction; wrapping each call is the honest
 * in-memory equivalent.
 */
class AsyncMutex {
  #queue = Promise.resolve();

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn);
    this.#queue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function makeState(): CriticalPathState {
  return {
    customers: new Map(),
    properties: new Map(),
    quotes: new Map(),
    quoteStatuses: new Map(),
    lineItems: new Map(),
    jobs: new Map(),
    invoices: new Map(),
    jobInsertCount: 0,
    invoiceInsertCount: 0,
    paymentUpdateCount: 0,
  };
}

function makeBillingAdapters(state: CriticalPathState): {
  invoice: GenerateInvoiceAdapter;
  payment: ManualPaymentAdapter;
} {
  const invoice: GenerateInvoiceAdapter = {
    acquireAdvisoryLock: async () => {},
    findJobById: async (jobId) => {
      const job = state.jobs.get(jobId);
      return job
        ? {
            id: job.id,
            customerId: job.customerId,
            propertyId: job.propertyId,
            quoteId: job.quoteId,
            jobNumber: job.jobNumber,
            status: job.status,
            totalAmount: job.totalAmount,
          }
        : null;
    },
    findInvoiceByJobId: async (jobId) =>
      [...state.invoices.values()].find((candidate) => candidate.jobId === jobId) ?? null,
    findQuoteById: async (quoteId) => {
      const quote = state.quotes.get(quoteId);
      return quote ? { id: quote.id, totalAmount: quote.totalAmount } : null;
    },
    insertInvoice: async (values) => {
      state.invoiceInsertCount++;
      const invoice: BillingInvoiceRow = {
        id: 701,
        ...values,
        dueDate: values.dueDate,
        paidAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      };
      state.invoices.set(invoice.id, invoice);
      return invoice;
    },
  };

  const payment: ManualPaymentAdapter = {
    acquireAdvisoryLock: async () => {},
    findInvoiceById: async (invoiceId) => state.invoices.get(invoiceId) ?? null,
    markInvoicePaid: async (invoiceId, values) => {
      const current = state.invoices.get(invoiceId);
      assert.ok(current, "payment must target the generated invoice");
      state.paymentUpdateCount++;
      const updated = { ...current, ...values, updatedAt: PAYMENT_AT };
      state.invoices.set(invoiceId, updated);
      return updated;
    },
  };

  return { invoice, payment };
}

test("critical path: Prospect → scheduled/delivered/accepted estimate → job → invoice → payment", async () => {
  const state = makeState();

  // Customer/property creation fixture: the relationship is part of the path.
  const customer: CustomerFixture = { id: 101, firstName: "Avery", lastName: "Stone" };
  const property: PropertyFixture = {
    id: 201,
    customerId: customer.id,
    address: "101 Test Street",
  };
  state.customers.set(customer.id, customer);
  state.properties.set(property.id, property);
  const prospect = canonicalProspectCreateBody({ firstName: customer.firstName, lastName: customer.lastName }, "2026-08-10");
  assert.equal(customerLifecycleStatus(prospect), "prospect");
  assert.deepEqual(
    prospectLifecycleTransition(true, "prospect", "customer", "2026-08-14"),
    { customerDate: "2026-08-14", action: "prospect_converted" },
  );

  // Quote creation fixture with the same line-item shape consumed by the
  // production quote→job conversion core.
  const quote: QuoteRow = {
    id: 301,
    customerId: customer.id,
    leadId: null,
    propertyId: property.id,
    quoteNumber: "Q-critical-path",
    totalAmount: "325.00",
    notes: "Front and rear windows",
  };
  state.quotes.set(quote.id, quote);
  state.quoteStatuses.set(quote.id, "draft");
  state.lineItems.set(quote.id, [
    { description: "Exterior window cleaning", quantity: 1, unitPrice: 250, totalPrice: 250 },
    { description: "Screen cleaning", quantity: 3, unitPrice: 25, totalPrice: 75 },
  ]);

  const appointment = { quoteId: quote.id, startsAt: CREATED_AT, propertyIds: [property.id] };
  assert.equal(deriveEstimateStatus({ hasAppointment: Boolean(appointment) }), "scheduled");
  const acceptedSnapshot: AcceptedEstimateSnapshot = {
    quote: {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      customerId: customer.id,
      leadId: null,
      totalAmount: 325,
      notes: quote.notes ?? null,
    },
    locations: [{
      id: property.id,
      name: "Primary",
      address: property.address,
      city: "Chicago",
      state: "IL",
      zip: "60601",
      notes: null,
    }],
    lineItems: state.lineItems.get(quote.id)!.map((line, index) => ({
      id: index + 1,
      serviceId: null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      totalPrice: line.totalPrice,
      propertyId: property.id,
      isUpsell: false,
      serviceNotes: null,
    })),
  };
  const locationPlans = buildLocationJobPlans(acceptedSnapshot, [{
    propertyId: property.id,
    scheduledDate: "2026-08-14",
    scheduledStartTime: "09:00",
    scheduledEndTime: "11:00",
    assignedUserIds: ["tech-1"],
  }]);
  const revision = { id: 401, quoteId: quote.id, revisionNumber: 1, snapshot: acceptedSnapshot };
  assert.equal(deriveEstimateStatus({ hasAppointment: true, hasFinalizedRevision: Boolean(revision) }), "draft");
  const delivery = { id: 402, quoteId: quote.id, revisionId: revision.id, sentAt: CREATED_AT, decision: null as string | null };
  assert.equal(deriveEstimateStatus({ sentAt: delivery.sentAt }), "sent");
  assertActiveEstimateRevision(delivery.revisionId, revision.id);
  assert.equal(assertDecisionTransition(delivery.decision, "accepted"), "apply");
  delivery.decision = "accepted";
  state.quoteStatuses.set(quote.id, "accepted");
  assert.equal(deriveEstimateStatus({ decision: delivery.decision }), "accepted");
  assert.equal(locationPlans.length, 1);
  assert.equal(locationPlans[0]?.totalAmount, 325);

  const conversionMutex = new AsyncMutex();
  const scheduledEvents: number[] = [];
  const persistAcceptedConversion = () => conversionMutex.withLock(() =>
    persistAcceptedEstimateJobsCore({
      quoteId: quote.id,
      customerId: customer.id,
      revisionId: revision.id,
      quoteNumber: quote.quoteNumber,
      snapshot: revision.snapshot,
      plans: locationPlans,
    }, {
      findJobsByQuoteId: async (id) => [...state.jobs.values()].filter((job) => job.quoteId === id),
      insertJob: async (values) => {
        state.jobInsertCount += 1;
        const job = {
          id: 501,
          ...values,
          recurringFrequency: null,
          techNotes: null,
          completedAt: null,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        } as CriticalJobRow;
        state.jobs.set(job.id, job);
        return job;
      },
      recordScheduledEvent: async (job) => {
        scheduledEvents.push(job.id);
      },
    }),
  );
  const conversion = await persistAcceptedConversion();
  assert.equal(conversion.kind, "created");
  assert.equal(state.quoteStatuses.get(quote.id), "accepted");
  assert.equal(state.jobs.size, 1);
  assert.equal(state.jobInsertCount, 1);
  assert.deepEqual(scheduledEvents, [501]);
  assert.equal(conversion.jobs[0]?.customerId, customer.id);
  assert.equal(conversion.jobs[0]?.propertyId, property.id);
  assert.equal(
    JSON.parse(conversion.jobs[0]?.lineItems ?? "[]").length,
    2,
  );

  const canonicalJob = state.jobs.get(501);
  assert.ok(canonicalJob);
  const [conversionRetryA, conversionRetryB] = await Promise.all([
    persistAcceptedConversion(),
    persistAcceptedConversion(),
  ]);
  assert.equal(conversionRetryA.kind, "existing");
  assert.equal(conversionRetryB.kind, "existing");
  assert.equal(conversionRetryA.jobs[0]?.id, canonicalJob.id);
  assert.equal(conversionRetryB.jobs[0]?.quoteId, quote.id);
  assert.equal(state.jobInsertCount, 1);
  assert.deepEqual(state.jobs.get(canonicalJob.id), canonicalJob);

  const job = state.jobs.get(501);
  assert.ok(job);
  const completion = buildJobStatusUpdate("completed", "2026-08-14", CREATED_AT);
  assert.equal(completion.kind, "updated");
  if (completion.kind === "updated") {
    state.jobs.set(job.id, { ...job, status: completion.status, completedAt: completion.completedAt });
  }
  assert.equal(state.jobs.get(job.id)?.status, "completed");
  assert.equal(state.jobs.get(job.id)?.completedAt, CREATED_AT.toISOString());

  const adapters = makeBillingAdapters(state);
  const generated = await generateInvoiceCore(job.id, adapters.invoice, {
    now: CREATED_AT,
    invoiceNumber: "INV-critical-path",
  });
  assert.equal(generated.kind, "created");
  assert.equal(state.invoices.size, 1);
  assert.equal(state.invoiceInsertCount, 1);
  assert.equal(generated.kind === "created" ? generated.invoice.totalAmount : null, "325");
  assert.equal(generated.kind === "created" ? generated.invoice.balanceDue : null, "325");
  assert.equal(generated.kind === "created" ? generated.invoice.status : null, "draft");
  assert.equal(generated.kind === "created" ? generated.invoice.jobId : null, job.id);
  assert.equal(generated.kind === "created" ? generated.invoice.propertyId : null, property.id);
  assert.equal(generated.kind === "created" ? generated.invoice.createdAt : null, CREATED_AT);
  assert.equal(generated.kind === "created" ? generated.invoice.updatedAt : null, CREATED_AT);

  const canonicalInvoice = state.invoices.get(701);
  assert.ok(canonicalInvoice);
  const invoiceRetryMutex = new AsyncMutex();
  const [invoiceRetryA, invoiceRetryB] = await Promise.all([
    invoiceRetryMutex.withLock(() => generateInvoiceCore(job.id, adapters.invoice, {
      now: CREATED_AT,
      invoiceNumber: "INV-critical-path",
    })),
    invoiceRetryMutex.withLock(() => generateInvoiceCore(job.id, adapters.invoice, {
      now: CREATED_AT,
      invoiceNumber: "INV-critical-path",
    })),
  ]);
  assert.equal(invoiceRetryA.kind, "existing");
  assert.equal(invoiceRetryB.kind, "existing");
  assert.equal(invoiceRetryA.kind === "existing" ? invoiceRetryA.invoice.id : null, canonicalInvoice.id);
  assert.equal(invoiceRetryB.kind === "existing" ? invoiceRetryB.invoice.jobId : null, job.id);
  assert.equal(state.invoiceInsertCount, 1);
  assert.deepEqual(state.invoices.get(canonicalInvoice.id), canonicalInvoice);
  assert.equal(state.invoices.get(canonicalInvoice.id)?.createdAt, CREATED_AT);
  assert.equal(state.invoices.get(canonicalInvoice.id)?.updatedAt, CREATED_AT);

  const paid = await recordManualPaymentCore(701, adapters.payment, PAYMENT_AT);
  assert.equal(paid.kind, "updated");
  assert.equal(state.paymentUpdateCount, 1);
  assert.equal(state.invoices.get(701)?.status, "paid");
  assert.equal(state.invoices.get(701)?.amountPaid, "325");
  assert.equal(state.invoices.get(701)?.balanceDue, "0");
  assert.equal(state.invoices.get(701)?.paidAt, PAYMENT_AT.toISOString());
  assert.equal(state.invoices.get(701)?.updatedAt, PAYMENT_AT);

  const paidInvoice = state.invoices.get(701);
  assert.ok(paidInvoice);
  const paymentRetryMutex = new AsyncMutex();
  const [paymentRetryA, paymentRetryB] = await Promise.all([
    paymentRetryMutex.withLock(() => recordManualPaymentCore(701, adapters.payment, new Date("2026-08-14T17:00:00.000Z"))),
    paymentRetryMutex.withLock(() => recordManualPaymentCore(701, adapters.payment, new Date("2026-08-14T18:00:00.000Z"))),
  ]);
  assert.equal(paymentRetryA.kind, "existing");
  assert.equal(paymentRetryB.kind, "existing");
  assert.equal(paymentRetryA.kind === "existing" ? paymentRetryA.invoice.id : null, paidInvoice.id);
  assert.equal(paymentRetryB.kind === "existing" ? paymentRetryB.invoice.amountPaid : null, "325");
  assert.equal(state.paymentUpdateCount, 1);
  assert.deepEqual(state.invoices.get(paidInvoice.id), paidInvoice);
  assert.equal(state.invoices.get(paidInvoice.id)?.paidAt, PAYMENT_AT.toISOString());
  assert.equal(state.invoices.get(paidInvoice.id)?.updatedAt, PAYMENT_AT);
});