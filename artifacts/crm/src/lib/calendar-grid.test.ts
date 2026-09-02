import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WEEK_START,
  bucketByDate,
  buildMonthGrid,
  formatCents,
  formatDuration,
  shiftMonth,
  weekdayLabels,
} from "./calendar-grid.ts";

const flat = (year: number, month: number, weekStartsOn: 0 | 1 = DEFAULT_WEEK_START) =>
  buildMonthGrid(year, month, { weekStartsOn }).weeks.flatMap((w) => w.days);

test("every week drawn is a whole week", () => {
  for (const [year, month] of [[2026, 0], [2026, 1], [2026, 8], [2027, 11]] as const) {
    const grid = buildMonthGrid(year, month);
    for (const week of grid.weeks) {
      assert.equal(week.days.length, 7, `${year}-${month + 1} has a short week`);
    }
  }
});

test("September 2026 opens on Monday the 31st of August", () => {
  const grid = buildMonthGrid(2026, 8);
  assert.equal(grid.range.start, "2026-08-31");
  assert.equal(grid.weeks[0].days[0].inMonth, false);
  assert.equal(grid.weeks[0].days[1].date, "2026-09-01");
  assert.equal(grid.weeks[0].days[1].inMonth, true);
});

test("the spilled days belong to the neighbouring months, not this one", () => {
  const days = flat(2026, 8);
  const inMonth = days.filter((d) => d.inMonth);
  assert.equal(inMonth.length, 30, "September has 30 days");
  assert.equal(inMonth[0].date, "2026-09-01");
  assert.equal(inMonth[inMonth.length - 1].date, "2026-09-30");
  assert.ok(days.length > inMonth.length, "a spilled day must be drawn");
});

test("a month that fills whole weeks exactly spills nothing", () => {
  // February 2027 starts on a Monday and has 28 days: four clean weeks.
  const grid = buildMonthGrid(2027, 1, { weekStartsOn: 1 });
  assert.equal(grid.weeks.length, 4);
  assert.ok(grid.weeks.flatMap((w) => w.days).every((d) => d.inMonth));
  assert.equal(grid.range.start, "2027-02-01");
  assert.equal(grid.range.end, "2027-02-28");
});

test("a month that needs six weeks draws six", () => {
  const grid = buildMonthGrid(2026, 7, { weekStartsOn: 1 });
  assert.equal(grid.weeks.length, 6);
});

test("no grid ever exceeds the server's 62-day window", () => {
  for (let month = 0; month < 12; month += 1) {
    for (const weekStartsOn of [0, 1] as const) {
      const grid = buildMonthGrid(2026, month, { weekStartsOn });
      assert.ok(grid.weeks.length * 7 <= 62, `${month + 1} exceeds the range cap`);
    }
  }
});

test("the week start moves the whole grid", () => {
  const monday = buildMonthGrid(2026, 8, { weekStartsOn: 1 });
  const sunday = buildMonthGrid(2026, 8, { weekStartsOn: 0 });
  assert.equal(monday.range.start, "2026-08-31");
  assert.equal(sunday.range.start, "2026-08-30");
  assert.deepEqual(weekdayLabels(1)[0], "Mon");
  assert.deepEqual(weekdayLabels(0)[0], "Sun");
  assert.equal(weekdayLabels(1).length, 7);
});

test("dates do not slip a day across a daylight-saving change", () => {
  // US DST ends 2026-11-01. Naive 24-hour stepping repeats or skips a date.
  const days = flat(2026, 10).map((d) => d.date);
  assert.ok(days.includes("2026-10-31"));
  assert.ok(days.includes("2026-11-01"));
  assert.ok(days.includes("2026-11-02"));
  assert.equal(new Set(days).size, days.length, "a date was drawn twice");
});

test("no date is repeated or missing in any month of the year", () => {
  for (let month = 0; month < 12; month += 1) {
    const days = flat(2026, month).map((d) => d.date);
    assert.equal(new Set(days).size, days.length, `${month + 1} repeats a date`);
    const sorted = [...days].sort();
    assert.deepEqual(days, sorted, `${month + 1} is out of order`);
  }
});

test("today is marked, and only today", () => {
  const grid = buildMonthGrid(2026, 8, { today: new Date(2026, 8, 14) });
  const marked = grid.weeks.flatMap((w) => w.days).filter((d) => d.isToday);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].date, "2026-09-14");
});

test("a month not containing today marks nothing", () => {
  const grid = buildMonthGrid(2026, 2, { today: new Date(2026, 8, 14) });
  assert.equal(grid.weeks.flatMap((w) => w.days).some((d) => d.isToday), false);
});

test("weekends are flagged regardless of where the week starts", () => {
  for (const weekStartsOn of [0, 1] as const) {
    const weekend = flat(2026, 8, weekStartsOn).filter((d) => d.isWeekend);
    // Every drawn week contributes exactly one Saturday and one Sunday.
    assert.equal(weekend.length, buildMonthGrid(2026, 8, { weekStartsOn }).weeks.length * 2);
  }
});

test("stepping months rolls the year in both directions", () => {
  assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(shiftMonth(2026, 5, 0), { year: 2026, month: 5 });
  assert.deepEqual(shiftMonth(2026, 0, -13), { year: 2024, month: 11 });
  assert.deepEqual(shiftMonth(2026, 11, 13), { year: 2028, month: 0 });
});

test("occurrences are grouped once, by date", () => {
  const buckets = bucketByDate([
    { id: 1, scheduledDate: "2026-09-14" },
    { id: 2, scheduledDate: "2026-09-14" },
    { id: 3, scheduledDate: "2026-09-15" },
  ]);
  assert.equal(buckets.get("2026-09-14")?.length, 2);
  assert.equal(buckets.get("2026-09-15")?.length, 1);
  assert.equal(buckets.get("2026-09-16"), undefined);
});

test("an undated occurrence is grouped nowhere rather than under a blank key", () => {
  const buckets = bucketByDate([
    { id: 1, scheduledDate: null },
    { id: 2 },
    { id: 3, scheduledDate: "2026-09-14" },
  ]);
  assert.equal(buckets.size, 1);
  assert.equal(buckets.get("2026-09-14")?.length, 1);
});

test("cents are only divided for display", () => {
  assert.equal(formatCents(70050), "$700.50");
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(1), "$0.01");
  // A field tech gets null instead of an amount, and must not see "$0.00".
  assert.equal(formatCents(null), "—");
  assert.equal(formatCents(undefined), "—");
});

test("durations read compactly", () => {
  assert.equal(formatDuration(480), "8h");
  assert.equal(formatDuration(390), "6h 30m");
  assert.equal(formatDuration(45), "45m");
  assert.equal(formatDuration(0), "—");
  assert.equal(formatDuration(null), "—");
});
