// A2 (Kyle, Videos 7 and 9): the estimate's history says what happened, who did it, and which address.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { describeEstimateActivity, openSummary, type HistoryActivity } from "./estimate-history.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const at = "2026-10-29T14:00:00Z";
const deliveries = [
  { id: 5, publicLinkId: 9, channel: "email", recipient: "ann@example.com" },
  { id: 6, publicLinkId: 9, channel: "email", recipient: "bob@example.com" },
];
const describe = (activity: Partial<HistoryActivity>) => describeEstimateActivity(
  { id: 1, occurredAt: at, activityType: "x", ...activity },
  { actors: { u1: "Lute Atieh" }, deliveries },
);

test("an office step names the person, never a user id", () => {
  const line = describe({ activityType: "estimate_sent", actorType: "staff", actorId: "u1", publicLinkId: 9, detail: { via: "estimate_email", attachPdf: true } });
  assert.equal(line.title, "Emailed the estimate");
  assert.equal(line.who, "Lute Atieh");
  assert.equal(line.by, "office");
  assert.equal(line.detail, "to ann@example.com, bob@example.com with the PDF attached");
});

test("an unknown team member still reads as the office", () => {
  assert.equal(describe({ activityType: "revision_created", actorType: "staff", actorId: "gone" }).who, "Office");
});

test("an open says which address's copy it was", () => {
  const line = describe({ activityType: "opened", actorType: "customer", detail: { deliveryRequestId: 6, via: "page", openCount: 2 } });
  assert.equal(line.title, "Opened the estimate");
  assert.equal(line.who, "Customer");
  assert.equal(line.detail, "through the link sent to bob@example.com (visit 2)");
  const copied = describe({ activityType: "opened", actorType: "customer", detail: { deliveryRequestId: null, via: "pdf", openCount: 1 } });
  assert.equal(copied.title, "Opened the PDF");
  assert.equal(copied.detail, "through a copied link");
});

test("the customer's acceptance tells the office's from the customer's", () => {
  const online = describe({ activityType: "estimate_accepted", actorType: "customer", detail: { whole: false, acceptedTotal: 300, acceptedLineItemIds: [1], declinedLineItemIds: [2], customerNotes: "Gate unlocked" } });
  assert.equal(online.title, "Accepted online");
  assert.equal(online.detail, "1 of 2 services, $300.00 · Notes: “Gate unlocked”");
  const verbal = describe({ activityType: "verbal_acceptance_recorded", actorType: "staff", actorId: "u1", detail: { note: "Said yes on the phone" } });
  assert.equal(verbal.title, "Accepted by phone or in person, recorded by the office");
  assert.equal(verbal.who, "Lute Atieh");
});

test("a decline shows the reason and the follow-up request", () => {
  const line = describe({ activityType: "estimate_declined", actorType: "customer", detail: { declineReason: "Too high", followUpRequested: true } });
  assert.equal(line.detail, "Reason: “Too high” · asked to be contacted");
  assert.equal(describe({ activityType: "estimate_declined", actorType: "customer", detail: {} }).detail, "No reason given");
});

test("Corstead's own emails are marked automatic, with the reason one was not sent", () => {
  const skipped = describe({ activityType: "customer_thank_you_skipped", actorType: "system", detail: { reason: "turned_off" } });
  assert.equal(skipped.who, "Corstead (automatic)");
  assert.equal(skipped.detail, "turned off in Settings");
  assert.equal(describe({ activityType: "office_notified", actorType: "system", detail: { subject: "Q-1 opened by Ann" } }).detail, "Q-1 opened by Ann");
});

test("an activity this file does not know still reads as words", () => {
  assert.equal(describe({ activityType: "status_corrected" }).title, "Status corrected");
});

test("each address says whether and how often it opened", () => {
  assert.equal(openSummary({ openCount: 0 }), "Not opened yet");
  assert.match(openSummary({ openCount: 1, lastOpenedAt: at }), /^Opened once, last /);
  assert.equal(openSummary({ openCount: 3 }), "Opened 3 times");
});

test("the estimate page shows the history and the opens per address", () => {
  const page = read("../pages/QuoteDetail.tsx");
  assert.match(page, /describeEstimateActivity\(item, \{ actors: data\.actors, deliveries: data\.deliveries \}\)/);
  assert.match(page, /data-testid="delivery-opens">\{openSummary\(item\)\}/);
  assert.match(page, /data-testid="copied-link-opens"/);
  assert.doesNotMatch(page, /item\.activityType\.replaceAll/);
});

test("the customer's page passes its key on, to the page and the PDF", () => {
  const page = read("../pages/PublicEstimate.tsx");
  assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\("r"\)/);
  assert.match(page, /fetch\(keyed\(`\$\{BASE\}\/api\/public\/estimates\/\$\{encodeURIComponent\(token\)\}`\)\)/);
  assert.match(page, /href=\{keyed\(`\$\{BASE\}\/api\/public\/estimates\/\$\{encodeURIComponent\(token\)\}\/pdf`\)\}/);
});

test("Settings can turn the open notification off", () => {
  const card = read("../components/AcceptanceSettingsCard.tsx");
  assert.match(card, /data-testid="open-notification-enabled"/);
  assert.match(card, /openNotificationEnabled: draft!\.opens/);
});
