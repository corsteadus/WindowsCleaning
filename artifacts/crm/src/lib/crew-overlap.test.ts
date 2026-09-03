import test from "node:test";
import assert from "node:assert/strict";
import {
  describeSpan,
  findCrewOverlaps,
  timeToMinutes,
  type OverlapCandidate,
} from "./crew-overlap.ts";

const job = (over: Partial<OverlapCandidate> = {}): OverlapCandidate => ({
  id: 1,
  crewId: 1,
  startTime: "09:00",
  endTime: "11:00",
  customerLabel: "Casey Tester",
  ...over,
});

const ids = (found: OverlapCandidate[]) => found.map((j) => j.id).sort();

test("a clean day reports no clash", () => {
  const found = findCrewOverlaps(job(), [job({ id: 2, startTime: "13:00", endTime: "15:00" })]);
  assert.deepEqual(found, []);
});

test("the same crew at the same time clashes", () => {
  const found = findCrewOverlaps(job(), [job({ id: 2, startTime: "10:00", endTime: "12:00" })]);
  assert.deepEqual(ids(found), [2]);
});

test("back-to-back work does not clash", () => {
  // 9-11 then 11-13 is a normal day, not a double booking.
  const found = findCrewOverlaps(job(), [job({ id: 2, startTime: "11:00", endTime: "13:00" })]);
  assert.deepEqual(found, []);
  const before = findCrewOverlaps(job(), [job({ id: 3, startTime: "07:00", endTime: "09:00" })]);
  assert.deepEqual(before, []);
});

test("a job fully inside another clashes", () => {
  const found = findCrewOverlaps(job(), [job({ id: 2, startTime: "09:30", endTime: "10:00" })]);
  assert.deepEqual(ids(found), [2]);
});

test("a job fully containing another clashes", () => {
  const found = findCrewOverlaps(
    job({ startTime: "09:30", endTime: "10:00" }),
    [job({ id: 2, startTime: "09:00", endTime: "11:00" })],
  );
  assert.deepEqual(ids(found), [2]);
});

test("a different crew never clashes", () => {
  const found = findCrewOverlaps(job(), [job({ id: 2, crewId: 2, startTime: "09:00", endTime: "11:00" })]);
  assert.deepEqual(found, []);
});

test("unassigned work never clashes", () => {
  // Nothing is being double-booked, and warning here would teach the office
  // to dismiss the warning.
  assert.deepEqual(findCrewOverlaps(job({ crewId: null }), [job({ id: 2 })]), []);
  assert.deepEqual(findCrewOverlaps(job(), [job({ id: 2, crewId: null })]), []);
});

test("a job never clashes with itself", () => {
  const moving = job();
  assert.deepEqual(findCrewOverlaps(moving, [moving]), []);
});

test("a job with no time cannot clash by time", () => {
  assert.deepEqual(findCrewOverlaps(job({ startTime: null }), [job({ id: 2 })]), []);
  assert.deepEqual(findCrewOverlaps(job(), [job({ id: 2, startTime: null })]), []);
});

test("an open-ended job is a moment, not a guessed duration", () => {
  // 09:00 with no end must not be assumed to run into the 10:00 job.
  const openEnded = job({ endTime: null });
  assert.deepEqual(findCrewOverlaps(openEnded, [job({ id: 2, startTime: "10:00", endTime: "12:00" })]), []);
  // But two jobs starting at the same minute are plainly a clash.
  assert.deepEqual(
    ids(findCrewOverlaps(openEnded, [job({ id: 3, startTime: "09:00", endTime: null })])),
    [3],
  );
});

test("an open-ended job still clashes with work already running", () => {
  const found = findCrewOverlaps(
    job({ startTime: "10:00", endTime: null }),
    [job({ id: 2, startTime: "09:00", endTime: "11:00" })],
  );
  assert.deepEqual(ids(found), [2]);
});

test("an end before its start is treated as open-ended, not negative", () => {
  const broken = job({ startTime: "10:00", endTime: "08:00" });
  assert.deepEqual(findCrewOverlaps(broken, [job({ id: 2, startTime: "13:00", endTime: "15:00" })]), []);
  assert.deepEqual(ids(findCrewOverlaps(broken, [job({ id: 3, startTime: "09:00", endTime: "11:00" })])), [3]);
});

test("every clash on the day is reported, not just the first", () => {
  const found = findCrewOverlaps(job({ startTime: "09:00", endTime: "17:00" }), [
    job({ id: 2, startTime: "10:00", endTime: "11:00" }),
    job({ id: 3, startTime: "13:00", endTime: "14:00" }),
    job({ id: 4, crewId: 2, startTime: "10:00", endTime: "11:00" }),
    job({ id: 5, startTime: "18:00", endTime: "19:00" }),
  ]);
  assert.deepEqual(ids(found), [2, 3]);
});

test("times parse with or without padding and seconds", () => {
  assert.equal(timeToMinutes("09:00"), 540);
  assert.equal(timeToMinutes("9:00"), 540);
  assert.equal(timeToMinutes("09:00:00"), 540);
  assert.equal(timeToMinutes("23:59"), 1439);
  assert.equal(timeToMinutes("00:00"), 0);
});

test("unusable times are rejected rather than guessed", () => {
  for (const bad of [null, undefined, "", "noon", "25:00", "09:70", "9"]) {
    assert.equal(timeToMinutes(bad as string), null, `${String(bad)} must not parse`);
  }
});

test("midnight is a real time, not a missing one", () => {
  // 0 is falsy; a naive check would treat midnight as no time at all.
  const found = findCrewOverlaps(
    job({ startTime: "00:00", endTime: "02:00" }),
    [job({ id: 2, startTime: "01:00", endTime: "03:00" })],
  );
  assert.deepEqual(ids(found), [2]);
});

test("spans read back in plain language", () => {
  assert.equal(describeSpan(job()), "9:00 am – 11:00 am");
  assert.equal(describeSpan(job({ startTime: "13:00", endTime: "17:30" })), "1:00 pm – 5:30 pm");
  assert.equal(describeSpan(job({ endTime: null })), "9:00 am");
  assert.equal(describeSpan(job({ startTime: null })), "No time");
  assert.equal(describeSpan(job({ startTime: "00:00", endTime: null })), "12:00 am");
});
