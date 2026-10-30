// A6 (Kyle, Video 8): one communication history; delete by the owner or an admin only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deletionTargets, deliveryItem, emailItem, historyOf, letterItem, messageItem, type RelatedLabels } from "./communication-history.ts";
import { hasCapability } from "./authorization.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const labels: RelatedLabels = { quote: new Map([[7, "Q-7"]]), invoice: new Map([[9, "INV-9"]]), job: new Map() };
const email = (id: number, at: string, extra: Record<string, unknown> = {}) => emailItem({
  id, subject: `Email ${id}`, recipientEmail: "ann@example.com", recipientName: "Ann", status: "sent", sentAt: new Date(at), createdAt: new Date(at),
  errorMessage: null, templateName: null, sentBy: "Toheed", campaignId: null, relatedType: null, relatedId: null, ...extra,
} as never, undefined, labels);
const message = (id: number, channel: string, status: string, body = "[redacted]") => messageItem({
  id, channel, triggerType: "job_scheduled", relatedType: "customer", relatedId: 1, recipient: "(816) ***-0177", subject: null, body, status, sentAt: null, createdAt: new Date("2026-10-30T10:00:00Z"),
}, labels);

test("each message once: an email from its log, never again from its redacted line", () => {
  assert.equal(message(1, "email", "sent"), null, "the same email is already in email_logs");
  assert.equal(message(2, "email", "failed"), null);
  assert.equal(message(3, "email", "not_dispatched")?.type, "email", "an automatic email that never went out is only here");
  assert.equal(message(4, "sms", "not_dispatched", "Reminder")?.type, "text");
  assert.equal(message(5, "sms", "sent")?.viewable, false, "a redacted text cannot be shown");
  assert.equal(message(6, "in_app", "sent"), null);
  const later = deliveryItem({ id: 1, quoteId: 7, channel: "email", recipient: "a@x.com", status: "sent", requestedBy: null, requestedAt: new Date(), openKeyHash: "h" }, labels, new Map());
  assert.equal(later, null, "a per-recipient (A2) delivery is the same email as its email_log");
  const older = deliveryItem({ id: 2, quoteId: 7, channel: "sms", recipient: "816", status: "provider_unconfigured", requestedBy: "u1", requestedAt: new Date(), openKeyHash: null }, labels, new Map([["u1", "Lute"]]));
  assert.deepEqual([older?.type, older?.title, older?.by], ["text", "Estimate Q-7", "Lute"]);
});

test("what it was about, who sent it, and the bare address for Resend", () => {
  const item = email(1, "2026-10-29T10:00:00Z", { relatedType: "invoice", relatedId: 9 });
  assert.deepEqual(item.related, { type: "invoice", id: 9, label: "Invoice INV-9" });
  assert.equal(item.to, "Ann <ann@example.com>");
  assert.equal(item.address, "ann@example.com");
  assert.equal(item.by, "Toheed");
  const letter = letterItem({ id: 3, templateName: "Spring", subject: null, recipientLines: ["Ann Lee", "9 Elm St", "Kansas City, MO 64111"], printedBy: "Toheed", printedAt: new Date() });
  assert.deepEqual([letter.title, letter.to, letter.status], ["Spring", "9 Elm St, Kansas City, MO 64111", "printed"]);
});

test("newest first, the deleted left out, filtered by type and by words", () => {
  const items = [email(1, "2026-10-28T10:00:00Z"), email(2, "2026-10-30T11:00:00Z", { subject: "Gutter special" }), message(4, "sms", "not_dispatched", "x")];
  assert.deepEqual(historyOf(items, new Set()).map((i) => i.key), ["email:2", "message:4", "email:1"]);
  assert.deepEqual(historyOf(items, new Set(["email:2"])).map((i) => i.key), ["message:4", "email:1"]);
  assert.deepEqual(historyOf(items, new Set(), { type: "text" }).map((i) => i.key), ["message:4"]);
  assert.deepEqual(historyOf(items, new Set(), { q: "GUTTER spec" }).map((i) => i.key), ["email:2"]);
});

test("a deletion names real entries only, each once, at most 200", () => {
  assert.deepEqual(deletionTargets(["email:1", "email:1", "letter:2"]), { targets: [{ source: "email", sourceId: 1 }, { source: "letter", sourceId: 2 }] });
  assert.deepEqual(deletionTargets([]), { error: "Choose what to delete" });
  assert.deepEqual(deletionTargets(["users:1"]), { error: "That history entry does not exist" });
  assert.match((deletionTargets(Array.from({ length: 201 }, (_, i) => `email:${i + 1}`)) as { error: string }).error, /at most 200/);
});

test("only the owner and admins may delete history (Toheed, 2026-10-30)", () => {
  assert.equal(hasCapability("owner", "communication.history.delete"), true);
  assert.equal(hasCapability("admin", "communication.history.delete"), true);
  assert.equal(hasCapability("office_admin", "communication.history.delete"), false);
  assert.equal(hasCapability("sales", "communication.history.delete"), false);
  assert.equal(hasCapability("field_tech", "communication.history.delete"), false);
});

test("the route: checked on the server, the record kept, the removal recorded; the migration additive", () => {
  const route = read("../routes/communication-history.ts");
  assert.match(route, /if \(!hasCapability\(req\.user\?\.role, "communication\.history\.delete"\)\) \{\n\s+res\.status\(403\)/);
  assert.match(route, /if \(chosen\.some\(\(item\) => !item\)\) \{ res\.status\(404\)/);
  assert.match(route, /onConflictDoNothing\(\)/);
  assert.match(route, /action: "communication_deleted"/);
  assert.doesNotMatch(route, /\.delete\(emailLogsTable\)|\.delete\(messageLogsTable\)|\.delete\(printedLettersTable\)/, "nothing that was sent is erased");
  assert.match(read("../routes/profile-emails.ts"), /notExists\(/);
  assert.match(read("../routes/profile-messages.ts"), /insert\(printedLettersTable\)/);
  const list = read("../migrations/application-migrations.ts");
  assert.ok(list.indexOf("  messageTemplatesV1Migration,") < list.indexOf("  communicationHistoryV1Migration,"));
  const migration = read("../migrations/communication-history-v1.ts");
  assert.doesNotMatch(migration.slice(migration.indexOf("async function apply"), migration.indexOf("async function verify")), /\bUPDATE\b|DELETE FROM|DROP/, "ON DELETE CASCADE is a rule, not a delete");
});
