/**
 * Phase 14, Step 4c — dropping a job on a day that is marked off.
 *
 * Spec V1 #12, #34, §7.15. Hard refuses the drop, soft asks. The server holds
 * the same rule for hard blocks; the last test here reads both files and fails
 * if the two drift apart, because a client that is more permissive than the
 * API shows a move that then bounces.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { blockDropDecision, blockDropForOccurrence, readableBlockMessage } from "./calendar-block-conflicts.ts";
import type { SchedulingBlock, CalendarOccurrence } from "./calendar-api.ts";

const block = (over: Partial<SchedulingBlock> = {}): SchedulingBlock => ({
  id: 1,
  title: "Christmas Day",
  description: null,
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

const card = (over: Partial<CalendarOccurrence> = {}): CalendarOccurrence => ({
  id: 7,
  jobNumber: "J-7",
  status: "scheduled",
  scheduledDate: "2026-12-20",
  startTime: "09:00",
  endTime: "11:00",
  serviceType: null,
  isRecurring: false,
  crewId: 3,
  crewName: "Crew A",
  customerLabel: "Acme",
  clientType: null,
  propertyLabel: null,
  amountCents: null,
  invoiceStatus: null,
  ...over,
});

test("a day with no blocks takes the drop", () => {
  assert.deepEqual(blockDropDecision({ date: "2026-12-25" }, []), { kind: "allowed" });
});

test("a hard block refuses, and names itself", () => {
  const decision = blockDropDecision({ date: "2026-12-25" }, [block()]);
  assert.equal(decision.kind, "refused");
  if (decision.kind === "refused") {
    assert.equal(decision.message, "2026-12-25 is blocked: Christmas Day");
  }
});

test("a soft block asks instead of refusing", () => {
  const decision = blockDropDecision({ date: "2026-12-25" }, [block({ blockMode: "soft", title: "Van serviced" })]);
  assert.equal(decision.kind, "warn");
  if (decision.kind === "warn") {
    assert.match(decision.message, /Van serviced. Book it anyway\?/);
  }
});

test("a soft block beside a hard one does not soften it", () => {
  const decision = blockDropDecision({ date: "2026-12-25" }, [
    block({ id: 2, blockMode: "soft", title: "Van serviced" }),
    block({ id: 3, blockMode: "hard", title: "Closed" }),
  ]);
  assert.equal(decision.kind, "refused");
  // Both are shown, so the dialog can list what is on the day...
  if (decision.kind === "refused") {
    assert.equal(decision.blocks.length, 2);
    // ...but only the hard one is the reason.
    assert.equal(decision.message, "2026-12-25 is blocked: Closed");
  }
});

test("a lifted block stops standing in the way", () => {
  assert.equal(blockDropDecision({ date: "2026-12-25" }, [block({ isActive: false })]).kind, "allowed");
});

test("a crew's block is that crew's", () => {
  const training = block({ scopeType: "crew", crewId: 3, title: "Crew A training" });
  assert.equal(blockDropForOccurrence(card(), "2026-12-25", [training]).kind, "refused");
  assert.equal(blockDropForOccurrence(card({ crewId: 9 }), "2026-12-25", [training]).kind, "allowed");
  // Unassigned work is not on any crew, so a crew block does not catch it.
  assert.equal(blockDropForOccurrence(card({ crewId: null }), "2026-12-25", [training]).kind, "allowed");
});

test("a person's block is left to the server", () => {
  // A calendar card carries its crew, not its technician. Answering "allowed"
  // here is honest — the API still refuses it, and its message is what the
  // failed move shows.
  const personal = block({ scopeType: "employee", userId: "user-1", crewId: null, title: "Annual leave" });
  assert.equal(blockDropForOccurrence(card(), "2026-12-25", [personal]).kind, "allowed");
});

test("a few hours blocked only catch the work in those hours", () => {
  const afternoon = block({ isAllDay: false, startTime: "13:00", endTime: "17:00", title: "Depot closed" });
  assert.equal(blockDropForOccurrence(card({ startTime: "09:00", endTime: "11:00" }), "2026-12-25", [afternoon]).kind, "allowed");
  assert.equal(blockDropForOccurrence(card({ startTime: "14:00", endTime: "15:00" }), "2026-12-25", [afternoon]).kind, "refused");
  // Work with no time set is somewhere in the day: it is told, not waved past.
  assert.equal(blockDropForOccurrence(card({ startTime: null, endTime: null }), "2026-12-25", [afternoon]).kind, "refused");
});

test("the client is never more permissive than the API", () => {
  // The same two rules, word for word. A drag that the grid allows and the
  // server refuses is a move that bounces after the card has already jumped.
  const server = readFileSync(
    fileURLToPath(new URL("../../../api-server/src/lib/calendar-blocks.ts", import.meta.url)),
    "utf8",
  );
  const client = readFileSync(
    fileURLToPath(new URL("./calendar-block-conflicts.ts", import.meta.url)),
    "utf8",
  );
  const timeRule = /if \(block\.isAllDay \|\| !block\.startTime \|\| !block\.endTime\) return true;/;
  assert.match(server, timeRule);
  assert.match(client, timeRule);
  const scopeRule = /if \(block\.scopeType === "company"\) return true;/;
  assert.match(server, scopeRule);
  assert.match(client, scopeRule);
  // And the same message, so the refusal reads the same from either side.
  assert.ok(server.includes("is blocked: ${named(hard)}"));
  assert.ok(client.includes("is blocked: ${named(hard)}"));
});

test("a block's dates are written the way the rest of the screen writes them", () => {
  // The rule composes "2026-10-18 is blocked: Closed"; a dialog headed
  // "Oct 18, 2026" should not then print the other spelling underneath it.
  assert.equal(
    readableBlockMessage("2026-10-18 is blocked: ZZ Closed"),
    "Oct 18, 2026 is blocked: ZZ Closed",
  );
  // Anything that is not a date is left exactly as it came.
  assert.equal(readableBlockMessage("No dates here"), "No dates here");
});
