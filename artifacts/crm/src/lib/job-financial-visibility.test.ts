import assert from "node:assert/strict";
import test from "node:test";
import { getJobFinancialVisibility } from "./job-financial-visibility.ts";

test("canonical capability state hides every job financial surface from field tech", () => {
  const visibility = getJobFinancialVisibility({
    capabilities: ["jobs.view", "jobs.manage", "schedule.view"],
  });
  assert.deepEqual(visibility, {
    showJobValue: false,
    showInvoices: false,
    showLinkedQuote: false,
  });
});

test("office/admin capability state shows job value, invoices, and linked quote", () => {
  const visibility = getJobFinancialVisibility({
    capabilities: ["jobs.view", "quotes.view", "invoices.view"],
  });
  assert.deepEqual(visibility, {
    showJobValue: true,
    showInvoices: true,
    showLinkedQuote: true,
  });
});