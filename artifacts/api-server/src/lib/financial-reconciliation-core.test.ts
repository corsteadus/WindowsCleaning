import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFinancialReconciliation,
  localDateFromInstant,
  moneyToCents,
  resolveFinancialReconciliationRange,
  type ReconciliationSnapshot,
} from "./financial-reconciliation-core.ts";

const range = {
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  timezone: "America/Chicago",
};

test("reconciliation defaults explicitly to Chicago at the frozen UTC boundary", () => {
  const resolved = resolveFinancialReconciliationRange({
    now: new Date("2026-08-30T02:48:00Z"),
  });
  assert.deepEqual(resolved, {
    startDate: "2026-08-01",
    endDate: "2026-08-29",
    timezone: "America/Chicago",
  });
});

function snapshot(): ReconciliationSnapshot {
  return {
    payments: [
      {
        id: 1,
        customerId: 7,
        amount: "100.00",
        allocatedAmount: "25.00",
        unappliedAmount: "75.00",
        paymentDate: "2026-08-01",
        method: "check",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      {
        id: 2,
        customerId: 8,
        amount: "25.25",
        allocatedAmount: "25.25",
        unappliedAmount: "0.00",
        paymentDate: "2026-08-02",
        method: "cash",
        createdAt: "2026-08-02T12:00:00.000Z",
      },
    ],
    paymentAllocations: [
      { id: 1, paymentId: 1, invoiceId: 10, amount: "20.00", createdAt: "2026-08-01T12:01:00.000Z" },
      { id: 2, paymentId: 2, invoiceId: 11, amount: "25.25", createdAt: "2026-08-02T12:01:00.000Z" },
    ],
    sources: [
      {
        sourceKey: "payment:1",
        sourceType: "payment",
        sourceId: 1,
        customerId: 7,
        originalAmount: "100.00",
        availableAmount: "75.00",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      {
        sourceKey: "credit_note:10",
        sourceType: "credit_note",
        sourceId: 10,
        customerId: 7,
        originalAmount: "5.00",
        availableAmount: "0.00",
        createdAt: "2026-08-03T12:00:00.000Z",
      },
      {
        sourceKey: "credit_note:20",
        sourceType: "credit_note",
        sourceId: 20,
        customerId: 8,
        originalAmount: "9.00",
        availableAmount: "5.00",
        createdAt: "2026-08-03T12:00:00.000Z",
      },
    ],
    applications: [
      {
        id: 1,
        sourceKey: "payment:1",
        customerId: 7,
        invoiceId: 11,
        amount: "5.00",
        origin: "payment",
        createdAt: "2026-08-03T12:00:00.000Z",
      },
      {
        id: 2,
        sourceKey: "credit_note:10",
        customerId: 7,
        invoiceId: 10,
        amount: "5.00",
        origin: "credit_note",
        createdAt: "2026-08-03T12:00:00.000Z",
      },
      {
        id: 3,
        sourceKey: "credit_note:20",
        customerId: 8,
        invoiceId: 12,
        amount: "2.00",
        origin: "credit_note",
        createdAt: "2026-08-03T12:00:00.000Z",
      },
    ],
    refunds: [
      {
        id: 1,
        refundNumber: "REF-8-1",
        customerId: 8,
        amount: "2.00",
        refundDate: "2026-08-04",
        method: "check",
        reason: "Recorded test refund",
        createdAt: "2026-08-04T12:00:00.000Z",
      },
    ],
    refundAllocations: [
      { id: 1, refundId: 1, sourceKey: "credit_note:20", amount: "2.00" },
    ],
    creditNotes: [
      {
        id: 10,
        invoiceId: 10,
        creditNumber: "CN-10",
        totalAmount: "15.00",
        balanceReductionAmount: "10.00",
        customerCreditAmount: "5.00",
        createdAt: "2026-08-04T05:00:00.000Z",
      },
    ],
    invoices: [
      {
        id: 10,
        invoiceNumber: "INV-10",
        customerId: 7,
        totalAmount: "50.00",
        amountPaid: "20.00",
        balanceDue: "15.00",
        status: "partially_credited",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      {
        id: 11,
        invoiceNumber: "INV-11",
        customerId: 7,
        totalAmount: "30.00",
        amountPaid: "5.00",
        balanceDue: "25.00",
        status: "partial",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      {
        id: 12,
        invoiceNumber: "INV-12",
        customerId: 8,
        totalAmount: "20.00",
        amountPaid: "0.00",
        balanceDue: "18.00",
        status: "partially_credited",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      {
        id: 13,
        invoiceNumber: "INV-13",
        customerId: 9,
        totalAmount: "40.00",
        amountPaid: "40.00",
        balanceDue: "0.00",
        status: "paid",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      {
        id: 14,
        invoiceNumber: "INV-14",
        customerId: 9,
        totalAmount: "40.00",
        amountPaid: "0.00",
        balanceDue: "0.00",
        status: "voided",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    ],
  };
}

test("reconciliation uses company timezone for timestamp day boundaries", () => {
  assert.equal(moneyToCents("-25.00"), -2500n);
  assert.equal(localDateFromInstant("2026-08-01T04:59:59.000Z", "America/Chicago"), "2026-07-31");
  assert.equal(localDateFromInstant("2026-08-01T05:00:00.000Z", "America/Chicago"), "2026-08-01");
  assert.deepEqual(
    resolveFinancialReconciliationRange({
      timezone: "America/Chicago",
      now: new Date("2026-08-15T12:00:00.000Z"),
    }),
    { startDate: "2026-08-01", endDate: "2026-08-15", timezone: "America/Chicago" },
  );
  assert.throws(
    () => resolveFinancialReconciliationRange({ startDate: "2025-01-01", endDate: "2026-01-02", timezone: "UTC" }),
    /366 days/,
  );
});

test("reconciliation summary keeps cash, recorded refunds, and non-cash adjustments separate", () => {
  const before = structuredClone(snapshot());
  const result = buildFinancialReconciliation(snapshot(), range, [
    { id: 7, name: "Customer Seven" },
    { id: 8, name: "Customer Eight" },
  ]);

  assert.equal(result.summary.cashReceivedCents, 12525);
  assert.equal(result.summary.recordedRefundsCents, 200);
  assert.equal(result.summary.netRecordedCashActivityCents, 12325);
  assert.equal(result.summary.invoiceCreditsCents, 1500);
  assert.equal(result.summary.customerCreditApplicationsCents, 1200);
  assert.equal(result.summary.customerCreditRefundsCents, 200);
  assert.deepEqual(result.summary.methods, [
    { method: "cash", cashReceivedCents: 2525, recordedRefundsCents: 0, netRecordedCashActivityCents: 2525 },
    { method: "check", cashReceivedCents: 10000, recordedRefundsCents: 200, netRecordedCashActivityCents: 9800 },
  ]);
  assert.deepEqual(result.summary.origins, [
    { origin: "payment", applicationsCents: 500, refundsCents: 0 },
    { origin: "credit_note", applicationsCents: 700, refundsCents: 200 },
  ]);
  assert.deepEqual(result.summary.currentPosition, {
    unappliedPaymentCents: 7500,
    availableCustomerCreditCents: 500,
    outstandingArCents: 5800,
  });
  assert.equal(result.discrepancies.length, 0);
  assert.deepEqual(snapshot(), before);
});

test("reconciliation supports method/source/kind filters with deterministic transactions", () => {
  const all = buildFinancialReconciliation(snapshot(), range);
  const filtered = buildFinancialReconciliation(snapshot(), range, [], {
    source: "credit_note",
    kind: "customer_credit_application",
  });
  assert.deepEqual(filtered.transactions.map((row) => row.id), [
    "customer-credit-application:3",
    "customer-credit-application:2",
  ]);
  assert.equal(filtered.summary.customerCreditApplicationsCents, 700);
  assert.equal(all.transactions[0]?.id, "invoice-credit:10");
  assert.equal(all.transactions[all.transactions.length - 1]?.id, "payment:1");
});

test("paid, part-paid, and unpaid credit paths reconcile without mixing cash and non-cash activity", () => {
  const result = buildFinancialReconciliation(snapshot(), range);
  assert.equal(result.summary.cashReceivedCents, 12525);
  assert.equal(result.summary.invoiceCreditsCents, 1500);
  assert.equal(result.summary.customerCreditApplicationsCents, 1200);
  assert.equal(result.summary.currentPosition.outstandingArCents, 5800);
  assert.equal(result.discrepancies.filter((item) => item.recordType === "invoice").length, 0);
});

test("cross-date applications and refunds use their own local transaction dates", () => {
  const applicationDay = buildFinancialReconciliation(snapshot(), {
    startDate: "2026-08-03",
    endDate: "2026-08-03",
    timezone: "America/Chicago",
  });
  assert.deepEqual(applicationDay.transactions.map((row) => row.id), [
    "customer-credit-application:3",
    "customer-credit-application:2",
    "customer-credit-application:1",
  ]);
  assert.equal(applicationDay.summary.recordedRefundsCents, 0);

  const refundDay = buildFinancialReconciliation(snapshot(), {
    startDate: "2026-08-04",
    endDate: "2026-08-04",
    timezone: "America/Chicago",
  });
  assert.deepEqual(refundDay.transactions.map((row) => row.id), [
    "invoice-credit:10",
    "refund:1",
  ]);
  assert.equal(refundDay.summary.recordedRefundsCents, 200);
  assert.equal(refundDay.summary.invoiceCreditsCents, 1500);
});

test("voided correction/reissue invoices are excluded, paid overpayments are tolerated, and legacy negatives remain auditable", () => {
  const corrected = snapshot();
  corrected.invoices.push(
    {
      id: 15,
      invoiceNumber: "INV-OVERPAID",
      customerId: 7,
      totalAmount: "40.00",
      amountPaid: "45.00",
      balanceDue: "0.00",
      status: "paid",
      createdAt: "2026-08-01T12:00:00.000Z",
    },
    {
      id: 16,
      invoiceNumber: "INV-LEGACY-NEGATIVE",
      customerId: 7,
      totalAmount: "-25.00",
      amountPaid: "0.00",
      balanceDue: "0.00",
      status: "pending",
      createdAt: "2026-08-01T12:00:00.000Z",
    },
    {
      id: 17,
      invoiceNumber: "INV-REISSUED-SOURCE",
      customerId: 7,
      totalAmount: "100.00",
      amountPaid: "0.00",
      balanceDue: "0.00",
      status: "voided",
      createdAt: "2026-08-01T12:00:00.000Z",
    },
  );
  const discrepancies = buildFinancialReconciliation(corrected, range).discrepancies;
  assert.equal(discrepancies.some((item) => item.recordId === 15), false);
  assert.equal(discrepancies.some((item) => item.recordId === 17), false);
  assert.deepEqual(discrepancies.find((item) => item.recordId === 16), {
    id: "invoice:16",
    recordType: "invoice",
    recordId: 16,
    reason: "Adjusted invoice amount does not equal cash paid plus credit-note-origin customer-credit applications plus remaining balance.",
    expectedCents: 0,
    actualCents: -2500,
    differenceCents: -2500,
  });
});

test("reconciliation reports payment, source, refund, and invoice mismatches without repair", () => {
  const broken = snapshot();
  broken.payments[0]!.unappliedAmount = "74.99";
  broken.sources[1]!.availableAmount = "0.01";
  broken.refundAllocations[0]!.amount = "1.99";
  broken.invoices[10 - 10]!.balanceDue = "14.99";
  const result = buildFinancialReconciliation(broken, range);

  assert.deepEqual(result.discrepancies.map((item) => item.recordType), [
    "customer_credit_source",
    "customer_credit_source",
    "invoice",
    "payment",
    "refund",
  ]);
  assert.equal(result.discrepancies.find((item) => item.recordType === "payment")?.differenceCents, 1);
  assert.equal(result.discrepancies.find((item) => item.recordType === "refund")?.differenceCents, 1);
});

test("legacy empty ledgers remain readable and do not create discrepancies", () => {
  const legacy = snapshot();
  legacy.sources = [];
  legacy.applications = [];
  legacy.refunds = [];
  legacy.refundAllocations = [];
  legacy.creditNotes = [];
  legacy.paymentAllocations = [];
  legacy.payments = [{
    ...legacy.payments[0]!,
    allocatedAmount: "0.00",
    unappliedAmount: "100.00",
  }];
  legacy.invoices = legacy.invoices.map((invoice) => ({
    ...invoice,
    amountPaid: "0.00",
    balanceDue: invoice.status === "voided" ? "0.00" : invoice.totalAmount,
    status: invoice.status === "voided" ? "voided" : "sent",
  }));
  const result = buildFinancialReconciliation(legacy, range);
  assert.equal(result.summary.currentPosition.availableCustomerCreditCents, 0);
  assert.equal(result.summary.currentPosition.unappliedPaymentCents, 10000);
  assert.equal(result.discrepancies.length, 0);
});