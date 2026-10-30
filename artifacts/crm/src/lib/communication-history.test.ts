// A6 (Kyle, Video 8): the profile's one communication history — filter, view, delete (owner and admin only).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { deleteQuestion, keepSelection, relatedHref, statusLabel, statusTone, type HistoryItem } from "./communication-history.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const item = (key: string): HistoryItem => ({
  key, source: "email", sourceId: 1, type: "email", title: "x", to: null, address: null, by: null, at: "", status: "sent", related: null, viewable: true, template: null,
});

test("statuses read as words, with a tone", () => {
  assert.equal(statusLabel("provider_unconfigured"), "Not sent — no provider");
  assert.equal(statusLabel("printed"), "Printed");
  assert.equal(statusLabel("weird_state"), "Weird state");
  assert.deepEqual(["sent", "failed", "queued", "skipped"].map(statusTone), ["good", "bad", "wait", "plain"]);
});

test("the confirm says how many, and a selection never names an entry that is gone", () => {
  assert.equal(deleteQuestion(1), "Delete this entry from the history?");
  assert.equal(deleteQuestion(3), "Delete 3 entries from the history?");
  assert.deepEqual([...keepSelection(new Set(["email:1", "email:2"]), [item("email:2")])], ["email:2"]);
  assert.equal(relatedHref({ type: "invoice", id: 9, label: "Invoice INV-9" }), "/invoices/9");
});

test("the history: filters, search, view, Resend, Print again, delete one or many after a confirm", () => {
  const history = read("../components/CommunicationHistory.tsx");
  for (const id of ["history-filter-${key}", "history-search", "history-select-all", "history-delete-selected", "history-delete-one",
    "history-delete-confirm", "history-delete-yes", "history-resend", "history-print-again", "history-email-body"]) {
    assert.ok(history.includes(`data-testid="${id}"`) || history.includes(`data-testid={\`${id}\`}`), id);
  }
  assert.match(history, /const canDelete = list\.data\?\.canDelete === true;/, "the server says who may delete");
  assert.match(history, /sandbox="" srcDoc=\{one\.data\.bodyHtml\}/);
  assert.match(history, /Corstead keeps a note of who deleted it and when\./);
});

test("the profile shows the one history, and the activity keeps what happened to the profile", () => {
  const page = read("../pages/CustomerDetail.tsx");
  assert.match(page, /<ProfileSection id="activity" title="Communication History & Activity"/);
  assert.match(page, /<CommunicationHistory\s/);
  assert.doesNotMatch(page, /<EmailHistory\s/);
  assert.match(page, /const SENT = new Set\(\["email_sent", "letter_printed"\]\);/);
});
