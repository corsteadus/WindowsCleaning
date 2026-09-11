import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeQueueCursor,
  decideQueueStatusChange,
  decideSchedule,
  tabState,
  toQueueCard,
  toQueuePage,
  type EntrySnapshot,
  type QueueEntryRow,
} from "./schedule-queue-core.ts";

const NOW = new Date("2026-09-11T12:00:00.000Z");

function row(overrides: Partial<QueueEntryRow> = {}): QueueEntryRow {
  return {
    entryId: 1,
    jobId: 10,
    jobNumber: "JOB-0001",
    status: "queued",
    queueStatus: "needs_contact",
    onHoldReason: null,
    callbackDate: null,
    queuedAt: "2026-09-01T12:00:00.000Z",
    valueCents: "12500",
    serviceType: "window_cleaning",
    jobStatus: "unscheduled",
    durationMinutes: 90,
    customerLabel: "Dana Whitfield",
    clientType: "residential",
    propertyLabel: "84 Cedar Lane",
    ...overrides,
  };
}

function entry(overrides: Partial<EntrySnapshot> = {}): EntrySnapshot {
  return { state: "queued", hasInvoice: false, jobStatus: "unscheduled", ...overrides };
}

/* -- Card mapping ------------------------------------------------------- */

test("cents arrive as a string from numeric(18,0) and leave as a number", () => {
  const card = toQueueCard(row({ valueCents: "12500" }), NOW);
  assert.equal(card.valueCents, 12_500);
  assert.equal(typeof card.valueCents, "number");
});

test("a hidden amount stays null rather than becoming zero", () => {
  // Field techs get NULL::bigint, and a zero here would read as a free job.
  assert.equal(toQueueCard(row({ valueCents: null }), NOW).valueCents, null);
});

test("days waiting is counted from the queued instant", () => {
  assert.equal(toQueueCard(row(), NOW).daysWaiting, 10);
});

test("a clock skew reads as today, never as a negative wait", () => {
  const card = toQueueCard(row({ queuedAt: "2026-09-12T00:00:00.000Z" }), NOW);
  assert.equal(card.daysWaiting, 0);
});

test("a Date from the driver and an ISO string produce the same card", () => {
  const fromDate = toQueueCard(row({ queuedAt: new Date("2026-09-01T12:00:00.000Z") }), NOW);
  assert.deepEqual(fromDate, toQueueCard(row(), NOW));
});

test("an unrecognised waiting reason reads as none, not as raw database text", () => {
  assert.equal(toQueueCard(row({ queueStatus: "SCH/PEND" }), NOW).queueStatus, null);
});

/* -- Page shaping ------------------------------------------------------- */

const page = (count: number, limit: number) =>
  toQueuePage(
    Array.from({ length: count }, (_, i) => row({ entryId: i + 1 })),
    limit,
    NOW,
  );

test("the extra row is used to answer hasMore and never returned", () => {
  const result = page(11, 10);
  assert.equal(result.items.length, 10);
  assert.equal(result.hasMore, true);
  assert.equal(result.items.at(-1)?.entryId, 10);
});

test("an exactly full page is not a truncated one", () => {
  const result = page(10, 10);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
});

test("the last page issues no cursor, so a caller following cursors stops", () => {
  assert.equal(page(3, 10).nextCursor, null);
});

test("the cursor points at the last returned row, not the peeked one", () => {
  const result = page(11, 10);
  const decoded = decodeQueueCursor(result.nextCursor!);
  assert.equal(decoded?.id, 10);
  assert.equal(decoded?.queuedAt, "2026-09-01T12:00:00.000Z");
});

test("an empty queue is a valid page, not an error", () => {
  const result = page(0, 10);
  assert.deepEqual(result.items, []);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
});

test("each tab reads its own entry state", () => {
  assert.equal(tabState("ready"), "queued");
  assert.equal(tabState("on_hold"), "on_hold");
});

/* -- Scheduling from the queue ------------------------------------------ */

test("scheduling needs a real calendar date", () => {
  for (const bad of [undefined, "", "2026-13-01", "2026-02-30", "11/09/2026"]) {
    const decision = decideSchedule(entry(), { scheduledDate: bad });
    assert.equal(decision.ok, false);
    assert.equal(decision.ok === false && decision.reason, "bad_date");
  }
});

test("a date with no times is a whole-day booking, not a refusal", () => {
  const decision = decideSchedule(entry(), { scheduledDate: "2026-09-15" });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.startTime, null);
});

test("both time shapes the API has always accepted still work", () => {
  for (const time of ["09:30", "09:30:00"]) {
    const decision = decideSchedule(entry(), { scheduledDate: "2026-09-15", startTime: time });
    assert.equal(decision.ok, true, `rejected ${time}`);
  }
});

test("an end before the start is refused, comparing minutes not text length", () => {
  const decision = decideSchedule(entry(), {
    scheduledDate: "2026-09-15",
    startTime: "14:00:00",
    endTime: "09:30",
  });
  assert.equal(decision.ok === false && decision.reason, "reversed_time");
});

test("equal start and end is allowed — a zero-length visit is a caller's business", () => {
  const decision = decideSchedule(entry(), {
    scheduledDate: "2026-09-15",
    startTime: "09:30",
    endTime: "09:30:00",
  });
  assert.equal(decision.ok, true);
});

test("completed work keeps the date it happened on", () => {
  const decision = decideSchedule(
    entry({ jobStatus: "completed" }),
    { scheduledDate: "2026-09-15" },
  );
  assert.equal(decision.ok === false && decision.reason, "completed");
});

test("both spellings of cancelled are treated as finished", () => {
  for (const spelling of ["canceled", "cancelled", "CANCELLED", " Cancelled "]) {
    const decision = decideSchedule(entry({ jobStatus: spelling }), { scheduledDate: "2026-09-15" });
    assert.equal(decision.ok, false, `accepted ${spelling}`);
  }
});

test("work already on the calendar is refused, and told to reschedule instead", () => {
  const decision = decideSchedule(entry({ state: "scheduled" }), { scheduledDate: "2026-09-15" });
  assert.equal(decision.ok === false && decision.reason, "already_there");
  assert.match(decision.ok === false ? decision.message : "", /reschedule/i);
});

test("the date is checked after the state, so the message names the real problem", () => {
  // A cancelled entry with a bad date should say it is cancelled, not that the
  // date is malformed — the date is not what the caller has to fix.
  const decision = decideSchedule(entry({ state: "canceled" }), { scheduledDate: "nonsense" });
  assert.equal(decision.ok === false && decision.reason, "not_queueable");
});

/* -- Changing the waiting reason ---------------------------------------- */

test("only work off the calendar can be waiting on something", () => {
  const decision = decideQueueStatusChange(entry({ state: "scheduled" }), "needs_contact");
  assert.equal(decision.ok === false && decision.reason, "not_queueable");
});

test("held work can have its waiting reason changed", () => {
  const decision = decideQueueStatusChange(entry({ state: "on_hold" }), "waiting_on_materials");
  assert.equal(decision.ok, true);
});

test("an invented waiting reason is refused before it reaches the constraint", () => {
  const decision = decideQueueStatusChange(entry(), "waiting_on_vibes");
  assert.equal(decision.ok === false && decision.reason, "bad_status");
});

/* -- Who may reach the queue -------------------------------------------- */

test("reading the queue needs scheduling sight; moving work needs authority", async () => {
  const auth = await import("./authorization.ts");
  const read = auth.requiredCapabilityForRequest("GET", "/schedule-queue");
  assert.equal(read, "schedule.view");

  for (const path of [
    "/schedule-queue/12/schedule",
    "/schedule-queue/12/hold",
    "/schedule-queue/12/release",
  ]) {
    assert.equal(auth.requiredCapabilityForRequest("POST", path), "schedule.manage", path);
  }
  assert.equal(
    auth.requiredCapabilityForRequest("PATCH", "/schedule-queue/12/status"),
    "schedule.manage",
  );
});

test("field techs and sales may see the queue but never move work through it", async () => {
  const auth = await import("./authorization.ts");
  for (const role of ["field_tech", "sales"]) {
    assert.equal(auth.hasCapability(role, "schedule.view"), true, `${role} cannot read`);
    assert.equal(auth.hasCapability(role, "schedule.manage"), false, `${role} can write`);
  }
});

test("the queue is not accidentally covered by the /schedule rule", async () => {
  const auth = await import("./authorization.ts");
  // matchesPrefix requires an exact match or a trailing slash, so "/schedule"
  // must not swallow "/schedule-queue". If it ever did, POSTs would fall
  // through to no capability at all and become open to every known role.
  assert.notEqual(auth.requiredCapabilityForRequest("POST", "/schedule-queue/1/hold"), null);
});

test("a field tech's queue read is scoped and priceless", async () => {
  const { queueVisibility } = await import("./schedule-queue-scope.ts");
  const scoped = queueVisibility(true, "user-1");
  assert.equal(scoped.showAmounts, false);

  const open = queueVisibility(false, "user-1");
  assert.equal(open.showAmounts, true);
  // The two filters must not be the same object, or one role's scoping would
  // silently apply to the other.
  assert.notEqual(scoped.jobFilter, open.jobFilter);
});

test("a scoped role with no user id sees nothing, not everything", async () => {
  const { queueVisibility } = await import("./schedule-queue-scope.ts");
  // Unreachable in practice — authorization runs first — but the failure mode
  // has to be an empty queue rather than the whole company's work.
  const orphan = queueVisibility(true, undefined);
  assert.equal(orphan.showAmounts, false);
  assert.notEqual(orphan.jobFilter, queueVisibility(false, undefined).jobFilter);
});
