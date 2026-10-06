import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  BLOCK_MODES,
  BLOCK_SCOPES,
  blockDecision,
  blocksAffecting,
  validateBlock,
  type SchedulingBlock,
} from "./calendar-blocks.ts";

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

// ── saving one ─────────────────────────────────────────────────────────────

test("a block needs a title and a date", () => {
  assert.match(String(validateBlock({ startDate: "2026-12-25" }).ok === false
    ? validateBlock({ startDate: "2026-12-25" }).error : ""), /needs a title/);
  const noDate = validateBlock({ title: "Christmas" });
  assert.equal(noDate.ok, false);
  assert.match(noDate.ok === false ? noDate.error : "", /YYYY-MM-DD/);
});

test("one day is the default; a range has to run forwards", () => {
  const oneDay = validateBlock({ title: "Christmas", startDate: "2026-12-25" });
  assert.ok(oneDay.ok);
  if (oneDay.ok) assert.equal(oneDay.values.endDate, null);

  const backwards = validateBlock({ title: "Shutdown", startDate: "2026-12-25", endDate: "2026-12-20" });
  assert.equal(backwards.ok, false);
  assert.match(backwards.ok === false ? backwards.error : "", /cannot end before it starts/);
});

test("a scoped block has to name what it is scoped to", () => {
  const crewless = validateBlock({ title: "Training", startDate: "2026-11-10", scopeType: "crew" });
  assert.equal(crewless.ok, false);
  assert.match(crewless.ok === false ? crewless.error : "", /which crew/);

  const nameless = validateBlock({ title: "Leave", startDate: "2026-11-10", scopeType: "employee" });
  assert.equal(nameless.ok, false);
  assert.match(nameless.ok === false ? nameless.error : "", /which person/);
});

test("a company block carries no target, whatever was sent", () => {
  // The table insists on this; refusing here would be unhelpful, so it is
  // cleaned instead.
  const result = validateBlock({
    title: "Holiday", startDate: "2026-12-25", scopeType: "company", crewId: 3, userId: "abc",
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.values.crewId, null);
  assert.equal(result.values.userId, null);
});

test("hours are optional, and have to be hours", () => {
  const timed = validateBlock({
    title: "Training", startDate: "2026-11-10", isAllDay: false, startTime: "09:00", endTime: "12:00",
  });
  assert.ok(timed.ok);
  if (timed.ok) assert.deepEqual([timed.values.startTime, timed.values.endTime], ["09:00", "12:00"]);

  const nonsense = validateBlock({ title: "Training", startDate: "2026-11-10", isAllDay: false, startTime: "9am" });
  assert.equal(nonsense.ok, false);
  assert.match(nonsense.ok === false ? nonsense.error : "", /HH:mm/);

  const backwards = validateBlock({
    title: "Training", startDate: "2026-11-10", isAllDay: false, startTime: "12:00", endTime: "09:00",
  });
  assert.equal(backwards.ok, false);
  assert.match(backwards.ok === false ? backwards.error : "", /end after it starts/);

  // An all-day block keeps no times, whatever was sent with it.
  const allDay = validateBlock({ title: "Christmas", startDate: "2026-12-25", isAllDay: true, startTime: "09:00" });
  assert.ok(allDay.ok);
  if (allDay.ok) assert.equal(allDay.values.startTime, null);
});

test("the mode has to be one the table knows, and defaults to the gentler one", () => {
  const byDefault = validateBlock({ title: "Training", startDate: "2026-11-10" });
  assert.ok(byDefault.ok);
  if (byDefault.ok) assert.equal(byDefault.values.blockMode, "soft", "a block warns unless told to refuse");

  const invented = validateBlock({ title: "Training", startDate: "2026-11-10", blockMode: "firm" });
  assert.equal(invented.ok, false);
  assert.match(invented.ok === false ? invented.error : "", /hard \(refuses bookings\) or soft \(warns\)/);
});

// ── applying them ──────────────────────────────────────────────────────────

test("a company block covers everybody on that day", () => {
  const decision = blockDecision({ date: "2026-12-25", crewId: 3 }, [block()]);
  assert.equal(decision.kind, "refused");
  assert.match(decision.kind === "refused" ? decision.message : "", /blocked: Christmas Day/);
});

test("…and nothing on any other day", () => {
  assert.equal(blockDecision({ date: "2026-12-24" }, [block()]).kind, "allowed");
  assert.equal(blockDecision({ date: "2026-12-26" }, [block()]).kind, "allowed");
});

test("a range covers every day in it, ends included", () => {
  const shutdown = [block({ title: "Shutdown", startDate: "2026-12-24", endDate: "2026-12-26" })];
  for (const date of ["2026-12-24", "2026-12-25", "2026-12-26"]) {
    assert.equal(blockDecision({ date }, shutdown).kind, "refused", date);
  }
  assert.equal(blockDecision({ date: "2026-12-27" }, shutdown).kind, "allowed");
});

test("a crew block applies to that crew only", () => {
  const training = [block({ title: "Alpha training", scopeType: "crew", crewId: 1, blockMode: "soft", startDate: "2026-11-10" })];
  assert.equal(blockDecision({ date: "2026-11-10", crewId: 1 }, training).kind, "warn");
  assert.equal(blockDecision({ date: "2026-11-10", crewId: 2 }, training).kind, "allowed");
  assert.equal(blockDecision({ date: "2026-11-10", crewId: null }, training).kind, "allowed");
});

test("a person's block applies to that person only", () => {
  const leave = [block({ title: "Tom on leave", scopeType: "employee", userId: "u-1", blockMode: "soft", startDate: "2026-11-10" })];
  assert.equal(blockDecision({ date: "2026-11-10", userId: "u-1" }, leave).kind, "warn");
  assert.equal(blockDecision({ date: "2026-11-10", userId: "u-2" }, leave).kind, "allowed");
});

test("hours clash only when they overlap", () => {
  const morning = [block({
    title: "Morning training", startDate: "2026-11-10", isAllDay: false,
    startTime: "09:00", endTime: "12:00", blockMode: "soft",
  })];
  assert.equal(blockDecision({ date: "2026-11-10", startTime: "11:00", endTime: "13:00" }, morning).kind, "warn");
  assert.equal(blockDecision({ date: "2026-11-10", startTime: "13:00", endTime: "15:00" }, morning).kind, "allowed");
  // Back-to-back is not an overlap.
  assert.equal(blockDecision({ date: "2026-11-10", startTime: "12:00", endTime: "14:00" }, morning).kind, "allowed");
  // A job with no time is told about it rather than let quietly through.
  assert.equal(blockDecision({ date: "2026-11-10", startTime: null }, morning).kind, "warn");
});

test("a soft block beside a hard one does not soften it", () => {
  const decision = blockDecision({ date: "2026-12-25", crewId: 1 }, [
    block({ id: 1, title: "Alpha training", scopeType: "crew", crewId: 1, blockMode: "soft", startDate: "2026-12-25" }),
    block({ id: 2, title: "Christmas Day", blockMode: "hard", startDate: "2026-12-25" }),
  ]);
  assert.equal(decision.kind, "refused");
  assert.match(decision.kind === "refused" ? decision.message : "", /Christmas Day/);
  assert.equal(decision.kind === "refused" && decision.blocks[0].blockMode, "hard", "hardest first");
});

test("a block that has been switched off blocks nothing", () => {
  assert.equal(blockDecision({ date: "2026-12-25" }, [block({ isActive: false })]).kind, "allowed");
});

test("the message names the block, because an unexplained refusal is clicked past", () => {
  const warn = blockDecision({ date: "2026-11-10" }, [
    block({ title: "Van in for service", blockMode: "soft", startDate: "2026-11-10" }),
  ]);
  assert.equal(warn.kind, "warn");
  assert.match(warn.kind === "warn" ? warn.message : "", /Van in for service.*Book it anyway\?/);
});

test("the rules match the constraints the table holds", () => {
  const schema = readFileSync(
    fileURLToPath(new URL("../../../../lib/db/src/schema/calendar_events.ts", import.meta.url)),
    "utf8",
  );
  for (const scope of BLOCK_SCOPES) assert.ok(schema.includes(`'${scope}'`), `${scope} is not a constraint value`);
  for (const mode of BLOCK_MODES) assert.ok(schema.includes(`'${mode}'`), `${mode} is not a constraint value`);
  assert.match(schema, /'scheduling_block'/);
  // A scheduling block must declare a mode, and nothing else may.
  assert.match(schema, /calendar_events_block_mode_scope_check/);
});
