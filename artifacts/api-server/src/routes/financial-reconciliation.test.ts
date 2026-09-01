import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  FinancialReconciliationHttpValidationError,
  csvCell,
  parseFilters,
  parseFinancialReconciliationRequest,
  parsePage,
  transactionCsv,
  transactionRows,
} from "../lib/financial-reconciliation-http.ts";
import type { ReconciliationSummary, ReconciliationTransaction } from "../lib/financial-reconciliation-core.ts";

const routeSource = fs.readFileSync(new URL("./financial-reconciliation.ts", import.meta.url), "utf8");

const summary = {
  range: { startDate: "2026-08-01", endDate: "2026-08-31", timezone: "America/Chicago" },
  cashReceivedCents: 1234,
  recordedRefundsCents: 200,
  netRecordedCashActivityCents: 1034,
  invoiceCreditsCents: 567,
  customerCreditApplicationsCents: 89,
  customerCreditRefundsCents: 12,
  daily: [],
  methods: [],
  origins: [],
  currentPosition: {
    unappliedPaymentCents: 345,
    availableCustomerCreditCents: 678,
    outstandingArCents: 901,
  },
} satisfies ReconciliationSummary;

function transaction(id: number, label: string, amountCents: number): ReconciliationTransaction {
  return {
    id: `payment:${id}`,
    recordType: "payment",
    recordId: id,
    date: "2026-08-01",
    amountCents,
    cashClass: "cash_received",
    method: "cash",
    sourceOrigin: "payment",
    customerId: 7,
    invoiceId: null,
    invoiceNumber: null,
    label,
  };
}

test("financial reconciliation exposes four GET-only routes with a select-only snapshot adapter", () => {
  assert.equal((routeSource.match(/router\.get\(/g) ?? []).length, 4);
  assert.doesNotMatch(routeSource, /router\.(post|put|patch|delete)\(/);
  assert.doesNotMatch(routeSource, /\.(insert|update|delete)\(/);
  assert.doesNotMatch(routeSource, /\btx\.(insert|update|delete)\(/);
  assert.match(routeSource, /tx\.select\(\)\.from\(paymentsTable\)/);
  assert.match(routeSource, /db\.transaction\(async \(tx\) =>/);
});

test("financial reconciliation validates filters and bounds pagination", () => {
  assert.deepEqual(parseFilters({
    kind: "customer_credit_application",
    method: "cash",
    source: "credit_note",
  }), {
    kind: "customer_credit_application",
    method: "cash",
    source: "credit_note",
  });
  assert.deepEqual(parsePage({ page: "2", pageSize: "25" }), { page: 2, pageSize: 25 });
  assert.throws(() => parsePage({ page: "1", pageSize: "201" }), /between 1 and 200/);
  assert.throws(() => parseFilters({ source: "bank" }), /payment or credit_note/);
  assert.throws(() => parsePage({ page: "0" }), (error: unknown) => error instanceof FinancialReconciliationHttpValidationError && error.code === "invalid_pagination");
});

test("public reconciliation ignores timezone overrides and always uses Chicago boundaries", () => {
  const now = new Date("2026-08-30T02:48:00Z");
  const request = parseFinancialReconciliationRequest({ timezone: "UTC" }, now);
  assert.deepEqual(request.range, {
    startDate: "2026-08-01",
    endDate: "2026-08-29",
    timezone: "America/Chicago",
  });
  assert.deepEqual(
    parseFinancialReconciliationRequest({ timezone: "Pacific/Auckland" }, now).range,
    request.range,
  );
});

test("financial reconciliation paginates deterministically and escapes CSV cells with exact totals", () => {
  const rows = [
    transaction(2, "Second", 250),
    transaction(1, 'First, "quoted"\nline', 984),
  ];
  assert.deepEqual(transactionRows(rows, 2, 1), {
    rows: [{ ...rows[1], amount: "9.84" }],
    page: 2,
    pageSize: 1,
    total: 2,
    totalPages: 2,
  });
  assert.equal(csvCell('First, "quoted"\nline'), '"First, ""quoted""\nline"');
  const csv = transactionCsv(rows, summary);
  assert.match(csv, /"First, ""quoted""\nline"/);
  assert.match(csv, /Cash received,,,12\.34/);
  assert.match(csv, /Recorded refunds,,,2\.00/);
  assert.match(csv, /Net recorded cash activity,,,10\.34/);
  assert.match(csv, /Invoice credits \(non-cash\),,,5\.67/);
  assert.match(csv, /Customer-credit applications \(non-cash\),,,0\.89/);
});