/**
 * Phase 14, Step 4a — Move Entire Day (V1 #11), as guards.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const month = read("../components/MonthCalendar.tsx");
const dialog = read("../components/MoveDayDialog.tsx");
const route = read("../../../api-server/src/routes/calendar.ts");
const planner = read("../../../api-server/src/lib/move-day.ts");

test("#11 a day with work can be moved whole", () => {
  assert.match(month, /aria-label=\{`Move the work on \$\{day\.date\} to another day`\}/);
  // Only for somebody who may reschedule, and only where there is work.
  assert.match(month, /\{canMove && jobCount > 0 && onMoveDay && \(/);
  assert.match(month, /<MoveDayDialog/);
});

test("it shows what it will do before it does it", () => {
  assert.match(dialog, /preview: true/);
  assert.match(dialog, /data-testid="move-day-plan"/);
  // The same planner answers both, so the screen cannot promise one thing and
  // perform another.
  assert.match(route, /planDayMove\(\{/);
  assert.equal((route.match(/planDayMove\(/g) ?? []).length, 1, "one planner, one call site");
  assert.match(route, /if \(body\.preview === true\) \{/);
});

test("completed and invoiced work keeps its date, and is named", () => {
  assert.match(planner, /scheduleChangeLock\(\{/);
  assert.match(dialog, /Staying on/);
  // Step 4c gave the planner a third reason, so this moved into skipReason().
  assert.match(dialog, /job\.reason === "invoiced" \? "invoiced" : "completed"/);
});

test("a day move tells nobody by accident", () => {
  // Phase 11's rule: nothing reaches a customer without somebody answering a
  // prompt, and a prompt asked twenty-five times is not an answer.
  assert.match(dialog, /Nobody will be told automatically/);
  assert.match(dialog, /customersAffected/);
  assert.doesNotMatch(route.slice(route.indexOf("move-day"), route.indexOf("/calendar/preferences")),
    /enqueueCommunicationEvent|schedule-notification/);
});

test("every job moved leaves a trace in the history", () => {
  assert.match(route, /INSERT INTO activity_logs/);
  assert.match(route, /Moved with the whole day from/);
});
