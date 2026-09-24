import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuoteStatusInputs, deriveQuoteStatuses } from "./estimate-status-batch.ts";

const NOW = new Date("2026-09-24T12:00:00Z");

test("a page of estimates gets one status each, from one pass", () => {
  const statuses = deriveQuoteStatuses({
    quotes: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
    appointments: [{ quoteId: 2 }],
    revisions: [
      { quoteId: 3, id: 30, revisionNumber: 1 },
      { quoteId: 4, id: 40, revisionNumber: 1 },
      { quoteId: 5, id: 50, revisionNumber: 1 },
    ],
    links: [
      { quoteId: 3, revisionId: 30, sentAt: "2026-09-01T09:00:00Z", expiresAt: "2026-10-01T09:00:00Z" },
      { quoteId: 4, revisionId: 40, sentAt: "2026-09-01T09:00:00Z", firstOpenedAt: "2026-09-02T09:00:00Z", expiresAt: "2026-10-01T09:00:00Z" },
      { quoteId: 5, revisionId: 50, sentAt: "2026-08-01T09:00:00Z", expiresAt: "2026-09-10T09:00:00Z" },
    ],
    jobs: [],
  }, NOW);
  assert.equal(statuses.get(1), "draft");
  assert.equal(statuses.get(2), "scheduled");
  assert.equal(statuses.get(3), "sent");
  assert.equal(statuses.get(4), "viewed");
  assert.equal(statuses.get(5), "expired");
});

test("the newest revision and the most recent link are the ones that count", () => {
  const inputs = buildQuoteStatusInputs({
    quotes: [{ id: 7 }],
    appointments: [],
    revisions: [
      { quoteId: 7, id: 70, revisionNumber: 1 },
      { quoteId: 7, id: 71, revisionNumber: 2 },
    ],
    links: [
      { quoteId: 7, revisionId: 71, sentAt: "2026-09-10T09:00:00Z", expiresAt: "2026-10-10T09:00:00Z" },
      { quoteId: 7, revisionId: 70, sentAt: "2026-09-01T09:00:00Z", decision: "declined" },
    ],
    jobs: [],
  });
  const input = inputs.get(7)!;
  assert.equal(input.decision, null, "the declined link belongs to the superseded revision");
  assert.equal(input.sentAt, "2026-09-10T09:00:00Z");
});

test("a link left over from an older revision says nothing about this one", () => {
  const statuses = deriveQuoteStatuses({
    quotes: [{ id: 8 }],
    appointments: [],
    revisions: [{ quoteId: 8, id: 81, revisionNumber: 2 }],
    links: [{ quoteId: 8, revisionId: 80, sentAt: "2026-09-01T09:00:00Z", decision: "accepted" }],
    jobs: [],
  }, NOW);
  assert.equal(statuses.get(8), "draft");
});

test("an accepted estimate with a job reads as accepted and scheduled", () => {
  const statuses = deriveQuoteStatuses({
    quotes: [{ id: 9 }, { id: 10 }],
    appointments: [],
    revisions: [{ quoteId: 9, id: 90, revisionNumber: 1 }, { quoteId: 10, id: 100, revisionNumber: 1 }],
    links: [
      { quoteId: 9, revisionId: 90, sentAt: "2026-09-01T09:00:00Z", decision: "accepted" },
      { quoteId: 10, revisionId: 100, sentAt: "2026-09-01T09:00:00Z", decision: "accepted" },
    ],
    jobs: [{ quoteId: 10 }],
  }, NOW);
  assert.equal(statuses.get(9), "accepted");
  assert.equal(statuses.get(10), "accepted_scheduled");
});

test("a status corrected by hand is carried into the list", () => {
  const statuses = deriveQuoteStatuses({
    quotes: [{ id: 11, status: "expired" }],
    appointments: [],
    revisions: [{ quoteId: 11, id: 110, revisionNumber: 1 }],
    links: [{ quoteId: 11, revisionId: 110, sentAt: "2026-09-01T09:00:00Z", expiresAt: "2026-12-01T09:00:00Z" }],
    jobs: [],
  }, NOW);
  assert.equal(statuses.get(11), "expired");
});

test("estimates with nothing attached still get a status", () => {
  const statuses = deriveQuoteStatuses({ quotes: [{ id: 12 }], appointments: [], revisions: [], links: [], jobs: [] }, NOW);
  assert.equal(statuses.get(12), "draft");
  assert.equal(statuses.size, 1);
});
