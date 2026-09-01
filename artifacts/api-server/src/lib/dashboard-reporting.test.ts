import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRequestDecision, dashboardWindows, financialSnapshot, isAuthoritativeConversionActivity, isPeriodReportableDecision, parseDashboardPeriod, percentChange, safeRate } from "./dashboard-reporting.ts";
import { businessDateStr } from "./date.ts";

test("dashboard defaults to the Chicago business date at the frozen UTC boundary", () => {
  const today = businessDateStr(new Date("2026-08-30T02:48:00Z"));
  assert.equal(today, "2026-08-29");
  assert.deepEqual(dashboardWindows("today", today), {
    current: { start: "2026-08-29", end: "2026-08-29" },
    previous: { start: "2026-08-28", end: "2026-08-28" },
  });
});

test("dashboard periods use inclusive equivalent comparison windows", () => {
  assert.deepEqual(dashboardWindows("today", "2026-08-29"), {
    current: { start: "2026-08-29", end: "2026-08-29" },
    previous: { start: "2026-08-28", end: "2026-08-28" },
  });
  assert.deepEqual(dashboardWindows("last_7_days", "2026-08-29"), {
    current: { start: "2026-08-23", end: "2026-08-29" },
    previous: { start: "2026-08-16", end: "2026-08-22" },
  });
  assert.deepEqual(dashboardWindows("last_month", "2026-08-29"), {
    current: { start: "2026-07-01", end: "2026-07-31" },
    previous: { start: "2026-06-01", end: "2026-06-30" },
  });
  assert.deepEqual(dashboardWindows("last_quarter", "2026-08-29"), {
    current: { start: "2026-04-01", end: "2026-06-30" },
    previous: { start: "2026-01-01", end: "2026-03-31" },
  });
});

test("this year compares the same elapsed span and clamps leap day", () => {
  assert.deepEqual(dashboardWindows("this_year", "2024-02-29").previous, {
    start: "2023-01-01",
    end: "2023-02-28",
  });
});

test("rates and comparisons are safe at zero denominators", () => {
  assert.equal(safeRate(0, 0), 0);
  assert.equal(safeRate(3, 4), 75);
  assert.equal(percentChange(0, 0), 0);
  assert.equal(percentChange(5, 0), null);
  assert.equal(parseDashboardPeriod("last_month"), "last_month");
  assert.equal(parseDashboardPeriod("all_time"), null);
});

test("outstanding and past due use remaining balances, not invoice totals", () => {
  assert.deepEqual(financialSnapshot([
    { status: "sent", balanceDue: 40, dueDate: "2026-08-28" },
    { status: "partially_credited", balanceDue: 25, dueDate: "2026-08-29" },
    { status: "paid", balanceDue: 0, dueDate: "2026-08-01" },
    { status: "voided", balanceDue: 100, dueDate: "2026-07-01" },
    { status: "credited", balanceDue: 100, dueDate: "2026-07-01" },
  ], "2026-08-29"), {
    totalOutstanding: 65,
    pastDueCount: 1,
    pastDueValue: 40,
  });
});

test("dashboard request boundary rejects unauthorized and invalid periods", () => {
  assert.deepEqual(dashboardRequestDecision(false, "today"), { ok: false, status: 403 });
  assert.deepEqual(dashboardRequestDecision(true, "all_time"), { ok: false, status: 400 });
  assert.deepEqual(dashboardRequestDecision(true, undefined), { ok: true, period: "last_7_days" });
});

test("period decisions require the auditable decision timestamp, never quote creation time", () => {
  assert.equal(isPeriodReportableDecision("accepted", new Date("2026-08-15T18:00:00Z")), true);
  assert.equal(isPeriodReportableDecision("approved", null), false);
  assert.equal(isPeriodReportableDecision("declined", null), false);
});

test("immutable conversion activity remains authoritative after later revision changes", () => {
  assert.equal(isAuthoritativeConversionActivity("estimate_converted_and_scheduled"), true);
  assert.equal(isAuthoritativeConversionActivity("revision_created"), false);
});