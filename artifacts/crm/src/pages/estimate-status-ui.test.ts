// Random Edits #4: one derived status, shown the same way on every screen, and
// correctable by an authorised employee.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CORRECTABLE_ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS, estimateStatusOf } from "../lib/estimate-status.ts";

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

test("every status Kyle listed has a label and a badge", () => {
  for (const status of ["draft", "sent", "viewed", "accepted", "declined", "expired"]) {
    assert.ok(ESTIMATE_STATUS_LABELS[status], `${status} has no label`);
    assert.match(badge, new RegExp(`\\b${status}:`), `${status} has no badge`);
  }
});

test("the list, the profile and the estimate page all read the derived status", () => {
  assert.match(quotes, /<StatusBadge status=\{estimateStatusOf\(quote\)\} \/>/);
  assert.match(customerDetail, /<StatusBadge status=\{estimateStatusOf\(q\)\} \/>/);
  assert.match(quoteDetail, /estimateStatusLabel\(status\)/);
});

test("the list filters are Kyle's statuses, not the old column's words", () => {
  assert.match(quotes, /const FILTERS = \["all", "draft", "sent", "viewed", "accepted", "declined", "expired"\] as const;/);
  assert.doesNotMatch(quotes, /label: "Approved"/);
  assert.doesNotMatch(quotes, /label: "Rejected"/);
});

test("filtering and counting use the derived status too", () => {
  assert.match(quotes, /filter === "all" \|\| estimateStatusOf\(q\) === filter/);
  assert.match(quotes, /estimateStatusOf\(q\)\.startsWith\("accepted"\)/, "an accepted estimate with a job must still count as accepted");
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
