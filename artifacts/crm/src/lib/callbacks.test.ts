import assert from "node:assert/strict";
import { test } from "node:test";

import { bookingTarget, callbackDueAt, defaultNextCallback, dueBucket, groupByDue } from "./callbacks.ts";

// 2026-10-26 is a Monday; 15:00Z is 10:00 AM in Chicago (CDT).
const now = new Date("2026-10-26T15:00:00Z");

test("overdue, today and coming up — by the business's day, not the viewer's", () => {
  assert.equal(dueBucket("2026-10-26T14:00:00Z", now), "overdue");
  assert.equal(dueBucket("2026-10-27T03:00:00Z", now), "today"); // 10 PM Chicago, still the 26th
  assert.equal(dueBucket("2026-10-27T06:00:00Z", now), "upcoming"); // 1 AM Chicago on the 27th
});

test("the list is grouped overdue first, empty groups left out", () => {
  const groups = groupByDue([{ dueAt: "2026-10-30T15:00:00Z" }, { dueAt: "2026-10-20T15:00:00Z" }], now);
  assert.deepEqual(groups.map((g) => g.bucket), ["overdue", "upcoming"]);
});

test("the next try defaults to the next weekday at 10:00", () => {
  assert.deepEqual(defaultNextCallback(now), { date: "2026-10-27", time: "10:00" });
  assert.deepEqual(defaultNextCallback(new Date("2026-10-30T15:00:00Z")), { date: "2026-11-02", time: "10:00" }); // Friday -> Monday
});

test("a Chicago date and time becomes the instant stored", () => {
  assert.equal(callbackDueAt("2026-10-27", "10:00"), "2026-10-27T15:00:00.000Z");
  assert.equal(callbackDueAt("", "10:00"), null);
});

test("booking: a prospect's estimate is converted; without one, an estimate is made; a customer gets a job", () => {
  assert.equal(bookingTarget({ list: "prospect", estimates: 2 }), "convert");
  assert.equal(bookingTarget({ list: "prospect", estimates: 0 }), "estimate");
  assert.equal(bookingTarget({ list: "customer", estimates: 3 }), "job");
});
