/**
 * Phase 14, Step 5 — the review screen, as guards.
 *
 * Spec V1 #26 and §13.1: show what is about to be billed, let the office
 * narrow it, name everything left out, and create nothing until asked.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const dialog = read("../components/BulkInvoiceDialog.tsx");
const month = read("../components/MonthCalendar.tsx");
const schedule = read("./Schedule.tsx");

test("the month carries the button, and billing is its own capability", () => {
  // Moving work and billing it are different jobs in an office; the person who
  // reschedules a day is not always the person who invoices it.
  assert.match(month, /\{canInvoice && \(/);
  assert.match(month, /Create invoices/);
  assert.match(schedule, /canInvoice=\{hasClientCapability\(user, "invoices\.manage"\)\}/);
});

test("the range offered is the month on screen", () => {
  assert.match(month, /range=\{monthRange\(year, month\)\}/);
});

test("nothing is billed until the office says so", () => {
  // The preview is a separate request that creates nothing, and the run sends
  // exactly what is still ticked.
  assert.match(dialog, /bulkInvoice\(\{ from, to, preview: true \}\)/);
  assert.match(dialog, /bulkInvoice\(\{ from, to, jobIds: chosen\.jobIds \}\)/);
});

test("ticking is per job, not per customer", () => {
  // A week often holds one visit the office wants to hold back.
  assert.match(dialog, /aria-label=\{`Invoice \$\{line\.description\}`\}/);
  assert.match(dialog, /checked=\{!excluded\.has\(line\.jobId\)\}/);
});

test("the totals follow the ticks", () => {
  // A total that counted the untickedjobs would be the number the office
  // checks against the bank.
  assert.match(dialog, /const lines = group\.lines\.filter\(\(line\) => !excluded\.has\(line\.jobId\)\)/);
  assert.match(dialog, /data-testid="bulk-invoice-total"/);
  assert.match(dialog, /disabled=\{chosen\.groups\.length === 0/);
});

test("everything left out is named with its reason", () => {
  assert.match(dialog, /data-testid="bulk-invoice-skipped"/);
  assert.match(dialog, /Not being invoiced \(\{plan\.skipped\.length\}\)/);
  assert.match(dialog, /\{skipHeading\(job\.reason\)\.toLowerCase\(\)\}/);
});

test("an empty range reads as an answer, not a failure", () => {
  assert.match(dialog, /No finished work waiting to be invoiced between/);
});
