import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createInvoiceCore,
  InvoiceValidationError,
  type InvoiceCreateAdapter,
  type InvoiceJobRow,
  type InvoiceRow,
} from "./invoice-core.ts";
import { createPaymentCore, type PaymentAdapter, type PaymentInvoiceRow, type PaymentRow } from "./payment-core.ts";
import {
  generateInvoiceCore,
  type BillingInvoiceRow,
  type GenerateInvoiceAdapter,
} from "./billing-core.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");

test("job invoice generation is idempotent and repeated attempts cannot insert twice", async () => {
  let stored: BillingInvoiceRow | null = null;
  let inserts = 0;
  const adapter: GenerateInvoiceAdapter = {
    acquireAdvisoryLock: async () => undefined,
    findJobById: async () => ({
      id: 9,
      customerId: 7,
      propertyId: 3,
      quoteId: null,
      jobNumber: "J-9",
      status: "completed",
      totalAmount: "125.50",
    }),
    findInvoiceByJobId: async () => stored,
    findQuoteById: async () => null,
    insertInvoice: async (values) => {
      inserts += 1;
      stored = {
        id: 11,
        ...values,
        paidAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      return stored;
    },
  };

  const first = await generateInvoiceCore(9, adapter, { now: NOW, invoiceNumber: "INV-9" });
  const repeated = await generateInvoiceCore(9, adapter, { now: NOW, invoiceNumber: "INV-9-DUP" });

  assert.equal(first.kind, "created");
  assert.equal(repeated.kind, "existing");
  assert.equal(repeated.kind === "existing" ? repeated.invoice.id : null, 11);
  assert.equal(first.kind === "created" ? first.invoice.dueDate : null, "2026-09-13");
  assert.equal(inserts, 1);
});

function job(id: number, customerId: number, totalAmount: string): InvoiceJobRow {
  return {
    id,
    customerId,
    jobNumber: `JOB-${id}`,
    propertyId: id + 100,
    scheduledDate: "2026-08-14",
    totalAmount,
    status: "completed",
  };
}

function makeInvoiceAdapter(jobs: InvoiceJobRow[]): {
  adapter: InvoiceCreateAdapter;
  invoices: InvoiceRow[];
  insertedJobs: Array<{ invoiceId: number; jobId: number }>;
  insertedLines: Array<Record<string, unknown>>;
} {
  const invoices: InvoiceRow[] = [];
  const insertedJobs: Array<{ invoiceId: number; jobId: number }> = [];
  const insertedLines: Array<Record<string, unknown>> = [];
  return {
    invoices,
    insertedJobs,
    insertedLines,
    adapter: {
      acquireJobLocks: async () => {},
      findJobsByIds: async (ids) => jobs.filter((candidate) => ids.includes(candidate.id)),
      insertInvoice: async (values) => {
        const invoice = {
          id: invoices.length + 1,
          ...values,
          paidAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        } as InvoiceRow;
        invoices.push(invoice);
        return invoice;
      },
      insertInvoiceJob: async (values) => { insertedJobs.push(values); },
      insertInvoiceLine: async (values) => { insertedLines.push(values); },
    },
  };
}

test("createInvoiceCore validates same-customer jobs and calculates exact totals", async () => {
  const fixture = makeInvoiceAdapter([job(1, 7, "10.00"), job(2, 7, "20.00")]);
  const created = await createInvoiceCore({
    customerId: 7,
    jobIds: [1, 2],
    lines: [
      { jobId: 1, description: "Exterior", quantity: "1.5", unitPrice: "2.22", discountAmount: "0.10", taxAmount: "0.07" },
      { jobId: 2, description: "Screens", quantity: "2", unitPrice: "3.00" },
      { description: "Travel", quantity: "1", unitPrice: "0.01" },
    ],
    dueDate: "2026-09-13",
  }, fixture.adapter, NOW);

  assert.equal(created.invoice.jobId, null);
  assert.equal(created.invoice.subtotal, "9.24");
  assert.equal(created.invoice.taxAmount, "0.07");
  assert.equal(created.invoice.totalAmount, "9.31");
  assert.equal(created.invoice.balanceDue, "9.31");
  assert.deepEqual(fixture.insertedJobs, [{ invoiceId: 1, jobId: 1 }, { invoiceId: 1, jobId: 2 }]);
  assert.equal(fixture.insertedLines.length, 3);
  assert.deepEqual(fixture.insertedLines.map((line) => line.lineTotal), ["3.30", "6.00", "0.01"]);
});

test("createInvoiceCore rejects duplicate jobs before writing", async () => {
  const fixture = makeInvoiceAdapter([job(1, 7, "10.00")]);
  await assert.rejects(
    createInvoiceCore({
      customerId: 7,
      jobIds: [1, 1],
      lines: [{ jobId: 1, description: "Service", quantity: 1, unitPrice: "10.00" }],
    }, fixture.adapter, NOW),
    (error: unknown) => error instanceof InvoiceValidationError && error.code === "duplicate_job",
  );
  assert.equal(fixture.invoices.length, 0);
  assert.equal(fixture.insertedJobs.length, 0);
  assert.equal(fixture.insertedLines.length, 0);
});

test("createInvoiceCore allows the same job on distinct invoices", async () => {
  const fixture = makeInvoiceAdapter([job(1, 7, "10.00")]);
  const input = {
    customerId: 7,
    jobIds: [1],
    lines: [{ jobId: 1, description: "Service", quantity: 1, unitPrice: "10.00" }],
  };

  const first = await createInvoiceCore(input, fixture.adapter, NOW);
  const second = await createInvoiceCore(input, fixture.adapter, NOW);

  assert.equal(first.invoice.id, 1);
  assert.equal(second.invoice.id, 2);
  assert.deepEqual(fixture.insertedJobs, [
    { invoiceId: 1, jobId: 1 },
    { invoiceId: 2, jobId: 1 },
  ]);
});

test("createInvoiceCore rejects cross-customer jobs atomically", async () => {
  const fixture = makeInvoiceAdapter([job(1, 7, "10.00"), job(2, 8, "20.00")]);
  await assert.rejects(
    createInvoiceCore({
      customerId: 7,
      jobIds: [1, 2],
      lines: [
        { jobId: 1, description: "One", quantity: 1, unitPrice: "10.00" },
        { jobId: 2, description: "Two", quantity: 1, unitPrice: "20.00" },
      ],
    }, fixture.adapter, NOW),
    (error: unknown) => error instanceof InvoiceValidationError && error.code === "customer_mismatch",
  );
  assert.equal(fixture.invoices.length, 0);
  assert.equal(fixture.insertedJobs.length, 0);
  assert.equal(fixture.insertedLines.length, 0);
});

test("general-only invoice lines are valid and preserve immutable snapshots", async () => {
  const fixture = makeInvoiceAdapter([]);
  const created = await createInvoiceCore({
    customerId: 7,
    lines: [{ description: "Ad hoc hard-water treatment", quantity: "0.5", unitPrice: "100.00", taxAmount: "8.25" }],
  }, fixture.adapter, NOW);
  assert.equal(created.invoice.jobId, null);
  assert.equal(fixture.insertedJobs.length, 0);
  assert.deepEqual(fixture.insertedLines[0], {
    invoiceId: 1,
    jobId: null,
    description: "Ad hoc hard-water treatment",
    quantity: "0.5",
    unitPrice: "100.00",
    discountAmount: "0.00",
    taxAmount: "8.25",
    lineTotal: "58.25",
    sortOrder: 0,
  });
});

test("direct invoice creation preserves the selected property snapshot", async () => {
  const fixture = makeInvoiceAdapter([]);
  const created = await createInvoiceCore({
    customerId: 7,
    propertyId: 222,
    lines: [{ description: "Property service", quantity: 1, unitPrice: "25.00" }],
  }, fixture.adapter, NOW);

  assert.equal(created.invoice.propertyId, 222);
});

test("invoice line snapshots do not change when source inputs mutate later", async () => {
  const sourceJob = job(1, 7, "10.00");
  const sourceLine = {
    jobId: 1,
    description: "Original service",
    quantity: "1.5",
    unitPrice: "10.00",
    discountAmount: "1.00",
    taxAmount: "0.25",
  };
  const fixture = makeInvoiceAdapter([sourceJob]);
  await createInvoiceCore({
    customerId: 7,
    jobIds: [sourceJob.id],
    lines: [sourceLine],
  }, fixture.adapter, NOW);

  sourceJob.totalAmount = "999.99";
  sourceJob.status = "cancelled";
  sourceLine.description = "Mutated service";
  sourceLine.quantity = "9";
  sourceLine.unitPrice = "99.99";
  sourceLine.discountAmount = "0";
  sourceLine.taxAmount = "9.99";

  assert.deepEqual(fixture.insertedLines[0], {
    invoiceId: 1,
    jobId: 1,
    description: "Original service",
    quantity: "1.5",
    unitPrice: "10.00",
    discountAmount: "1.00",
    taxAmount: "0.25",
    lineTotal: "14.25",
    sortOrder: 0,
  });
});

test("payment allocation can target a multi-job invoice with no legacy job id", async () => {
  const invoice: PaymentInvoiceRow = {
    id: 41,
    customerId: 7,
    totalAmount: "150.00",
    amountPaid: "0.00",
    balanceDue: "150.00",
    status: "draft",
    dueDate: null,
    serviceDate: null,
    paidAt: null,
  };
  let updated = invoice;
  const payment: PaymentRow = {
    id: 51,
    customerId: 7,
    amount: "100.00",
    allocatedAmount: "0.00",
    unappliedAmount: "100.00",
    paymentDate: "2026-08-14",
    method: "manual",
    reference: null,
    note: null,
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const adapter: PaymentAdapter = {
    acquireInvoiceLocks: async () => {},
    acquireCustomerOpenInvoiceLocks: async () => {},
    acquirePaymentLock: async () => {},
    findInvoicesByIds: async () => [updated],
    findOpenInvoicesByCustomer: async () => [updated],
    insertPayment: async () => payment,
    findPaymentById: async () => payment,
    insertAllocation: async (values) => ({ id: 1, ...values, amount: values.amount, createdAt: NOW, createdBy: null }),
    updatePayment: async (_id, values) => ({ ...payment, ...values }),
    updateInvoice: async (_id, values) => {
      updated = { ...updated, ...values };
      return updated;
    },
  };
  const result = await createPaymentCore({
    customerId: 7,
    amount: "100.00",
    paymentDate: "2026-08-14",
    method: "manual",
    mode: "manual",
    allocations: [{ invoiceId: 41, amount: "100.00" }],
  }, adapter);
  assert.ok("payment" in result);
  assert.equal(updated.amountPaid, "100.00");
  assert.equal(updated.balanceDue, "50.00");
});