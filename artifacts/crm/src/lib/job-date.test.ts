/**
 * Tests for client-side job-date helpers.
 *
 * Run with:  node --test --experimental-strip-types src/lib/job-date.test.ts
 * (Node 22.6+ / Node 24 — no extra dependencies required)
 *
 * All tests inject a fixed `today` string so results are deterministic
 * regardless of when the suite runs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatJobDateOnly, isJobScheduledInFuture, todayDateStr } from "./job-date.ts";

const TODAY = "2026-08-10";

describe("isJobScheduledInFuture", () => {
  // ── Past dates ─────────────────────────────────────────────────────────

  it("yesterday is NOT future — completion allowed", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-08-09", TODAY), false);
  });

  it("a date months ago is NOT future", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-01-15", TODAY), false);
  });

  it("a date last year is NOT future", () => {
    assert.strictEqual(isJobScheduledInFuture("2025-08-10", TODAY), false);
  });

  // ── Today ─────────────────────────────────────────────────────────────

  it("today is NOT future — completing today's job is allowed", () => {
    assert.strictEqual(isJobScheduledInFuture(TODAY, TODAY), false);
  });

  // ── Future dates ──────────────────────────────────────────────────────

  it("tomorrow IS future — Mark Complete must be blocked", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-08-11", TODAY), true);
  });

  it("next week IS future", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-08-17", TODAY), true);
  });

  it("next year IS future", () => {
    assert.strictEqual(isJobScheduledInFuture("2027-06-01", TODAY), true);
  });

  // ── Null / missing scheduledDate ──────────────────────────────────────

  it("null scheduledDate is NOT future — unscheduled jobs can be completed", () => {
    assert.strictEqual(isJobScheduledInFuture(null, TODAY), false);
  });

  it("undefined scheduledDate is NOT future", () => {
    assert.strictEqual(isJobScheduledInFuture(undefined, TODAY), false);
  });

  it("empty string is NOT future", () => {
    assert.strictEqual(isJobScheduledInFuture("", TODAY), false);
  });

  // ── Timezone / date-boundary ──────────────────────────────────────────

  it("boundary: scheduledDate exactly equal to today is NOT future", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-08-10", "2026-08-10"), false);
  });

  it("boundary: scheduledDate one day after today IS future", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-08-11", "2026-08-10"), true);
  });

  it("boundary: scheduledDate one day before today is NOT future", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-08-09", "2026-08-10"), false);
  });

  it("month rollover boundary — end of month is NOT future relative to first of next", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-07-31", "2026-08-01"), false);
  });

  it("month rollover boundary — first of next month IS future relative to end of this month", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-09-01", "2026-08-31"), true);
  });

  it("year rollover boundary — Dec 31 is NOT future relative to Jan 1 of next year", () => {
    assert.strictEqual(isJobScheduledInFuture("2026-12-31", "2027-01-01"), false);
  });

  // ── Live todayDateStr integration (no injection) ──────────────────────

  it("far-future date is always future regardless of runtime date", () => {
    assert.strictEqual(isJobScheduledInFuture("9999-12-31"), true);
  });

  it("far-past date is never future regardless of runtime date", () => {
    assert.strictEqual(isJobScheduledInFuture("2000-01-01"), false);
  });
});

describe("todayDateStr", () => {
  it("returns a YYYY-MM-DD string", () => {
    const result = todayDateStr();
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/, `expected YYYY-MM-DD, got "${result}"`);
  });
});

describe("formatJobDateOnly", () => {
  it("renders the Chicago/UTC boundary date as the same local calendar day", () => {
    assert.equal(
      formatJobDateOnly("2026-08-30", "EEEE, MMMM d, yyyy"),
      "Sunday, August 30, 2026",
    );
    assert.equal(formatJobDateOnly("2026-08-30", "EEE, MMM d"), "Sun, Aug 30");
  });

  it("does not rewrite malformed or missing persisted values", () => {
    assert.equal(formatJobDateOnly(null, "yyyy-MM-dd"), "Not scheduled");
    assert.equal(formatJobDateOnly("not-a-date", "yyyy-MM-dd"), "not-a-date");
  });
});
