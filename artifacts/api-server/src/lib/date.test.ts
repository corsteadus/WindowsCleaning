/**
 * Tests for API server business-date helpers.
 *
 * Run with:  node --test --experimental-strip-types src/lib/date.test.ts
 * (Node 22.6+ / Node 24 — no extra dependencies required)
 *
 * All tests inject a fixed `now` / `today` string so results are
 * deterministic regardless of when or where the suite runs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addDaysToDateOnly, buildJobStatusUpdate, businessDateStr, canonicalIsoInstant, isDateOnly, isScheduledInFuture, isTimeOnly } from "./date.ts";

const FIXED_DATE = new Date("2026-08-10T12:00:00Z"); // noon UTC on 2026-08-10
const TODAY = "2026-08-10";

describe("businessDateStr", () => {
  it("returns a YYYY-MM-DD string", () => {
    const result = businessDateStr(FIXED_DATE);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/, `expected YYYY-MM-DD, got "${result}"`);
  });

  it("returns the correct calendar date for the injected instant", () => {
    // noon UTC on 2026-08-10 must be 2026-08-10 in UTC (default Replit TZ)
    assert.strictEqual(businessDateStr(FIXED_DATE), TODAY);
  });

  it("correctly handles a date near the UTC day boundary (23:59 UTC)", () => {
    const nearMidnight = new Date("2026-08-10T23:59:59Z");
    // still 2026-08-10 in UTC
    assert.strictEqual(businessDateStr(nearMidnight), TODAY);
  });

  it("keeps the previous Chicago date at midnight UTC", () => {
    const midnight = new Date("2026-08-11T00:00:00Z");
    assert.strictEqual(businessDateStr(midnight), "2026-08-10");
  });

  it("uses America/Chicago at the requested frozen boundary", () => {
    assert.strictEqual(businessDateStr(new Date("2026-08-30T02:48:00Z")), "2026-08-29");
  });

  it("adds Net-30 as date-only calendar arithmetic", () => {
    assert.strictEqual(addDaysToDateOnly("2026-08-29", 30), "2026-09-28");
  });
});

describe("isScheduledInFuture", () => {
  // ── Past dates ──────────────────────────────────────────────────────────

  it("past date is NOT future (yesterday)", () => {
    assert.strictEqual(isScheduledInFuture("2026-08-09", TODAY), false);
  });

  it("past date is NOT future (one year ago)", () => {
    assert.strictEqual(isScheduledInFuture("2025-08-10", TODAY), false);
  });

  // ── Today ────────────────────────────────────────────────────────────────

  it("today is NOT future — completing today's job is allowed", () => {
    assert.strictEqual(isScheduledInFuture(TODAY, TODAY), false);
  });

  // ── Future dates ─────────────────────────────────────────────────────────

  it("tomorrow IS future — completing should be blocked", () => {
    assert.strictEqual(isScheduledInFuture("2026-08-11", TODAY), true);
  });

  it("far-future date IS future", () => {
    assert.strictEqual(isScheduledInFuture("2027-01-01", TODAY), true);
  });

  // ── Null / missing scheduledDate ─────────────────────────────────────────

  it("null scheduledDate is NOT future — unscheduled jobs can be completed", () => {
    assert.strictEqual(isScheduledInFuture(null, TODAY), false);
  });

  it("undefined scheduledDate is NOT future", () => {
    assert.strictEqual(isScheduledInFuture(undefined, TODAY), false);
  });

  it("empty string scheduledDate is NOT future", () => {
    assert.strictEqual(isScheduledInFuture("", TODAY), false);
  });

  // ── Timezone / date-boundary behavior ────────────────────────────────────

  it("uses today derived from businessDateStr when no today arg is passed", () => {
    // Just verifies the function runs without throwing when today is omitted.
    // The injected date path is tested in all other cases.
    const result = isScheduledInFuture("9999-12-31");
    assert.strictEqual(result, true, "far-future should always be future");
  });

  it("uses injected today — 23:59 UTC boundary does not bleed into tomorrow", () => {
    // At 23:59 UTC on 2026-08-10 the business date is still 2026-08-10.
    // A job scheduled 2026-08-11 must be blocked.
    const nearMidnightToday = businessDateStr(new Date("2026-08-10T23:59:59Z"));
    assert.strictEqual(isScheduledInFuture("2026-08-11", nearMidnightToday), true);
    assert.strictEqual(isScheduledInFuture("2026-08-10", nearMidnightToday), false);
  });
});

describe("strict API date and time values", () => {
  it("accepts only real YYYY-MM-DD calendar dates", () => {
    assert.equal(isDateOnly("2026-02-28"), true);
    assert.equal(isDateOnly("2026-02-29"), false);
    assert.equal(isDateOnly("2026-2-01"), false);
    assert.equal(isDateOnly("2026-01-32"), false);
  });
  it("accepts 24-hour clock values without rewriting them", () => {
    assert.equal(isTimeOnly("09:30"), true);
    assert.equal(isTimeOnly("09:30:45"), true);
    assert.equal(isTimeOnly("24:00"), false);
  });
  it("canonicalizes task instants and rejects date-only or malformed values", () => {
    assert.equal(canonicalIsoInstant("2026-08-29T09:15:00-05:00"), "2026-08-29T14:15:00.000Z");
    assert.equal(canonicalIsoInstant("2026-08-29"), null);
    assert.equal(canonicalIsoInstant("2026-08-29T09:15:00"), null);
    assert.equal(canonicalIsoInstant("not-a-date"), null);
    assert.equal(canonicalIsoInstant(null), null);
  });
  it("blocks both start and completion for tomorrow without producing writes", () => {
    const now = new Date("2026-08-10T12:00:00Z");
    assert.equal(buildJobStatusUpdate("in_progress", "2026-08-11", now).kind, "future");
    assert.equal(buildJobStatusUpdate("completed", "2026-08-11", now).kind, "future");
    assert.equal(buildJobStatusUpdate("in_progress", "2026-08-10", now).kind, "updated");
  });
  it("uses the effective replacement date for an atomic reschedule and transition", () => {
    const now = new Date("2026-08-10T12:00:00Z");
    // A future persisted date may be changed to today and started/completed in
    // the same write; the route passes this effective date to the core.
    assert.equal(buildJobStatusUpdate("in_progress", "2026-08-10", now).kind, "updated");
    assert.equal(buildJobStatusUpdate("completed", "2026-08-10", now).kind, "updated");
    assert.equal(buildJobStatusUpdate("in_progress", "2026-08-11", now).kind, "future");
  });
});
