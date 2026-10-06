/**
 * Phase 14, Step 3 — filters and the job drawer, as guards.
 *
 * Spec Step 3 (V1 #16, #17, #21, #24) and §11.6, the blocker the 2026-09-04
 * audit summed up as *"Every filter and display setting resets on reload."*
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const month = read("../components/MonthCalendar.tsx");
const bar = read("../components/CalendarFilterBar.tsx");
const drawer = read("../components/JobSideDrawer.tsx");
const schedule = read("./Schedule.tsx");
const route = read("../../../api-server/src/routes/calendar.ts");

test("§11.6 the filters are saved against the person, not the browser", () => {
  assert.match(route, /router\.get\("\/calendar\/preferences"/);
  assert.match(route, /router\.put\("\/calendar\/preferences"/);
  // The signed-in user, never an id from the request.
  assert.match(route, /eq\(calendarPreferencesTable\.userId, String\(req\.user\.id\)\)/);
  assert.doesNotMatch(route, /req\.(query|params|body)\.userId/);
  assert.match(schedule, /fetchCalendarPreferences/);
  assert.match(schedule, /saveCalendarPreferences/);
});

test("a value the database would refuse is a 400, not a 500", () => {
  assert.match(route, /if \(!merged\.ok\) \{ res\.status\(400\)\.json\(\{ error: merged\.error \}\); return; \}/);
});

test("the filter bar offers only what is booked, and says what it hides", () => {
  assert.match(month, /assignmentOptions\(allOccurrences\)/);
  assert.match(bar, /hidden by these filters/);
  assert.match(bar, /Nothing booked this month/);
  // No bar at all for a caller that does not want one. (A ternary since the
  // Block days button joined it on that row.)
  assert.match(month, /\{onFiltersChange \? \(/);
  assert.match(month, /\) : <span \/>\}/);
});

test("the footers count what is on screen while a filter is on", () => {
  // Otherwise a cell showing three jobs sits under a footer saying eleven.
  assert.match(month, /filtering\s*\n?\s*\? totalsFromOccurrences\(visibleOccurrences/);
  assert.match(month, /if \(!filtering\) return sumDayTotals/);
});

test("clicking a card opens the drawer rather than leaving the month", () => {
  assert.match(month, /<JobSideDrawer/);
  assert.match(month, /setOpenJob\(buckets\.get\(day\.date\)\?\.find/);
  // `onOpenJob` still means "open the full record", and the drawer's button is
  // what calls it now.
  assert.match(drawer, /onOpenJob\(summary\.jobId\)/);
});

test("the drawer opens with the card's own answer", () => {
  assert.match(drawer, /jobDrawerSummary\(occurrence, detailQuery\.data as never\)/);
  // The job is asked for only while the drawer is open.
  assert.match(drawer, /enabled: Boolean\(occurrence\)/);
  assert.match(drawer, /Loading the rest of this job/);
});

test("the drawer shows no money a viewer may not see", () => {
  assert.match(drawer, /\{summary\.amountCents !== null && \(/);
});
