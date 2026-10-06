/**
 * Phase 14, Step 4c — a blocked day refuses the booking on the server.
 *
 * Spec V1 #12, #34 and §7.15. Until now a block was drawn on the calendar and
 * nothing stopped a job being saved onto it: advice, not a rule. These tests
 * cover the rule, and the line it draws — **hard refuses, soft still only
 * warns**, because the API answering a warning by itself is a refusal wearing
 * a different word.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { blocksOnDate, hardBlockRefusal } from "./calendar-blocks-store.ts";
import type { SchedulingBlock } from "./calendar-blocks.ts";

const block = (over: Partial<SchedulingBlock> = {}): SchedulingBlock => ({
  id: 1,
  title: "Christmas Day",
  startDate: "2026-12-25",
  endDate: null,
  startTime: null,
  endTime: null,
  isAllDay: true,
  scopeType: "company",
  crewId: null,
  userId: null,
  blockMode: "hard",
  reason: null,
  isActive: true,
  ...over,
});

/** The three calls `blocksOnDate` makes, and nothing else. */
const reader = (rows: SchedulingBlock[]) => {
  let asked = 0;
  const fake = {
    select: () => ({ from: () => ({ where: () => { asked += 1; return Promise.resolve(rows); } }) }),
  };
  return { reader: fake as never, asked: () => asked };
};

test("a hard block refuses, and names itself", async () => {
  const { reader: r } = reader([block()]);
  assert.equal(
    await hardBlockRefusal(r, { date: "2026-12-25" }),
    "2026-12-25 is blocked: Christmas Day",
  );
});

test("a soft block does not refuse", async () => {
  // It is a warning for whoever is booking. The screen asks; the server does
  // not decide on their behalf.
  const { reader: r } = reader([block({ blockMode: "soft", title: "Van serviced" })]);
  assert.equal(await hardBlockRefusal(r, { date: "2026-12-25" }), null);
});

test("a soft block beside a hard one does not soften it", async () => {
  const { reader: r } = reader([
    block({ id: 2, blockMode: "soft", title: "Van serviced" }),
    block({ id: 3, blockMode: "hard", title: "Closed" }),
  ]);
  assert.equal(await hardBlockRefusal(r, { date: "2026-12-25" }), "2026-12-25 is blocked: Closed");
});

test("a block on another crew is not this crew's problem", async () => {
  const { reader: r } = reader([block({ scopeType: "crew", crewId: 7, title: "Crew 7 training" })]);
  assert.equal(await hardBlockRefusal(r, { date: "2026-12-25", crewId: 9 }), null);
  assert.match(
    String(await hardBlockRefusal(r, { date: "2026-12-25", crewId: 7 })),
    /Crew 7 training/,
  );
});

test("no block on the day costs one query and no decision", async () => {
  const { reader: r, asked } = reader([]);
  assert.equal(await hardBlockRefusal(r, { date: "2026-12-25" }), null);
  assert.equal(asked(), 1);
});

test("the day is read, not the window", async () => {
  // A booking asks about its own date. Reading a month to answer one day is
  // how a drag ends up slower than the page it is on.
  const source = readFileSync(fileURLToPath(new URL("./calendar-blocks-store.ts", import.meta.url)), "utf8");
  assert.match(source, /lte\(calendarEventsTable\.startDate, date\)/);
  assert.match(source, /eq\(calendarEventsTable\.isActive, true\)/);
  assert.match(source, /eq\(calendarEventsTable\.eventType, "scheduling_block"\)/);
  // A lifted block is switched off rather than deleted, so the read is the
  // only thing keeping it out of the way.
  assert.deepEqual(await blocksOnDate(reader([]).reader, "2026-12-25"), []);
  const one = await blocksOnDate(reader([block({ title: "Snow" })]).reader, "2026-12-25");
  assert.equal(one[0]?.title, "Snow");
});

// ── The routes that can put work on a day ───────────────────────────────────

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const jobs = read("../routes/jobs.ts");
const calendar = read("../routes/calendar.ts");

test("creating a job on a blocked day is refused", () => {
  assert.match(jobs, /const refusal = await hardBlockRefusal\(db, \{/);
  assert.match(jobs, /code: "day_blocked"/);
});

test("rescheduling onto a blocked day is refused", () => {
  assert.match(jobs, /const refusal = await hardBlockRefusal\(tx, \{/);
  assert.match(jobs, /if \(refusal\) return \{ kind: "hardBlocked" as const, message: refusal \}/);
  assert.match(jobs, /result\.kind === "hardBlocked"/);
});

test("the check runs on the row as it will be, not on the patch alone", () => {
  // Otherwise moving a job onto a crew whose day is blocked slips through,
  // because the date never changed.
  assert.match(jobs, /const movesOntoADay = touchesSchedule\(scheduleChanges\)\s*\n?\s*\|\| body\.crewId !== undefined/);
  assert.match(jobs, /: current\.scheduledDate;/);
  assert.match(jobs, /: current\.crewId,/);
  assert.match(jobs, /: current\.assignedTechnicianUserId,/);
});

test("the refusal is inside the locked transaction", () => {
  // Read with the job row locked for update, so a block created mid-request
  // cannot be stepped over by a reschedule that read before it existed.
  const tx = jobs.indexOf("hardBlockRefusal(tx");
  const lock = jobs.indexOf('.from(jobsTable).where(eq(jobsTable.id, id)).for("update")');
  assert.ok(lock > 0 && tx > lock, "the refusal comes after the row is locked");
});

test("moving a whole day respects blocks on the target date", () => {
  assert.match(calendar, /const blocks = isDateOnly\(to\) \? await blocksOnDate\(db, to\) : \[\]/);
  assert.match(calendar, /decision\.kind === "refused" \? \{ \.\.\.job, blockedBy: decision\.message \} : job/);
  // Still one planner call: the preview and the move cannot disagree.
  assert.equal(calendar.split("planDayMove(").length - 1, 1, "exactly one call site");
});

test("the day move knows who each job is for", () => {
  // Without the crew and the assignee a crew-scoped block cannot be applied,
  // and every job would look company-blocked or none would.
  assert.match(calendar, /jobs\.crew_id AS "crewId"/);
  assert.match(calendar, /jobs\.assigned_technician_user_id AS "userId"/);
});
