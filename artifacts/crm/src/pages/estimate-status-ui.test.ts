// Random Edits #4: one derived status, shown the same way on every screen, and
// correctable by an authorised employee.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CORRECTABLE_ESTIMATE_STATUSES,
  ESTIMATE_STATUS_LABELS,
  estimateStatusGroup,
  estimateStatusOf,
} from "../lib/estimate-status.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const quotes = read("./Quotes.tsx");
const quoteDetail = read("./QuoteDetail.tsx");
const customerDetail = read("./CustomerDetail.tsx");
const badge = read("../components/StatusBadge.tsx");

test("the derived status is preferred, with the old column as the fallback", () => {
  assert.equal(estimateStatusOf({ displayStatus: "viewed", status: "draft" }), "viewed");
  assert.equal(estimateStatusOf({ status: "sent" }), "sent");
  assert.equal(estimateStatusOf({}), "draft");
  assert.equal(estimateStatusOf(null), "draft");
});

test("a status that reads as Open is counted as Open", () => {
  // Sandbox 2, 2026-10-05: a quote badged Open while the Open tile said 0, and
  // the six tiles summed to one of two quotes. `scheduled` reads as Open and
  // was counted nowhere.
  assert.equal(estimateStatusGroup("scheduled"), "draft");
  assert.equal(estimateStatusGroup("draft"), "draft");
  assert.equal(estimateStatusGroup("accepted_scheduled"), "accepted");
  assert.equal(estimateStatusGroup("accepted"), "accepted");
  for (const status of ["sent", "viewed", "declined", "expired"]) {
    assert.equal(estimateStatusGroup(status), status);
  }
  assert.equal(estimateStatusGroup("something new"), "draft", "an unknown status is not lost");
});

test("every derived status falls into one of Kyle's six", () => {
  // Nothing may be counted nowhere, which is the fault this guards.
  for (const status of ["draft", "scheduled", "sent", "viewed", "accepted", "accepted_scheduled", "declined", "expired"]) {
    const group = estimateStatusGroup(status);
    assert.ok(ESTIMATE_STATUS_LABELS[group], `${status} groups to ${group}, which has no label`);
    assert.equal(
      ESTIMATE_STATUS_LABELS[group], ESTIMATE_STATUS_LABELS[status],
      `${status} is badged differently from the group it counts in`,
    );
  }
});

test("the quotes list counts and filters by that group, not by the raw status", () => {
  assert.match(quotes, /const groupOf = /);
  assert.match(quotes, /estimateStatusGroup\(estimateStatusOf\(quote\)\)/);
  assert.doesNotMatch(quotes, /estimateStatusOf\(q\) === "draft"/);
  assert.match(quotes, /filter === "all" \|\| groupOf\(q\) === filter/);
});

test("every status Kyle listed has a label and a badge", () => {
  for (const status of ["draft", "sent", "viewed", "accepted", "declined", "expired"]) {
    assert.ok(ESTIMATE_STATUS_LABELS[status], `${status} has no label`);
    assert.match(badge, new RegExp(`\\b${status}:`), `${status} has no badge`);
  }
});

test("the list, the profile and the estimate page all read the derived status", () => {
  assert.match(quotes, /<StatusBadge status=\{estimateStatusOf\(quote\)\}/);
  assert.match(customerDetail, /<StatusBadge status=\{estimateStatusOf\(q\)\}/);
  assert.match(quoteDetail, /estimateStatusLabel\(status\)/);
});

// Kyle (Testing Edits, 2026-10-01, #10): the badge is shared with jobs and
// invoices, whose "draft" is still a draft — so the estimate screens pass their
// own wording rather than renaming it for everyone.
test("the estimate badges carry the estimate wording", () => {
  assert.match(quotes, /label=\{estimateStatusLabel\(estimateStatusOf\(quote\)\)\}/);
  assert.match(customerDetail, /label=\{estimateStatusLabel\(estimateStatusOf\(q\)\)\}/);
  assert.match(badge, /label\?: string;/, "StatusBadge has to accept an override");
  assert.match(badge, /\{label \?\? cfg\.label\}/);
});

test("the six words are the ones Kyle named", () => {
  assert.equal(ESTIMATE_STATUS_LABELS.draft, "Open");
  assert.equal(ESTIMATE_STATUS_LABELS.sent, "Pending – Sent Only");
  assert.equal(ESTIMATE_STATUS_LABELS.viewed, "Pending – Sent and Viewed");
  assert.equal(ESTIMATE_STATUS_LABELS.accepted, "Accepted");
  assert.equal(ESTIMATE_STATUS_LABELS.declined, "Declined");
  assert.equal(ESTIMATE_STATUS_LABELS.expired, "Closed");
  // an estimate already turned into a job still reads Accepted to the office
  assert.equal(ESTIMATE_STATUS_LABELS.accepted_scheduled, "Accepted");
});

test("the list filters are Kyle's statuses, not the old column's words", () => {
  assert.match(quotes, /const FILTERS = \["all", "draft", "sent", "viewed", "accepted", "declined", "expired"\] as const;/);
  assert.doesNotMatch(quotes, /label: "Approved"/);
  assert.doesNotMatch(quotes, /label: "Rejected"/);
});

test("filtering and counting use the derived status too", () => {
  // Through the group, since 2026-10-05: comparing the derived status directly
  // left `scheduled` — which reads as Open — out of every tile.
  assert.match(quotes, /filter === "all" \|\| groupOf\(q\) === filter/);
  assert.equal(
    estimateStatusGroup("accepted_scheduled"), "accepted",
    "an accepted estimate with a job must still count as accepted",
  );
  assert.doesNotMatch(quotes, /q\.status === "approved"/);
});

test("correcting a status is offered only to those allowed, and never on an accepted estimate", () => {
  assert.match(quoteDetail, /hasClientCapability\(user, "quotes\.manage"\)/);
  assert.match(quoteDetail, /\{canCorrectStatus && status !== "accepted" && status !== "accepted_scheduled" &&/);
});

test("the correction sends the status and reason to the server", () => {
  assert.match(quoteDetail, /\/quotes\/\$\{quote\.id\}\/status`, \{[\s\S]{0,200}method: "PATCH"/);
  assert.match(quoteDetail, /body: JSON\.stringify\(\{ status: correction, reason: correctionReason \}\)/);
});

test("only correctable statuses are offered, acceptance excluded", () => {
  assert.deepEqual([...CORRECTABLE_ESTIMATE_STATUSES], ["draft", "sent", "viewed", "declined", "expired"]);
  assert.match(quoteDetail, /CORRECTABLE_ESTIMATE_STATUSES\.map/);
  assert.ok(!CORRECTABLE_ESTIMATE_STATUSES.includes("accepted" as never));
});
