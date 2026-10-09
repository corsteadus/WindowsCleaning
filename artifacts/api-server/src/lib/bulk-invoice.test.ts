/**
 * Phase 14, Step 5 — bulk invoicing, as rules.
 *
 * Spec V1 #26, §13.1 and the fifth prototype test.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  amountCents,
  centsToAmount,
  describeBulkInvoices,
  lineDescription,
  planBulkInvoices,
  type BillableJob,
} from "./bulk-invoice.ts";

const job = (over: Partial<BillableJob> = {}): BillableJob => ({
  id: 1,
  customerId: 100,
  customerLabel: "Acme",
  jobNumber: "J-1",
  scheduledDate: "2026-11-10",
  status: "completed",
  serviceType: "Windows",
  totalAmount: "120.00",
  hasInvoice: false,
  propertyId: 5,
  ...over,
});

const plan = (jobs: BillableJob[], selected?: number[]) =>
  planBulkInvoices({ from: "2026-11-01", to: "2026-11-30", jobs, ...(selected ? { selected } : {}) });

test("money is counted in cents, both ways", () => {
  assert.equal(amountCents("120.00"), 12000);
  assert.equal(amountCents("120.5"), 12050);
  assert.equal(amountCents("120"), 12000);
  // A job with no usable amount counts as nothing rather than NaN.
  assert.equal(amountCents(""), 0);
  assert.equal(amountCents(null), 0);
  assert.equal(amountCents("one hundred"), 0);
  assert.equal(centsToAmount(12050), "120.50");
  assert.equal(centsToAmount(12000), "120.00");
  assert.equal(centsToAmount(5), "0.05");
});

test("a range of finished work becomes one invoice per customer", () => {
  // Three visits in a month is one bill, which is how the office posts it.
  const result = plan([
    job({ id: 1 }),
    job({ id: 2, totalAmount: "80.00" }),
    job({ id: 3, customerId: 200, customerLabel: "Beta", totalAmount: "60.00", propertyId: 9 }),
  ]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.plan.groups.length, 2);
  assert.deepEqual(result.plan.totals, { invoices: 2, jobs: 3, totalCents: 26000 });
  const [acme] = result.plan.groups;
  assert.equal(acme.totalCents, 20000);
  assert.deepEqual(acme.lines.map((line) => line.jobId), [1, 2]);
});

test("each line names the job it came from", () => {
  // An invoice has to be takeable back apart.
  // The date is written the way the rest of the platform writes it; the line
  // is what the customer reads on the bill.
  assert.equal(lineDescription(job()), "Windows · J-1 · Nov 10, 2026");
  assert.equal(lineDescription(job({ serviceType: null })), "Service · J-1 · Nov 10, 2026");
  assert.equal(lineDescription(job({ scheduledDate: null })), "Windows · J-1");
  // A date the database should never hold is passed through rather than lost.
  assert.equal(lineDescription(job({ scheduledDate: "soon" })), "Windows · J-1 · soon");
});

test("work already invoiced is left out, and named", () => {
  // The database does not stop this: invoice_jobs is unique on (invoice, job),
  // not on job, because a reissue links the same job to its replacement.
  const result = plan([job({ id: 1 }), job({ id: 2, hasInvoice: true })]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.groups[0].lines.map((line) => line.jobId), [1]);
  assert.deepEqual(result.plan.skipped, [{
    id: 2, label: "Acme · J-1", reason: "invoiced", message: "Already on an invoice",
  }]);
});

test("work that is not finished is named rather than billed", () => {
  const result = plan([
    job({ id: 1 }),
    job({ id: 2, status: "scheduled" }),
    job({ id: 3, status: "in_progress" }),
    job({ id: 4, status: "canceled" }),
  ]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.groups[0].lines.map((line) => line.jobId), [1]);
  assert.deepEqual(
    result.plan.skipped.map((skip) => [skip.id, skip.reason]),
    [[2, "not_completed"], [3, "not_completed"], [4, "cancelled"]],
  );
  assert.match(result.plan.skipped[0].message, /Not marked complete \(scheduled\)/);
});

test("a job with no money on it does not become a zero invoice", () => {
  const result = plan([job({ id: 1, totalAmount: "0" }), job({ id: 2, totalAmount: "" })]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.plan.groups.length, 0);
  assert.deepEqual(result.plan.skipped.map((skip) => skip.reason), ["no_amount", "no_amount"]);
});

test("the review screen's ticks decide what is billed", () => {
  const jobs = [job({ id: 1 }), job({ id: 2 }), job({ id: 3, customerId: 200, customerLabel: "Beta" })];
  const result = plan(jobs, [2, 3]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.groups.map((group) => group.customerId), [100, 200]);
  assert.deepEqual(result.plan.totals, { invoices: 2, jobs: 2, totalCents: 24000 });
  // An empty selection is not "bill nothing" — it is a screen that has not
  // narrowed anything, which is everything.
  const untouched = plan(jobs, []);
  assert.ok(untouched.ok);
  if (untouched.ok) assert.equal(untouched.plan.totals.jobs, 3);
});

test("one property stays on the invoice, two do not", () => {
  // An invoice has room for one property; two jobs at two addresses still
  // belong on one bill, with each line naming its own job.
  const same = plan([job({ id: 1, propertyId: 5 }), job({ id: 2, propertyId: 5 })]);
  assert.ok(same.ok);
  if (same.ok) assert.equal(same.plan.groups[0].propertyId, 5);
  const mixed = plan([job({ id: 1, propertyId: 5 }), job({ id: 2, propertyId: 7 })]);
  assert.ok(mixed.ok);
  if (mixed.ok) assert.equal(mixed.plan.groups[0].propertyId, null);
});

test("a range that is not one is refused with a reason", () => {
  for (const [from, to, expected] of [
    ["the 1st", "2026-11-30", /YYYY-MM-DD/],
    ["2026-11-30", "2026-11-01", /ends before it starts/],
  ] as const) {
    const result = planBulkInvoices({ from, to, jobs: [job()] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, expected);
  }
  // A single day is a range.
  const oneDay = planBulkInvoices({ from: "2026-11-10", to: "2026-11-10", jobs: [job()] });
  assert.equal(oneDay.ok, true);
});

test("an empty range plans nothing rather than failing", () => {
  // Nothing to bill is an ordinary answer, not an error: the office asked a
  // question and the answer is none.
  const result = plan([]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.totals, { invoices: 0, jobs: 0, totalCents: 0 });
  assert.equal(describeBulkInvoices(result.plan), "Nothing to invoice between 2026-11-01 and 2026-11-30");
});

test("what the office is told afterwards", () => {
  const one = plan([job({ id: 1 })]);
  assert.ok(one.ok);
  if (one.ok) assert.equal(describeBulkInvoices(one.plan), "1 invoice for 1 job");

  const mixed = plan([job({ id: 1 }), job({ id: 2, hasInvoice: true }), job({ id: 3, customerId: 200 })]);
  assert.ok(mixed.ok);
  if (mixed.ok) {
    assert.equal(describeBulkInvoices(mixed.plan), "2 invoices for 2 jobs, 1 job skipped");
  }

  const none = plan([job({ id: 1, hasInvoice: true })]);
  assert.ok(none.ok);
  if (none.ok) {
    assert.equal(describeBulkInvoices(none.plan), "Nothing invoiced: all 1 jobs were skipped");
  }
});

test("the plan is the same whether it is previewed or run", () => {
  // The review screen and the button must not be able to disagree.
  const jobs = [job({ id: 1 }), job({ id: 2, hasInvoice: true }), job({ id: 3, customerId: 200 })];
  assert.deepEqual(plan(jobs), plan(jobs));
});

// ── The route that runs it ──────────────────────────────────────────────────

const route = readFileSync(
  fileURLToPath(new URL("../routes/invoices.ts", import.meta.url)),
  "utf8",
);

test("the review and the run share one planner", () => {
  assert.equal(route.split("planBulkInvoices(").length - 1, 1, "exactly one call site");
  assert.match(route, /if \(body\.preview === true \|\| plan\.groups\.length === 0\) \{/);
  assert.match(route, /applied: false/);
});

test("nothing is created until the office says so", () => {
  // The preview returns before the transaction is opened at all.
  const preview = route.indexOf("applied: false");
  const transaction = route.indexOf("await db.transaction", preview);
  assert.ok(preview > 0 && transaction > preview, "the preview returns first");
});

test("the same work cannot be billed twice", () => {
  // The plan was made before the transaction opened, so the jobs are locked
  // and looked at again inside it.
  assert.match(route, /await adapter\.acquireJobLocks\(\[\.\.\.planned\]\.sort/);
  assert.match(route, /eq\(invoiceJobsTable\.jobId|inArray\(invoiceJobsTable\.jobId, planned\)/);
  assert.match(route, /code: "already_invoiced"/);
});

test("a range is billed whole or not at all", () => {
  // One transaction around every invoice: a half-billed week cannot be seen
  // without opening each job.
  const body = route.slice(route.indexOf('router.post("/invoices/bulk"'));
  assert.equal(body.slice(0, body.indexOf("res.status(201)")).split("db.transaction").length - 1, 1);
});

test("each invoice leaves its own entry in the history", () => {
  assert.match(route, /action: "invoice_created"/);
  assert.match(route, /from \$\{group\.lines\.length\}/);
});
