/**
 * Phase 14, Step 4b — scheduling blocks (V1 #12, §7.15, §11.4), as guards.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const month = read("../components/MonthCalendar.tsx");
const dialog = read("../components/BlockDayDialog.tsx");
const route = read("../../../api-server/src/routes/calendar.ts");
const rules = read("../../../api-server/src/lib/calendar-blocks.ts");

test("§11.4 a block is not a job", () => {
  // It is written to calendar_events, and the occurrences query reads jobs.
  assert.match(route, /eventType: "scheduling_block"/);
  assert.match(route, /calendarEventsTable/);
  const occurrences = route.slice(route.indexOf("/calendar/occurrences"), route.indexOf("/calendar/totals"));
  assert.doesNotMatch(occurrences, /calendar_events|calendarEventsTable/);
});

test("#12 a day can be blocked, and the block says what it does", () => {
  assert.match(month, /Block days/);
  assert.match(dialog, /Work cannot be booked on these days until the block is lifted/);
  assert.match(dialog, /whoever books it is told about the block first/);
  // Soft is the default: the calendar warns rather than refuses elsewhere too.
  assert.match(dialog, /useState<"hard" \| "soft">\("soft"\)/);
  assert.match(rules, /blockMode = typeof input\.blockMode === "string" \? input\.blockMode\.trim\(\) : "soft"/);
});

test("hard and soft are drawn differently, and both are unlike a job", () => {
  assert.match(month, /data-block-mode=\{block\.blockMode\}/);
  assert.match(month, /bg-rose-100 text-rose-700/);
  assert.match(month, /bg-amber-100 text-amber-800/);
});

test("a hard block refuses and a soft one warns", () => {
  assert.match(rules, /kind: "refused"/);
  assert.match(rules, /kind: "warn"/);
  // A soft block beside a hard one does not soften it.
  assert.match(rules, /const hard = affecting\.filter\(\(block\) => block\.blockMode === "hard"\)/);
  // The message names the block.
  assert.match(rules, /is blocked: \$\{named\(hard\)\}/);
});

test("lifting a block keeps the record of it", () => {
  assert.match(route, /\.set\(\{ isActive: false/);
  assert.doesNotMatch(route, /DELETE FROM calendar_events/);
  assert.match(month, /Lift "\$\{block\.title\}"\?/);
});

test("a block that spans days is drawn on each of them", () => {
  assert.match(month, /for \(let date = block\.startDate; date <= last;\)/);
});
