import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPage,
  dropEntry,
  emptyCopy,
  formatCents,
  isQueueTabKey,
  queueStatusLabel,
  statusChips,
  totalCount,
  waitingLabel,
  waitingTone,
} from "./schedule-queue-view.ts";

/* -- Plain language, spec §4.3 ------------------------------------------ */

test("the reference system's abbreviations are replaced with words", () => {
  assert.equal(queueStatusLabel("needs_contact"), "Needs Contact");
  assert.equal(queueStatusLabel("waiting_on_materials"), "Waiting on Materials");
});

test("a reason the UI has not learned yet still reads as words", () => {
  // The server owns the list; a new one must not render as raw snake_case.
  assert.equal(queueStatusLabel("waiting_on_permit"), "Waiting On Permit");
});

test("no reason is said plainly, not left blank", () => {
  assert.equal(queueStatusLabel(null), "No status");
  assert.equal(queueStatusLabel(undefined), "No status");
  assert.equal(queueStatusLabel(""), "No status");
});

/* -- Days waiting, spec §4.2 -------------------------------------------- */

test("a job that arrived today reads as Today, not as a broken counter", () => {
  assert.equal(waitingLabel(0), "Today");
});

test("one day is singular", () => {
  assert.equal(waitingLabel(1), "1 day");
  assert.equal(waitingLabel(2), "2 days");
});

test("a negative or nonsense wait never renders", () => {
  for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(waitingLabel(bad), "Today", String(bad));
  }
});

test("the badge escalates at a week and at a month", () => {
  assert.equal(waitingTone(0), "fresh");
  assert.equal(waitingTone(6), "fresh");
  assert.equal(waitingTone(7), "aging");
  assert.equal(waitingTone(29), "aging");
  assert.equal(waitingTone(30), "stale");
});

/* -- Money -------------------------------------------------------------- */

test("cents render as money", () => {
  assert.equal(formatCents(12_500), "$125.00");
  assert.equal(formatCents(0), "$0.00");
});

test("a hidden amount stays hidden rather than becoming zero", () => {
  // Field techs receive null. Rendering $0.00 would claim the job is free.
  assert.equal(formatCents(null), null);
  assert.equal(formatCents(undefined), null);
});

/* -- Filter chips ------------------------------------------------------- */

test("chips keep the canonical order, not the order of counts", () => {
  // A list that reorders as work moves is hard to click twice.
  const chips = statusChips({ weather_hold: 9, needs_contact: 1, contacted: 5 });
  assert.deepEqual(chips.map((c) => c.status), ["needs_contact", "contacted", "weather_hold"]);
});

test("a reason with no work gets no chip", () => {
  const chips = statusChips({ needs_contact: 2, weather_hold: 0 });
  assert.deepEqual(chips.map((c) => c.status), ["needs_contact"]);
});

test("a reason the UI does not know still gets a chip, after the known ones", () => {
  const chips = statusChips({ waiting_on_permit: 3, needs_contact: 1 });
  assert.deepEqual(chips.map((c) => c.status), ["needs_contact", "waiting_on_permit"]);
});

test("entries with no reason are counted but get no chip of their own", () => {
  const counts = { needs_contact: 2, unspecified: 4 };
  assert.equal(totalCount(counts), 6);
  assert.deepEqual(statusChips(counts).map((c) => c.status), ["needs_contact"]);
});

test("no counts yet is zero and no chips, not a crash", () => {
  assert.equal(totalCount(undefined), 0);
  assert.deepEqual(statusChips(undefined), []);
});

/* -- Paging ------------------------------------------------------------- */

const card = (entryId: number) => ({ entryId });

test("pages accumulate in order", () => {
  const result = appendPage([card(1), card(2)], [card(3)]);
  assert.deepEqual(result.map((c) => c.entryId), [1, 2, 3]);
});

test("the same page appended twice does not duplicate the list", () => {
  // Strict mode double-invocation makes this easy to write and hard to see.
  const first = appendPage([], [card(1), card(2)]);
  const again = appendPage(first, [card(1), card(2)]);
  assert.deepEqual(again.map((c) => c.entryId), [1, 2]);
});

test("a page that adds nothing returns the same array, so React skips a render", () => {
  const existing = [card(1)];
  assert.equal(appendPage(existing, [card(1)]), existing);
});

test("an overlapping page keeps only what is new", () => {
  const result = appendPage([card(1), card(2)], [card(2), card(3)]);
  assert.deepEqual(result.map((c) => c.entryId), [1, 2, 3]);
});

test("a card that moved tabs is removed without touching the rest", () => {
  const result = dropEntry([card(1), card(2), card(3)], 2);
  assert.deepEqual(result.map((c) => c.entryId), [1, 3]);
});

/* -- Empty states ------------------------------------------------------- */

test("a filtered-empty tab does not claim the queue is clear", () => {
  const filtered = emptyCopy("ready", true);
  const empty = emptyCopy("ready", false);
  assert.notEqual(filtered.title, empty.title);
  assert.match(filtered.body, /filter/i);
});

test("each tab explains itself when empty", () => {
  assert.match(emptyCopy("on_hold", false).body, /pause/i);
  assert.match(emptyCopy("due", false).body, /recurring/i);
  assert.match(emptyCopy("ready", false).body, /no date/i);
});

test("only the three tabs are accepted", () => {
  for (const key of ["ready", "on_hold", "due"]) assert.equal(isQueueTabKey(key), true, key);
  for (const key of ["queued", "", null, undefined, 1]) {
    assert.equal(isQueueTabKey(key), false, String(key));
  }
});
