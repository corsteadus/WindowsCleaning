import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildActivityFeed, countFeed, filterFeed, humanAction, lastNoteChange, profileStewardship,
} from "./activity-feed.ts";

const messages = [
  { id: 1, channel: "email", triggerType: "estimate_sent", subject: "Estimate #1042", recipient: "j***@example.com", status: "delivered", relatedType: "quote", relatedId: 42, sentAt: "2026-09-20T10:00:00Z", createdAt: "2026-09-20T09:59:00Z" },
  { id: 2, channel: "sms", triggerType: "appointment_reminder", subject: null, recipient: "(816) ***-0147", status: "sent", relatedType: "job", relatedId: 7, sentAt: "2026-09-22T08:00:00Z", createdAt: "2026-09-22T07:59:00Z" },
];
const changes = [
  { id: 10, action: "customer_created", toValue: "prospect", performedBy: "Team Admin", createdAt: "2026-09-19T09:00:00Z" },
  { id: 11, action: "note_updated", note: "General notes updated", performedBy: "Kyle Stafford", createdAt: "2026-09-21T11:00:00Z" },
  { id: 12, action: "estimate_status_corrected", fromValue: "sent", toValue: "declined", note: "Estimate Q-1 corrected", performedBy: "Team Admin", createdAt: "2026-09-23T15:00:00Z" },
];

test("everything lands in one feed, newest first", () => {
  const feed = buildActivityFeed(messages, changes);
  assert.equal(feed.length, 5);
  assert.deepEqual(feed.map((item) => item.key), [
    "change-12", "message-2", "change-11", "message-1", "change-10",
  ]);
});

test("a message uses when it was sent, not when the row was written", () => {
  const [item] = buildActivityFeed([messages[0]], []);
  assert.equal(item.at, "2026-09-20T10:00:00Z");
});

test("a message that never went out still appears, dated by its row", () => {
  const [item] = buildActivityFeed([{ id: 3, channel: "email", status: "failed", sentAt: null, createdAt: "2026-09-24T09:00:00Z" }], []);
  assert.equal(item.at, "2026-09-24T09:00:00Z");
  assert.equal(item.status, "failed");
});

test("each item says what it was, who it went to, and what it belongs to", () => {
  const feed = buildActivityFeed(messages, []);
  const email = feed.find((item) => item.key === "message-1")!;
  assert.equal(email.kind, "email");
  assert.equal(email.title, "Email: Estimate sent");
  assert.equal(email.detail, "Estimate #1042 · j***@example.com");
  assert.deepEqual(email.related, { type: "quote", id: 42 });
  assert.equal(email.status, "delivered");
  const text = feed.find((item) => item.key === "message-2")!;
  assert.equal(text.kind, "text");
  assert.equal(text.title, "Text: Appointment reminder");
});

test("a profile change shows the movement and who made it", () => {
  const feed = buildActivityFeed([], [changes[2]]);
  assert.equal(feed[0].kind, "change");
  assert.equal(feed[0].title, "Estimate status corrected");
  assert.match(feed[0].detail ?? "", /sent → declined/);
  assert.equal(feed[0].actor, "Team Admin");
});

test("the filters Kyle asked for pick the right items", () => {
  const feed = buildActivityFeed(messages, changes);
  assert.equal(filterFeed(feed, "all").length, 5);
  assert.equal(filterFeed(feed, "email").length, 1);
  assert.equal(filterFeed(feed, "text").length, 1);
  assert.equal(filterFeed(feed, "change").length, 3);
  assert.deepEqual(countFeed(feed), { all: 5, email: 1, text: 1, change: 3 });
});

test("an empty profile has an empty feed rather than an error", () => {
  assert.deepEqual(buildActivityFeed(), []);
  assert.deepEqual(countFeed([]), { all: 0, email: 0, text: 0, change: 0 });
});

test("actions read as words, not as column values", () => {
  assert.equal(humanAction("estimate_status_corrected"), "Estimate status corrected");
  assert.equal(humanAction("job_deleted"), "Job deleted");
  assert.equal(humanAction(""), "Updated");
});

test("Overview can say who created the profile and who touched it last", () => {
  const stewardship = profileStewardship(changes, { createdAt: "2026-09-19T09:00:00Z", updatedAt: "2026-09-23T15:00:00Z" });
  assert.equal(stewardship.createdBy, "Team Admin");
  assert.equal(stewardship.createdAt, "2026-09-19T09:00:00Z");
  assert.equal(stewardship.updatedBy, "Team Admin");
  assert.equal(stewardship.updatedAt, "2026-09-23T15:00:00Z");
});

test("a history with nobody named leaves the names blank rather than guessing", () => {
  const stewardship = profileStewardship([{ id: 1, action: "imported", createdAt: "2026-01-01T00:00:00Z" }]);
  assert.equal(stewardship.createdBy, null);
  assert.equal(stewardship.updatedBy, null);
  assert.equal(stewardship.createdAt, "2026-01-01T00:00:00Z");
});

test("the General Notes card knows who last wrote a note, and when", () => {
  const note = lastNoteChange(changes);
  assert.equal(note?.performedBy, "Kyle Stafford");
  assert.equal(note?.createdAt, "2026-09-21T11:00:00Z");
  assert.equal(lastNoteChange([]), null);
});

test("job and estimate notes are not mistaken for the general ones", () => {
  const note = lastNoteChange([
    { id: 1, action: "note_updated", note: "Specific notes updated", performedBy: "A", createdAt: "2026-09-24T09:00:00Z" },
    { id: 2, action: "note_updated", note: "General notes updated", performedBy: "B", createdAt: "2026-09-23T09:00:00Z" },
  ]);
  assert.equal(note?.performedBy, "B");
});
