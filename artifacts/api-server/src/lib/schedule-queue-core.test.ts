import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_QUEUE_PAGE,
  MAX_QUEUE_PAGE,
  QUEUE_STATUSES,
  daysWaiting,
  decideHold,
  decideRelease,
  decodeQueueCursor,
  encodeQueueCursor,
  initialQueueStatus,
  parseQueuePage,
  type EntrySnapshot,
} from "./schedule-queue-core.ts";

const scheduled = (over: Partial<EntrySnapshot> = {}): EntrySnapshot => ({
  state: "scheduled",
  hasInvoice: false,
  jobStatus: "scheduled",
  ...over,
});

/* ── Bounded reads ─────────────────────────────────────────────────────── */

test("a queue read defaults to the first page of the ready tab", () => {
  const parsed = parseQueuePage({});
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.request.tab, "ready");
  assert.equal(parsed.request.limit, DEFAULT_QUEUE_PAGE);
  assert.equal(parsed.request.cursor, null);
  assert.equal(parsed.request.status, null);
});

test("a caller cannot ask for more rows than one page holds", () => {
  const tooMany = parseQueuePage({ limit: MAX_QUEUE_PAGE + 1 });
  assert.equal(tooMany.ok, false);
  if (tooMany.ok) return;
  assert.equal(tooMany.error, "bad_limit");
  assert.match(tooMany.message, /between 1 and 100/);

  // The boundary itself is allowed.
  assert.equal(parseQueuePage({ limit: MAX_QUEUE_PAGE }).ok, true);
});

test("limits that are not whole positive numbers are refused", () => {
  for (const limit of [0, -5, 2.5, "many", ""]) {
    const parsed = parseQueuePage({ limit });
    if (limit === "") {
      // An omitted value falls back to the default rather than failing.
      assert.equal(parsed.ok, true);
      continue;
    }
    assert.equal(parsed.ok, false, `expected ${JSON.stringify(limit)} to be refused`);
  }
});

test("an unknown tab or waiting reason is named in the refusal", () => {
  const tab = parseQueuePage({ tab: "archive" });
  assert.equal(tab.ok, false);
  if (!tab.ok) assert.match(tab.message, /ready, on_hold, due/);

  const status = parseQueuePage({ status: "sitting_around" });
  assert.equal(status.ok, false);
  if (!status.ok) assert.match(status.message, /needs_contact/);
});

test("every documented waiting reason is accepted", () => {
  for (const status of QUEUE_STATUSES) {
    assert.equal(parseQueuePage({ status }).ok, true, `${status} should be accepted`);
  }
});

/* ── Cursors ───────────────────────────────────────────────────────────── */

test("a cursor survives the round trip", () => {
  const cursor = { queuedAt: "2026-09-10T08:15:00.000Z", id: 4210 };
  const decoded = decodeQueueCursor(encodeQueueCursor(cursor));
  assert.deepEqual(decoded, cursor);
});

test("a cursor carries the id as well as the time, so ties cannot skip a row", () => {
  // Two entries queued in the same millisecond must still order deterministically.
  const a = encodeQueueCursor({ queuedAt: "2026-09-10T08:15:00.000Z", id: 1 });
  const b = encodeQueueCursor({ queuedAt: "2026-09-10T08:15:00.000Z", id: 2 });
  assert.notEqual(a, b);
});

test("a cursor we did not issue is refused rather than half-read", () => {
  for (const bad of ["", "not-base64!", encodeQueueCursor({ queuedAt: "nonsense", id: 3 })]) {
    assert.equal(decodeQueueCursor(bad), null, `expected ${bad} to be refused`);
  }
  // Missing or non-positive ids are refused too.
  assert.equal(decodeQueueCursor(Buffer.from("2026-09-10T08:15:00.000Z|0").toString("base64url")), null);
  assert.equal(decodeQueueCursor(Buffer.from("2026-09-10T08:15:00.000Z").toString("base64url")), null);
});

test("a malformed cursor tells the caller how to recover", () => {
  const parsed = parseQueuePage({ cursor: "garbage" });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.message, /start from the first page/);
});

/* ── Holding work ──────────────────────────────────────────────────────── */

test("holding a job always needs a reason", () => {
  for (const reason of [undefined, null, "", "   "]) {
    const decision = decideHold(scheduled(), { reason });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, "hold_needs_reason");
  }
});

test("a scheduled job with a reason goes on hold", () => {
  const decision = decideHold(scheduled(), { reason: "Waiting on the customer to confirm access" });
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.nextState, "on_hold");
});

test("completed work keeps the date it happened on", () => {
  const decision = decideHold(scheduled({ jobStatus: "completed" }), { reason: "weather" });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.reason, "completed");
    assert.match(decision.message, /Reopen the job/);
  }
});

test("both spellings of a cancelled job are refused", () => {
  for (const jobStatus of ["canceled", "cancelled", "  Cancelled  "]) {
    const decision = decideHold(scheduled({ jobStatus }), { reason: "weather" });
    assert.equal(decision.ok, false, `${jobStatus} should be refused`);
  }
});

test("invoiced work cannot be held, and the refusal says what to do", () => {
  const decision = decideHold(scheduled({ hasInvoice: true }), { reason: "weather" });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.reason, "invoiced");
    assert.match(decision.message, /Void or credit the invoice/);
  }
});

test("holding something already held is refused without changing it", () => {
  const decision = decideHold(scheduled({ state: "on_hold" }), { reason: "weather" });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.reason, "already_there");
});

/* ── Releasing work ────────────────────────────────────────────────────── */

test("held work returns to the queue rather than straight to a date", () => {
  const decision = decideRelease(scheduled({ state: "on_hold" }));
  assert.equal(decision.ok, true);
  if (decision.ok) assert.equal(decision.nextState, "queued");
});

test("only held work can be released", () => {
  for (const state of ["scheduled", "canceled"] as const) {
    const decision = decideRelease(scheduled({ state }));
    assert.equal(decision.ok, false, `${state} should not be releasable`);
    if (!decision.ok) assert.equal(decision.reason, "not_queueable");
  }
  const already = decideRelease(scheduled({ state: "queued" }));
  assert.equal(already.ok, false);
  if (!already.ok) assert.equal(already.reason, "already_there");
});

/* ── Card facts ────────────────────────────────────────────────────────── */

test("days waiting counts whole days from the queued instant", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  assert.equal(daysWaiting("2026-09-10T11:00:00.000Z", now), 0);
  assert.equal(daysWaiting("2026-09-09T12:00:00.000Z", now), 1);
  assert.equal(daysWaiting("2026-08-31T12:00:00.000Z", now), 10);
});

test("a clock skew reads as today, never as negative days", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  assert.equal(daysWaiting("2026-09-10T12:00:01.000Z", now), 0);
});

test("an unreadable queued time does not throw", () => {
  assert.equal(daysWaiting("not a date"), 0);
});

test("new work needs contact; released work is ready to schedule", () => {
  assert.equal(initialQueueStatus("new_job"), "needs_contact");
  assert.equal(initialQueueStatus("released_from_hold"), "ready_to_schedule");
});
