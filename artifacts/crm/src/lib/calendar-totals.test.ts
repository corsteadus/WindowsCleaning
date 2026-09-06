import assert from "node:assert/strict";
import test from "node:test";
import { sumDayTotals, totalsByDate, type CalendarTotalsResponse } from "./calendar-totals.ts";

/**
 * A September grid runs 31 Aug – 4 Oct, so it carries days from either side.
 * The 31 August row is the one that matters: it is drawn on September's grid
 * and on August's, so a summary built from the whole window reports it twice.
 */
function septemberGridTotals(
  overrides: Partial<CalendarTotalsResponse> = {},
): CalendarTotalsResponse {
  return {
    range: { start: "2026-08-31", end: "2026-10-04" },
    days: [
      { date: "2026-08-31", jobCount: 1, completedCount: 1, scheduledValueCents: 10000, durationMinutes: 240 },
      { date: "2026-09-14", jobCount: 2, completedCount: 0, scheduledValueCents: 42500, durationMinutes: 300 },
      { date: "2026-09-30", jobCount: 1, completedCount: 0, scheduledValueCents: 7500, durationMinutes: 60 },
      { date: "2026-10-02", jobCount: 3, completedCount: 1, scheduledValueCents: 90000, durationMinutes: 480 },
    ],
    // What the server returns for the window it was asked for.
    period: { jobCount: 7, completedCount: 2, scheduledValueCents: 150000, durationMinutes: 1080 },
    ...overrides,
  };
}

const inSeptember = (date: string) => date.startsWith("2026-09-");

test("a spilled day is left out of the month it was only drawn in", () => {
  const totals = septemberGridTotals();
  const september = sumDayTotals(totals, inSeptember);

  // 31 August and 2 October are on the grid but belong to other months.
  assert.equal(september?.jobCount, 3);
  assert.equal(september?.scheduledValueCents, 50000);
  assert.equal(september?.durationMinutes, 360);
  assert.equal(september?.completedCount, 0);
});

test("the server's own period still covers the whole window, which is why it cannot be used", () => {
  const totals = septemberGridTotals();
  assert.equal(totals.period.jobCount, 7);
  assert.notEqual(totals.period.jobCount, sumDayTotals(totals, inSeptember)?.jobCount);
});

test("a job on a spilled day is not counted in both months", () => {
  // 31 August sits on September's grid and on August's. Summing each month's
  // own days must attribute that job once, to August.
  const septemberGrid = septemberGridTotals();
  const augustGrid: CalendarTotalsResponse = {
    range: { start: "2026-07-27", end: "2026-09-06" },
    days: [
      { date: "2026-08-03", jobCount: 1, completedCount: 1, scheduledValueCents: 42500, durationMinutes: 180 },
      { date: "2026-08-31", jobCount: 1, completedCount: 1, scheduledValueCents: 10000, durationMinutes: 240 },
      { date: "2026-09-02", jobCount: 5, completedCount: 0, scheduledValueCents: 99999, durationMinutes: 600 },
    ],
    period: { jobCount: 7, completedCount: 2, scheduledValueCents: 152499, durationMinutes: 1020 },
  };

  const august = sumDayTotals(augustGrid, (d) => d.startsWith("2026-08-"));
  const september = sumDayTotals(septemberGrid, inSeptember);

  assert.equal(august?.jobCount, 2);
  assert.equal(august?.scheduledValueCents, 52500);
  // The 31 August job's value appears in August and nowhere else.
  assert.equal(september?.scheduledValueCents, 50000);
});

test("an empty month reports zero rather than borrowing from its neighbours", () => {
  const totals: CalendarTotalsResponse = {
    range: { start: "2026-08-31", end: "2026-10-04" },
    days: [
      { date: "2026-08-31", jobCount: 1, completedCount: 1, scheduledValueCents: 10000, durationMinutes: 240 },
    ],
    period: { jobCount: 1, completedCount: 1, scheduledValueCents: 10000, durationMinutes: 240 },
  };
  const september = sumDayTotals(totals, inSeptember);
  assert.equal(september?.jobCount, 0);
  assert.equal(september?.scheduledValueCents, 0);
  assert.equal(september?.durationMinutes, 0);
});

test("hidden amounts stay hidden and are never summed to zero", () => {
  const totals = septemberGridTotals({
    days: [
      { date: "2026-09-14", jobCount: 2, completedCount: 0, scheduledValueCents: null, durationMinutes: 300 },
    ],
    period: { jobCount: 2, completedCount: 0, scheduledValueCents: null, durationMinutes: 300 },
  });
  const september = sumDayTotals(totals, inSeptember);
  // A viewer without permission sees no figure, not $0.00.
  assert.equal(september?.scheduledValueCents, null);
  assert.equal(september?.jobCount, 2);
});

test("nothing loaded yet reads as unknown, not as zero", () => {
  assert.equal(sumDayTotals(undefined, inSeptember), undefined);
});

test("day totals are keyed by their own date", () => {
  const map = totalsByDate(septemberGridTotals());
  assert.equal(map.get("2026-09-14")?.jobCount, 2);
  assert.equal(map.get("2026-09-15"), undefined);
  assert.equal(map.size, 4);
});

test("no response leaves an empty lookup rather than throwing", () => {
  assert.equal(totalsByDate(undefined).size, 0);
});
