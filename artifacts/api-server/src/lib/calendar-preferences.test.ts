import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CALENDAR_VIEWS,
  COLOR_MODES,
  DEFAULT_CALENDAR_PREFERENCES,
  LIST_SETTINGS,
  fromStoredRow,
  mergeCalendarPreferences,
  toStoredRow,
} from "./calendar-preferences.ts";

const base = DEFAULT_CALENDAR_PREFERENCES;
const merged = (patch: Record<string, unknown>) => mergeCalendarPreferences(base, patch);

test("a calendar nobody has touched hides nothing", () => {
  // An empty filter list means "everything". If it ever meant "nothing", the
  // first person to open the calendar would see an empty month.
  assert.deepEqual(base.selectedAssignments, []);
  assert.deepEqual(base.selectedAppointmentTypes, []);
  assert.equal(base.showCompletedJobs, true);
  assert.equal(base.showJobCounts, true);
});

test("the eighteen settings are all there", () => {
  // Spec §11.6: thirteen single values and five lists.
  const keys = Object.keys(base);
  assert.equal(keys.length, 19, "fourteen columns plus five lists");
  for (const list of LIST_SETTINGS) assert.ok(keys.includes(list), `${list} is missing`);
});

test("a patch moves only what it names", () => {
  const result = merged({ showCompletedJobs: false });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.values.showCompletedJobs, false);
  assert.equal(result.values.showJobCounts, base.showJobCounts, "an untouched setting is untouched");
  assert.equal(result.values.colorMode, base.colorMode);
});

test("the values the database would refuse are refused here first, by name", () => {
  for (const [patch, expected] of [
    [{ defaultView: "year" }, /defaultView must be one of month, week, day/],
    [{ weekStartsOn: 2 }, /weekStartsOn must be 0 \(Sunday\) or 1 \(Monday\)/],
    [{ assignmentDisplay: "stacked" }, /assignmentDisplay/],
    [{ colorMode: "rainbow" }, /colorMode/],
    [{ lastViewedDate: "the 3rd" }, /YYYY-MM-DD/],
    [{ showCompletedJobs: "yes" }, /showCompletedJobs must be true or false/],
    [{ selectedAssignments: "crew-1" }, /selectedAssignments must be a list/],
    [{ selectedAssignments: [1, 2] }, /list of short text values/],
  ] as const) {
    const result = mergeCalendarPreferences(base, patch as Record<string, unknown>);
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.match(result.ok ? "" : result.error, expected as RegExp);
  }
});

test("every allowed value is allowed", () => {
  for (const view of CALENDAR_VIEWS) assert.ok(merged({ defaultView: view }).ok, view);
  for (const mode of COLOR_MODES) assert.ok(merged({ colorMode: mode }).ok, mode);
  assert.ok(merged({ weekStartsOn: 0 }).ok);
  assert.ok(merged({ lastViewedDate: "2026-11-03" }).ok);
  assert.ok(merged({ lastViewedDate: null }).ok);
});

test("a filter list is tidied rather than taken as typed", () => {
  const result = merged({ selectedAssignments: [" crew-2 ", "crew-2", "unassigned"] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.values.selectedAssignments, ["crew-2", "unassigned"], "trimmed and de-duplicated");
});

test("a list that could not be meant is refused", () => {
  assert.equal(merged({ cardFields: [""] }).ok, false);
  assert.equal(merged({ cardFields: ["x".repeat(65)] }).ok, false);
  assert.equal(merged({ cardFields: Array.from({ length: 201 }, (_, i) => `f${i}`) }).ok, false);
});

test("the five lists travel together, apart from the columns", () => {
  const stored = toStoredRow({ ...base, selectedAssignments: ["crew-1"], showSunday: false });
  assert.deepEqual(Object.keys(stored.listSettings).sort(), [...LIST_SETTINGS].sort());
  assert.equal("selectedAssignments" in stored.columns, false);
  assert.equal(stored.columns.showSunday, false);
});

test("a stored row reads back as it was saved", () => {
  const saved = toStoredRow({
    ...base, defaultView: "week", colorMode: "customer_type",
    showCompletedJobs: false, selectedAssignments: ["crew-3"],
  });
  const read = fromStoredRow({ ...saved.columns, listSettings: saved.listSettings });
  assert.equal(read.defaultView, "week");
  assert.equal(read.colorMode, "customer_type");
  assert.equal(read.showCompletedJobs, false);
  assert.deepEqual(read.selectedAssignments, ["crew-3"]);
});

test("somebody with no row at all gets the defaults", () => {
  assert.deepEqual(fromStoredRow(null), base);
  assert.deepEqual(fromStoredRow(undefined), base);
});

test("a damaged row still opens the calendar", () => {
  // Falling back beats refusing to show somebody their month.
  const read = fromStoredRow({
    defaultView: "year", weekStartsOn: 9, colorMode: "rainbow",
    listSettings: { selectedAssignments: "not a list" },
  });
  assert.equal(read.defaultView, base.defaultView);
  assert.deepEqual(read.selectedAssignments, []);
});

test("the rules match the constraints the table holds", () => {
  // If the table's checks move, these lists have to move with them, or a save
  // the API accepts becomes a 500 nobody can read.
  const schema = readFileSync(
    fileURLToPath(new URL("../../../../lib/db/src/schema/calendar_preferences.ts", import.meta.url)),
    "utf8",
  );
  assert.match(schema, /IN \('month', 'week', 'day'\)/);
  assert.match(schema, /IN \(0, 1\)/);
  assert.match(schema, /IN \('grouped', 'separate'\)/);
  assert.match(schema, /IN \('assignment', 'event_type', 'customer_type', 'service_type'\)/);
  for (const mode of COLOR_MODES) assert.ok(schema.includes(`'${mode}'`), `${mode} is not a constraint value`);
});
