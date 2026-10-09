/**
 * Phase 14, Step 5 — what the review screen writes.
 *
 * Spec V1 #26, §13.1. The rules themselves are the server's; these are the
 * three small things the screen does on its own, and money is one of them.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { formatCents, monthRange, skipHeading } from "./bulk-invoice-format.ts";

test("money is written the way an invoice writes it", () => {
  assert.equal(formatCents(12000), "$120.00");
  assert.equal(formatCents(12050), "$120.50");
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(0), "$0.00");
  // Thousands are grouped: 123456789 cents is a number nobody reads at a
  // glance without them.
  assert.equal(formatCents(123456789), "$1,234,567.89");
  assert.equal(formatCents(-2500), "-$25.00");
});

test("the month on screen is the range offered", () => {
  // Months are counted from 0, as the grid and Date count them. The browser
  // caught this the only way it could be caught: the dialog opened on
  // September while October was on screen.
  assert.deepEqual(monthRange(2026, 9), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(monthRange(2026, 10), { from: "2026-11-01", to: "2026-11-30" });
  // February, and the leap year that catches a hand-written last day.
  assert.deepEqual(monthRange(2026, 1), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange(2028, 1), { from: "2028-02-01", to: "2028-02-29" });
  // Both ends of the year, where an off-by-one spills into another one.
  assert.deepEqual(monthRange(2026, 0), { from: "2026-01-01", to: "2026-01-31" });
  assert.deepEqual(monthRange(2026, 11), { from: "2026-12-01", to: "2026-12-31" });
});

test("a skipped job says why in the office's words", () => {
  assert.equal(skipHeading("invoiced"), "Already invoiced");
  assert.equal(skipHeading("not_completed"), "Not marked complete");
  assert.equal(skipHeading("cancelled"), "Cancelled");
  assert.equal(skipHeading("no_amount"), "No amount");
  // A reason this screen has not heard of still reads as a sentence.
  assert.equal(skipHeading("something_new"), "Skipped");
});
