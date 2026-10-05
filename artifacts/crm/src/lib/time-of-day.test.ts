import assert from "node:assert/strict";
import test from "node:test";
import {
  MINUTES_PER_STEP,
  QUARTER_HOUR_MINUTES,
  formatTimeOfDay,
  formatTimeRange,
  isQuarterHour,
  parseTimeOfDay,
  quarterHourTimes,
  snapToQuarterHour,
  timeSelectOptions,
  toTimeValue,
} from "./time-of-day.ts";

test("Kyle's four minutes past the hour", () => {
  assert.deepEqual([...QUARTER_HOUR_MINUTES], [0, 15, 30, 45]);
  assert.equal(MINUTES_PER_STEP, 15);
});

test("the day offers ninety-six times, from midnight to a quarter to twelve", () => {
  const times = quarterHourTimes();
  assert.equal(times.length, 96);
  assert.equal(times[0], "00:00");
  assert.equal(times[1], "00:15");
  assert.equal(times.at(-1), "23:45");
  // Kyle's own example: 8:00, 8:15, 8:30, 8:45, 9:00.
  const morning = times.slice(times.indexOf("08:00"), times.indexOf("08:00") + 5).map(formatTimeOfDay);
  assert.deepEqual(morning, ["8:00 AM", "8:15 AM", "8:30 AM", "8:45 AM", "9:00 AM"]);
  assert.ok(times.every(isQuarterHour));
});

test("a time reads as a person says it", () => {
  assert.equal(formatTimeOfDay("08:15"), "8:15 AM");
  assert.equal(formatTimeOfDay("00:00"), "12:00 AM", "midnight is twelve, not zero");
  assert.equal(formatTimeOfDay("12:00"), "12:00 PM", "noon is PM");
  assert.equal(formatTimeOfDay("12:45"), "12:45 PM");
  assert.equal(formatTimeOfDay("13:00"), "1:00 PM");
  assert.equal(formatTimeOfDay("23:45"), "11:45 PM");
  assert.equal(formatTimeOfDay("9:30"), "9:30 AM", "a single-digit hour still works");
  assert.equal(formatTimeOfDay("14:30:00"), "2:30 PM", "the server may send seconds");
});

test("the three screens' own versions produced none of these", () => {
  // Each had `${h % 12 || 12}:${mm}${h >= 12 ? "pm" : "am"}` — lowercase, no
  // space. Kyle asked for standard AM / PM.
  assert.doesNotMatch(formatTimeOfDay("08:15"), /am|pm/);
  assert.match(formatTimeOfDay("20:15"), / PM$/);
});

test("anything that is not a time gives nothing back", () => {
  for (const value of [null, undefined, "", "   ", "not a time", "25:00", "08:75", "8", "8:5"]) {
    assert.equal(formatTimeOfDay(value as never), "", `${JSON.stringify(value)} formatted`);
    assert.equal(parseTimeOfDay(value as never), null, `${JSON.stringify(value)} parsed`);
  }
});

test("a stored value is canonicalised without being moved", () => {
  assert.equal(toTimeValue("8:5" + "0"), "08:50");
  assert.equal(toTimeValue("14:30:00"), "14:30");
  assert.equal(toTimeValue("00:00"), "00:00");
  assert.equal(toTimeValue(null), "");
});

test("a range reads as a range, and copes with one end missing", () => {
  assert.equal(formatTimeRange("08:00", "10:30"), "8:00 AM – 10:30 AM");
  assert.equal(formatTimeRange("11:45", "13:00"), "11:45 AM – 1:00 PM");
  assert.equal(formatTimeRange("08:00", null), "8:00 AM");
  assert.equal(formatTimeRange(null, "17:00"), "5:00 PM");
  assert.equal(formatTimeRange(null, null), "");
});

test("snapping goes to the nearest quarter and never leaves the day", () => {
  assert.equal(snapToQuarterHour("08:07"), "08:00");
  assert.equal(snapToQuarterHour("08:08"), "08:15");
  assert.equal(snapToQuarterHour("08:20"), "08:15");
  assert.equal(snapToQuarterHour("08:23"), "08:30");
  assert.equal(snapToQuarterHour("23:58"), "23:45", "it must not roll into tomorrow");
  assert.equal(snapToQuarterHour("00:02"), "00:00");
  assert.equal(snapToQuarterHour("not a time"), "");
});

test("the selector offers the grid, and nothing else when the value is on it", () => {
  const options = timeSelectOptions("09:30");
  assert.equal(options.length, 96);
  assert.ok(options.every((option) => !option.offGrid));
  assert.deepEqual(options[33], { value: "08:15", label: "8:15 AM" });
});

test("a time booked off the grid is kept rather than lost", () => {
  // Jobs scheduled before this existed can sit at any minute. Opening the form
  // must not quietly move them.
  const options = timeSelectOptions("08:20");
  assert.equal(options.length, 97);
  const odd = options.find((option) => option.offGrid);
  assert.deepEqual(odd, { value: "08:20", label: "8:20 AM (as booked)", offGrid: true });
  // …and it sits in order, between the quarters either side of it.
  const at = options.indexOf(odd!);
  assert.equal(options[at - 1].value, "08:15");
  assert.equal(options[at + 1].value, "08:30");
});

test("an off-grid time late in the day still lands in order", () => {
  const options = timeSelectOptions("23:52");
  assert.equal(options.at(-1)?.value, "23:52");
  assert.equal(options.at(-2)?.value, "23:45");
});

test("no value means the plain grid", () => {
  for (const value of [null, undefined, ""]) {
    assert.equal(timeSelectOptions(value as never).length, 96);
  }
});
