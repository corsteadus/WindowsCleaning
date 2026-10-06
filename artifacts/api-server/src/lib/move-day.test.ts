import { strict as assert } from "node:assert";
import test from "node:test";
import { describeDayMove, planDayMove, type MovableJob } from "./move-day.ts";

const job = (over: Partial<MovableJob> = {}): MovableJob => ({
  id: 1,
  customerId: 100,
  label: "Acme · 9:00 AM",
  status: "scheduled",
  hasInvoice: false,
  ...over,
});

const plan = (jobs: MovableJob[], from = "2026-11-10", to = "2026-11-12") =>
  planDayMove({ from, to, jobs });

test("a day's work moves to another day", () => {
  const result = plan([job({ id: 1 }), job({ id: 2, customerId: 200 }), job({ id: 3, customerId: 100 })]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.moving, [1, 2, 3]);
  assert.deepEqual(result.plan.skipped, []);
  assert.equal(result.plan.customersAffected, 2, "three jobs, two customers");
});

test("completed and invoiced work keeps its date, and is named", () => {
  // The same rule a single drag obeys: an invoice already told the customer
  // which day the work happened.
  const result = plan([
    job({ id: 1 }),
    job({ id: 2, status: "completed", label: "Bea · 11:00 AM" }),
    job({ id: 3, hasInvoice: true, label: "Cara · 1:00 PM" }),
  ]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.moving, [1]);
  assert.deepEqual(result.plan.skipped.map((s) => [s.id, s.reason]), [[2, "completed"], [3, "invoiced"]]);
  assert.match(result.plan.skipped[0].message, /Reopen the job first/);
  assert.match(result.plan.skipped[1].message, /Void or credit the invoice/);
  assert.equal(result.plan.skipped[1].label, "Cara · 1:00 PM", "named, not just an id");
});

test("a day where nothing may move says so rather than reporting success", () => {
  const result = plan([job({ id: 1, status: "completed" }), job({ id: 2, hasInvoice: true })]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.moving, []);
  assert.match(describeDayMove(result.plan), /Nothing moved from 2026-11-10: all 2 jobs/);
});

test("the dates have to be dates, and have to differ", () => {
  for (const [from, to, expected] of [
    ["", "2026-11-12", /YYYY-MM-DD/],
    ["2026-11-10", "the 12th", /YYYY-MM-DD/],
    ["2026-11-10", "2026-11-10", /already on that date/],
  ] as const) {
    const result = plan([job()], from, to);
    assert.equal(result.ok, false, `${from} → ${to}`);
    assert.equal(result.ok === false && result.status, 400);
    assert.match(result.ok === false ? result.error : "", expected);
  }
});

test("an empty day is refused rather than reported as a move of nothing", () => {
  const result = plan([]);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /no work on that day/);
});

test("a job with no customer still moves, and is not counted as one", () => {
  const result = plan([job({ id: 1, customerId: null })]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.moving, [1]);
  assert.equal(result.plan.customersAffected, 0);
});

test("what the office is told afterwards", () => {
  const moved = plan([job({ id: 1 }), job({ id: 2 })]);
  assert.ok(moved.ok);
  if (moved.ok) assert.equal(describeDayMove(moved.plan), "2 jobs moved to 2026-11-12");

  const partial = plan([job({ id: 1 }), job({ id: 2, status: "completed" })]);
  assert.ok(partial.ok);
  if (partial.ok) {
    assert.equal(
      describeDayMove(partial.plan),
      "1 job moved to 2026-11-12, 1 left on 2026-11-10 (completed or invoiced)",
    );
  }
});

test("the plan is the same whether it is previewed or applied", () => {
  // The screen must not be able to show one thing and do another: both call
  // this, with the same jobs.
  const jobs = [job({ id: 1 }), job({ id: 2, hasInvoice: true })];
  assert.deepEqual(plan(jobs), plan(jobs));
});

// ── Spec #34: the day being moved to has a say ──────────────────────────────

test("a hard block on the target day leaves the job where it is", () => {
  const result = plan([
    job({ id: 1 }),
    job({ id: 2, blockedBy: "2026-11-12 is blocked: Christmas Day" }),
  ]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.moving, [1], "only the job the day will take");
  assert.deepEqual(result.plan.skipped, [{
    id: 2,
    label: "Acme · 9:00 AM",
    reason: "blocked",
    // The block is named: "that day is blocked" is the kind of message people
    // learn to click past.
    message: "2026-11-12 is blocked: Christmas Day",
  }]);
});

test("a job's own state is the reason before the destination is", () => {
  // A completed job is not moving either way, and "completed work keeps its
  // date" is the more useful of the two sentences.
  const result = plan([job({ id: 1, status: "completed", blockedBy: "2026-11-12 is blocked: Snow" })]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.plan.skipped[0]?.reason, "completed");
});

test("a company-wide hard block moves nothing, and says why", () => {
  const blockedBy = "2026-11-12 is blocked: Christmas Day";
  const result = plan([job({ id: 1, blockedBy }), job({ id: 2, customerId: 200, blockedBy })]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.moving, []);
  assert.equal(
    describeDayMove(result.plan),
    "Nothing moved from 2026-11-10: all 2 jobs are blocked on 2026-11-12",
  );
});

test("the sentence never blames the wrong reason", () => {
  // Telling somebody a blocked job is "completed or invoiced" sends them
  // looking at the wrong job.
  const mixed = plan([
    job({ id: 1 }),
    job({ id: 2, status: "completed" }),
    job({ id: 3, blockedBy: "2026-11-12 is blocked: Snow" }),
  ]);
  assert.ok(mixed.ok);
  if (!mixed.ok) return;
  assert.equal(
    describeDayMove(mixed.plan),
    "1 job moved to 2026-11-12, 2 left on 2026-11-10 (completed, invoiced, or blocked on 2026-11-12)",
  );
});

test("a soft block is not the planner's business", () => {
  // The caller passes `blockedBy` only for a refusal. A warning belongs on the
  // screen where somebody can answer it; a planner that skipped soft blocks
  // would be refusing them in all but name.
  const result = plan([job({ id: 1, blockedBy: null }), job({ id: 2, blockedBy: undefined })]);
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.plan.moving, [1, 2]);
});
