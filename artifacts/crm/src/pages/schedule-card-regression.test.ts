import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scheduleSource = () => readFile(new URL("./Schedule.tsx", import.meta.url), "utf8");

test("an unassigned job renders no assignment line and no stray zero", async () => {
  const schedule = await scheduleSource();

  // `{count && <x/>}` renders a literal 0 when count is 0, because React
  // prints the number rather than treating it as "nothing". An unassigned job
  // has `assignedEmployeeNames: []`, so the old guard painted "0" onto the
  // card between the property line and the action buttons.
  assert.doesNotMatch(
    schedule,
    /\{\(job\.crewName \|\| job\.assignedEmployeeNames\?\.length\) &&/,
    "assignment guard must not branch on a raw length; it renders a literal 0",
  );

  // The replacement compares to produce a boolean before the &&.
  assert.match(
    schedule,
    /\{\(job\.crewName \|\| \(job\.assignedEmployeeNames\?\.length \?\? 0\) > 0\) &&/,
  );
});

test("no JSX guard in the schedule branches on a bare optional length", async () => {
  const schedule = await scheduleSource();

  // Generalises the rule above: the same mistake anywhere in this file would
  // print a digit onto the grid.
  assert.doesNotMatch(
    schedule,
    /\{[^{}\n]*\?\.length\) &&/,
    "guard on a comparison, never on an optional length, inside JSX",
  );
});

test("day cells count and draw only work that is not canceled", async () => {
  const schedule = await scheduleSource();

  assert.match(schedule, /const activeJobs\s*=\s*jobs\.filter\(\(j\) => j\.status !== "canceled"\)/);

  // The derived list has to actually reach the badge and the card loop —
  // it previously existed but was never read, so canceled work was drawn and
  // counted anyway.
  assert.match(schedule, /\{activeJobs\.length\} \{activeJobs\.length === 1 \? "job" : "jobs"\}/);
  assert.match(schedule, /\{activeJobs\.map\(\(job\) =>/);
  assert.match(schedule, /\{activeJobs\.length === 0 \? \(/);

  assert.doesNotMatch(schedule, /\{jobs\.map\(\(job\) =>/, "day cells must not draw canceled jobs");
  assert.doesNotMatch(schedule, /\{jobs\.length\} \{jobs\.length === 1 \?/, "day badge must not count canceled jobs");
});

test("a completed job offers no Move button", async () => {
  const schedule = await scheduleSource();

  // The server refuses the move; this keeps the card from inviting it. The
  // button stays visible but inert, so the reason can be read from the title
  // rather than the control simply vanishing.
  assert.match(schedule, /const scheduleLocked = isDone;/);
  assert.match(schedule, /disabled=\{scheduleLocked\}/);
  assert.match(schedule, /title=\{scheduleLocked \?/);
});

test("a refused reschedule shows the server's reason, not a bare failure", async () => {
  const schedule = await scheduleSource();

  // "Failed to reschedule job" alone strands the user: the refusal carries the
  // way forward ("reopen the job first") and that has to reach the toast.
  assert.match(schedule, /\.data\?\.error/);
  assert.match(schedule, /description: detail/);
  assert.doesNotMatch(
    schedule,
    /onError: \(\) => toast\(\{ title: "Failed to reschedule job", variant: "destructive" \}\)/,
    "the reschedule error handler must surface the server's explanation",
  );
});

test("the week header counts the same work the day cells draw", async () => {
  const schedule = await scheduleSource();

  assert.match(
    schedule,
    /const activeWeekJobs\s*=\s*normalizedWeekJobs\.filter\(\(j\) => j\.status !== "canceled"\)/,
  );
  assert.match(schedule, /const totalWeekJobs\s*=\s*activeWeekJobs\.length/);
  assert.match(schedule, /const completedCount\s*=\s*activeWeekJobs\.filter/);

  // The header must not re-derive its own total from the unfiltered list.
  assert.doesNotMatch(schedule, /const totalWeekJobs\s*=\s*normalizedWeekJobs\.length/);
});
