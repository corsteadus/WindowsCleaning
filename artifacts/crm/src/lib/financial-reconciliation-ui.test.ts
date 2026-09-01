import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const page = fs.readFileSync(new URL("../pages/FinancialReconciliation.tsx", import.meta.url), "utf8");

test("reconciliation page keeps the accounting labels and recorded-refund warning visible", () => {
  for (const label of [
    "Cash activity",
    "Non-cash adjustments",
    "Current position",
    "Needs attention",
    "Cash received",
    "Recorded refunds",
    "Net recorded cash activity",
    "Invoice credits",
    "Customer-credit",
    "Outstanding A/R",
    "Recorded refund, not sent",
  ]) {
    assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("reconciliation page includes range controls, filters, pagination, drill-throughs, and CSV export", () => {
  for (const marker of [
    'data-testid="reconciliation-filters"',
    'type="date"',
    "Payment method",
    "Source origin",
    "Transaction type",
    "button-export-reconciliation",
    "getExportFinancialReconciliationCsvUrl",
    "ChevronLeft",
    "ChevronRight",
    "href={`/invoices/${row.invoiceId}`}",
    "href={`/payments?${row.recordType}Id=${row.recordId}`}",
  ]) {
    assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("reconciliation page presents explicit loading, empty, and retryable error states", () => {
  assert.match(page, /Loading reconciliation/);
  assert.match(page, /No \{label\} in this range/);
  assert.match(page, /role="alert"/);
  assert.match(page, /Retry/);
});

test("reconciliation page lets the first API read establish server dates without exposing a timezone override", () => {
  assert.match(page, /serverRangeInitialized/);
  assert.match(page, /summary\.range\.startDate/);
  assert.match(page, /summary\.range\.endDate/);
  assert.match(page, /summary\.range\.timezone/);
  assert.doesNotMatch(page, /Company timezone/);
  assert.doesNotMatch(page, /setTimezone/);
  assert.doesNotMatch(page, /DEFAULT_COMPANY_TIMEZONE/);
});