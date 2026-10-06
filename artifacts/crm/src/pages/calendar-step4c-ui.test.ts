/**
 * Phase 14, Step 4c — the drop is answered on the screen, as guards.
 *
 * Spec V1 #34. Until now a block was drawn on the calendar and nothing stopped
 * a job landing on it. These read the source and fail if the refusal, the
 * warning, or the single dialog they share goes away.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const month = read("../components/MonthCalendar.tsx");

test("a hard block refuses the drop before anything is saved", () => {
  assert.match(month, /const blocked = blockDropForOccurrence\(occurrence, drop\.to, blocksByDate\.get\(drop\.to\) \?\? \[\]\)/);
  assert.match(month, /if \(blocked\.kind === "refused"\) \{/);
  assert.match(month, /title: "Cannot move this job",/);
  assert.match(month, /description: readableBlockMessage\(blocked\.message\),/);
});

test("a soft block asks, and does not refuse", () => {
  assert.match(month, /if \(clashes\.length \|\| blocked\.kind === "warn"\)/);
  assert.match(month, /warning: blocked\.kind === "warn" \? blocked : null/);
});

test("one dialog for both reasons, not two in a row", () => {
  // Being asked twice about one drag is how people learn to click through
  // without reading.
  assert.equal(month.split("<Dialog open={conflict !== null}").length - 1, 1);
  assert.match(month, /data-testid="drop-block-warning"/);
  // The block is named in it.
  assert.match(month, /\{conflict\.warning\?\.blocks\.map\(\(block\) => \(/);
  assert.match(month, /\{block\.title\}/);
});

test("the dialog's title says which reason it is holding the move for", () => {
  assert.match(month, /\{conflict\?\.clashes\.length\s*\n?\s*\? `\$\{conflict\.occurrence\.crewName \?\? "This crew"\} is already booked`/);
  assert.match(month, /: "This day is marked off"\}/);
});

test("the blocks the check reads are the ones already on screen", () => {
  // A drag that waits on a fetch is a drag that feels broken.
  assert.match(month, /\[blocksByDate, buckets, commitMove, toast\]/);
});

test("confirming still goes through the one move path", () => {
  // Undo, the toast and the customer prompt all hang off commitMove; a second
  // way to move a job would quietly lose all three.
  assert.match(month, /if \(conflict\) commitMove\(conflict\.occurrence, conflict\.from, conflict\.to\);/);
});

test("what stays behind is named with its own reason", () => {
  // The planner has three reasons, not two. Guessing between the first two
  // printed "completed" over a blocked job, which sends somebody looking at
  // the wrong one.
  const dialog = read("../components/MoveDayDialog.tsx");
  assert.match(dialog, /if \(job\.reason === "blocked"\) return readableBlockMessage\(job\.message\);/);
  assert.match(dialog, /\{job\.label\} — \{skipReason\(job\)\}/);
});
