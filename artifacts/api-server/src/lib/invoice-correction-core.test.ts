import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCreditNoteCore,
  InvoiceCorrectionValidationError,
  reissueInvoiceCore,
  voidInvoiceCore,
  type CorrectionCreditLineRow,
  type CorrectionInvoiceAdapter,
  type CorrectionInvoiceRow,
  type CorrectionLineRow,
} from "./invoice-correction-core.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");

function makeInvoice(overrides: Partial<CorrectionInvoiceRow> = {}): CorrectionInvoiceRow {
  return {
    id: 10,
    customerId: 7,
    jobId: null,
    propertyId: null,
    invoiceNumber: "INV-10",
    status: "sent",
    subtotal: "100.00",
    taxAmount: "0.00",
    totalAmount: "100.00",
    amountPaid: "0.00",
    balanceDue: "100.00",
    dueDate: "2026-09-13",
    paidAt: null,
    notes: "Original notes",
    lineItems: null,
    ...overrides,
  };
}

function makeAdapter(
  invoice = makeInvoice(),
  lines: CorrectionLineRow[] = [
    { id: 1, invoiceId: invoice.id, jobId: 101, description: "Exterior", quantity: "1", unitPrice: "60.00", discountAmount: "0.00", taxAmount: "0.00", lineTotal: "60.00", sortOrder: 0 },
    { id: 2, invoiceId: invoice.id, jobId: null, description: "Travel", quantity: "1", unitPrice: "40.00", discountAmount: "0.00", taxAmount: "0.00", lineTotal: "40.00", sortOrder: 1 },
  ],
) {
  const state = {
    invoice,
    lines,
    creditLines: [] as CorrectionCreditLineRow[],
    voids: 0,
    notes: [] as Array<Record<string, unknown>>,
    insertedCreditLines: [] as Array<Record<string, unknown>>,
    replacement: null as CorrectionInvoiceRow | null,
    replacementJobs: [] as Array<{ invoiceId: number; jobId: number }>,
    replacementLines: [] as Array<Record<string, unknown>>,
    reissue: null as { id: number; sourceInvoiceId: number; replacementInvoiceId: number } | null,
    reissues: [] as Array<{ id: number; sourceInvoiceId: number; replacementInvoiceId: number }>,
    allocations: false,
  };
  let nextId = 100;
  const adapter: CorrectionInvoiceAdapter = {
    acquireInvoiceLock: async () => {},
    findInvoiceById: async (id) => id === state.invoice.id ? state.invoice : state.replacement,
    hasPaymentAllocations: async () => state.allocations,
    findInvoiceLines: async (id) => id === state.invoice.id
      ? [...state.lines]
      : [...state.replacementLines] as CorrectionLineRow[],
    findCreditLines: async () => state.creditLines,
    insertVoid: async () => { state.voids += 1; return { id: 1 }; },
    insertCreditNote: async (values) => {
      const record = { id: nextId++, ...values };
      state.notes.push(record);
      return record;
    },
    insertCreditLine: async (values) => {
      state.insertedCreditLines.push(values);
      state.creditLines.push({ invoiceLineId: values.invoiceLineId, creditAmount: values.creditAmount });
    },
    updateInvoice: async (id, values) => {
      if (id === state.invoice.id) state.invoice = { ...state.invoice, ...values };
      else if (state.replacement) state.replacement = { ...state.replacement, ...values };
      return id === state.invoice.id ? state.invoice : state.replacement!;
    },
    findLinkedJobIds: async () => [101, 102],
    findActiveReissue: async (sourceInvoiceId) => state.reissues.find((record) => record.sourceInvoiceId === sourceInvoiceId) ?? null,
    insertReplacementInvoice: async (values) => {
      state.replacement = { id: state.replacement ? state.replacement.id + 1 : 20, ...values, paidAt: null, createdAt: NOW, updatedAt: NOW };
      return state.replacement;
    },
    insertReplacementJob: async (values) => { state.replacementJobs.push(values); },
    insertReplacementLine: async (values) => { state.replacementLines.push(values); },
    insertReissue: async (values) => {
      state.reissue = { id: nextId, ...values };
      state.reissues.push(state.reissue);
      nextId++;
      return { id: state.reissue.id };
    },
  };
  return { adapter, state };
}

test("credit notes support mixed job and general lines with exact remaining balance", async () => {
  const fixture = makeAdapter(makeInvoice({ amountPaid: "20.00", balanceDue: "80.00" }));
  const result = await createCreditNoteCore(10, "Customer adjustment", [
    { invoiceLineId: 1, amount: "10.01" },
    { amount: "14.99", description: "General courtesy credit" },
  ], "CN-10-1", fixture.adapter, "Kyle");

  assert.equal(result.totalAmount, "25.00");
  assert.equal(result.invoice.status, "partially_credited");
  assert.equal(result.invoice.balanceDue, "55.00");
  assert.deepEqual(fixture.state.insertedCreditLines.map((line) => line.creditAmount), ["10.01", "14.99"]);
  assert.equal(fixture.state.insertedCreditLines[0].description, "Exterior");
  assert.equal(fixture.state.notes[0].reason, "Customer adjustment");
});

test("full credit closes an invoice and over-credit writes nothing", async () => {
  const fixture = makeAdapter();
  const result = await createCreditNoteCore(10, "Full service reversal", [
    { invoiceLineId: 1, amount: "60.00" },
    { invoiceLineId: 2, amount: "40.00" },
  ], "CN-10-2", fixture.adapter);
  assert.equal(result.invoice.status, "credited");
  assert.equal(result.invoice.balanceDue, "0.00");

  const beforeNotes = fixture.state.notes.length;
  await assert.rejects(
    createCreditNoteCore(10, "Too much", [{ amount: "0.01" }], "CN-10-3", fixture.adapter),
    (error: unknown) => error instanceof InvoiceCorrectionValidationError && error.code === "invoice_not_creditable",
  );
  assert.equal(fixture.state.notes.length, beforeNotes);
});

test("repeated partial credits respect source-line availability while invoice balance remains", async () => {
  const fixture = makeAdapter();
  await createCreditNoteCore(10, "First partial credit", [{ invoiceLineId: 1, amount: "10.00" }], "CN-10-5", fixture.adapter);
  await createCreditNoteCore(10, "Second partial credit", [{ invoiceLineId: 1, amount: "50.00" }], "CN-10-6", fixture.adapter);

  const beforeNotes = fixture.state.notes.length;
  await assert.rejects(
    createCreditNoteCore(10, "Line exceeds source availability", [{ invoiceLineId: 1, amount: "0.01" }], "CN-10-7", fixture.adapter),
    (error: unknown) => error instanceof InvoiceCorrectionValidationError && error.code === "line_over_credit",
  );
  assert.equal(fixture.state.invoice.balanceDue, "40.00");
  assert.equal(fixture.state.notes.length, beforeNotes);
});

test("unpaid invoices split excess credit into customer credit without changing cash paid", async () => {
  const fixture = makeAdapter(makeInvoice({ balanceDue: "5.00" }));
  const result = await createCreditNoteCore(10, "Paid invoice adjustment", [{ amount: "5.01" }], "CN-10-4", fixture.adapter);
  assert.equal(result.invoice.balanceDue, "0.00");
  assert.equal(result.invoice.status, "credited");
  assert.equal(result.invoice.amountPaid, "0.00");
  assert.equal(fixture.state.notes[0].balanceReductionAmount, "5.00");
  assert.equal(fixture.state.notes[0].customerCreditAmount, "0.01");
  assert.equal(fixture.state.insertedCreditLines.length, 1);
});

test("partly paid invoices preserve cash paid while splitting exact credit-note cents", async () => {
  const fixture = makeAdapter(makeInvoice({
    status: "partial",
    amountPaid: "37.00",
    balanceDue: "63.00",
  }));
  const result = await createCreditNoteCore(10, "Part-paid adjustment", [{ amount: "64.01" }], "CN-10-8", fixture.adapter);
  assert.equal(result.invoice.amountPaid, "37.00");
  assert.equal(result.invoice.balanceDue, "0.00");
  assert.equal(result.invoice.status, "credited");
  assert.equal(fixture.state.notes[0].balanceReductionAmount, "63.00");
  assert.equal(fixture.state.notes[0].customerCreditAmount, "1.01");
});

test("fully paid invoices issue only customer credit and preserve cash fields", async () => {
  const fixture = makeAdapter(makeInvoice({
    status: "paid",
    amountPaid: "100.00",
    balanceDue: "0.00",
    paidAt: "2026-08-14T12:00:00.000Z",
  }));
  const result = await createCreditNoteCore(10, "Paid adjustment", [{ amount: "1.23" }], "CN-10-9", fixture.adapter);
  assert.equal(result.invoice.amountPaid, "100.00");
  assert.equal(result.invoice.balanceDue, "0.00");
  assert.equal(result.invoice.status, "credited");
  assert.equal(result.invoice.paidAt, "2026-08-14T12:00:00.000Z");
  assert.equal(fixture.state.notes[0].balanceReductionAmount, "0.00");
  assert.equal(fixture.state.notes[0].customerCreditAmount, "1.23");
});

test("void requires a reason and only permits an unpaid invoice with no allocations", async () => {
  const fixture = makeAdapter();
  await assert.rejects(
    voidInvoiceCore(10, "", fixture.adapter),
    (error: unknown) => error instanceof InvoiceCorrectionValidationError && error.code === "reason_required",
  );
  const result = await voidInvoiceCore(10, "Duplicate invoice", fixture.adapter, "Kyle");
  assert.equal(result.invoice.status, "voided");
  assert.equal(result.invoice.balanceDue, "0.00");
  assert.equal(fixture.state.voids, 1);

  const paid = makeAdapter(makeInvoice({ status: "paid", amountPaid: "100.00", balanceDue: "0.00" }));
  await assert.rejects(
    voidInvoiceCore(10, "Paid", paid.adapter),
    (error: unknown) => error instanceof InvoiceCorrectionValidationError && error.code === "invoice_has_payments",
  );
});

test("reissue copies the original immutable snapshots and only allows one active replacement", async () => {
  const fixture = makeAdapter(makeInvoice({ status: "voided", balanceDue: "0.00" }));
  const sourceBefore = structuredClone(fixture.state.invoice);
  const linesBefore = structuredClone(fixture.state.lines);
  const result = await reissueInvoiceCore(10, "Corrected address", "INV-REISSUE-10", fixture.adapter, "Kyle");
  assert.equal(result.replacement.invoiceNumber, "INV-REISSUE-10");
  assert.equal(result.replacement.status, "draft");
  assert.equal(result.replacement.totalAmount, "100.00");
  assert.equal(result.replacement.balanceDue, "100.00");
  assert.equal(result.replacement.customerId, sourceBefore.customerId);
  assert.equal(result.replacement.dueDate, sourceBefore.dueDate);
  assert.equal(result.replacement.notes, sourceBefore.notes);
  assert.equal(result.replacement.subtotal, sourceBefore.subtotal);
  assert.equal(result.replacement.taxAmount, sourceBefore.taxAmount);
  assert.equal(result.replacement.totalAmount, sourceBefore.totalAmount);
  assert.deepEqual(fixture.state.replacementJobs, [
    { invoiceId: 20, jobId: 101 },
    { invoiceId: 20, jobId: 102 },
  ]);
  assert.deepEqual(fixture.state.replacementLines.map((line) => line.description), ["Exterior", "Travel"]);
  assert.deepEqual(fixture.state.lines, linesBefore);
  assert.deepEqual(fixture.state.invoice, sourceBefore);

  await assert.rejects(
    reissueInvoiceCore(10, "Another replacement", "INV-REISSUE-11", fixture.adapter),
    (error: unknown) => error instanceof InvoiceCorrectionValidationError && error.code === "active_replacement_exists",
  );
  assert.equal(fixture.state.replacementLines.length, 2);
});

test("legacy invoice without snapshot rows receives a fallback reissue snapshot", async () => {
  const fixture = makeAdapter(makeInvoice({ jobId: 77, status: "voided" }), []);
  const result = await reissueInvoiceCore(10, "Legacy correction", "INV-LEGACY-REISSUE", fixture.adapter);
  assert.equal(result.replacement.jobId, null);
  assert.equal(fixture.state.replacementLines[0].description, "Invoice line");
  assert.equal(fixture.state.replacementLines[0].creditAmount, "100.00");
});

test("fully credited invoices can start a replacement chain", async () => {
  const fixture = makeAdapter(makeInvoice({ status: "credited", balanceDue: "0.00" }));
  const result = await reissueInvoiceCore(10, "Replacement after full credit", "INV-CREDITED-REISSUE", fixture.adapter);
  assert.equal(result.replacement.status, "draft");
  assert.equal(result.replacement.balanceDue, "100.00");
});

test("a replacement can be corrected and reissued again", async () => {
  const fixture = makeAdapter(makeInvoice({ status: "voided", balanceDue: "0.00" }));
  const first = await reissueInvoiceCore(10, "First replacement", "INV-CHAIN-1", fixture.adapter);
  fixture.state.replacement = { ...first.replacement, status: "voided", balanceDue: "0.00" };
  const second = await reissueInvoiceCore(first.replacement.id, "Second replacement", "INV-CHAIN-2", fixture.adapter);
  assert.equal(second.replacement.invoiceNumber, "INV-CHAIN-2");
  assert.equal(fixture.state.reissues.length, 2);
  assert.equal(fixture.state.reissues[0].sourceInvoiceId, 10);
  assert.equal(fixture.state.reissues[1].sourceInvoiceId, first.replacement.id);
});