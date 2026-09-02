import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CALENDAR_RANGE_DAYS,
  inclusiveDayCount,
  parseCalendarRange,
} from "./calendar-range.ts";

test("a month grid window is accepted", () => {
  const result = parseCalendarRange("2026-08-31", "2026-10-11");
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.range, {
    start: "2026-08-31",
    end: "2026-10-11",
    days: 42,
  });
});

test("a single day is a valid range", () => {
  const result = parseCalendarRange("2026-09-02", "2026-09-02");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.range.days, 1);
});

test("day count spans month and year boundaries", () => {
  assert.equal(inclusiveDayCount("2026-08-31", "2026-09-01"), 2);
  assert.equal(inclusiveDayCount("2026-12-31", "2027-01-01"), 2);
});

test("day count is unaffected by daylight-saving transitions", () => {
  // US DST ends 2026-11-01; a local-time subtraction would report 8.04 days.
  assert.equal(inclusiveDayCount("2026-10-30", "2026-11-06"), 8);
});

test("an unbounded read is refused", () => {
  const result = parseCalendarRange(undefined, undefined);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "missing");
});

test("non-date input is refused", () => {
  for (const bad of ["2026-8-1", "08/31/2026", "2026-08-31T00:00:00Z", 20260831]) {
    const result = parseCalendarRange(bad, "2026-09-01");
    assert.equal(result.ok, false, `expected ${String(bad)} to be rejected`);
    assert.equal(result.ok === false && result.error, "malformed");
  }
});

test("a reversed range is refused rather than silently swapped", () => {
  const result = parseCalendarRange("2026-09-10", "2026-09-01");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "reversed");
});

test("a range wider than the cap is refused", () => {
  const result = parseCalendarRange("2026-01-01", "2026-12-31");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "too_wide");
});

test("the cap boundary itself is allowed", () => {
  const start = "2026-01-01";
  // 62 days inclusive of both ends.
  const end = "2026-03-03";
  assert.equal(inclusiveDayCount(start, end), MAX_CALENDAR_RANGE_DAYS);
  assert.equal(parseCalendarRange(start, end).ok, true);
});

test("one day past the cap is refused", () => {
  assert.equal(inclusiveDayCount("2026-01-01", "2026-03-04"), MAX_CALENDAR_RANGE_DAYS + 1);
  const result = parseCalendarRange("2026-01-01", "2026-03-04");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "too_wide");
});
