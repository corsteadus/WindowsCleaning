// A5 (Kyle, Video 8): the profile's email / text / letter composer, its templates, and letters in bulk.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { differsFromTemplate, groupTags, htmlToText, insertTag, smsLengthLabel, templateText, type MessageTemplate } from "./profile-messages.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const template = (extra: Partial<MessageTemplate> = {}): MessageTemplate => ({
  id: 1, name: "Spring", subject: "Hi", bodyHtml: "<p>Hello</p>", bodyText: null, channel: "email", updatedBy: null, updatedAt: "", ...extra,
});

test("a tag goes where the cursor was, replacing a selection", () => {
  assert.deepEqual(insertTag("Hi , thanks", 3, 3, "first_name"), { text: "Hi {{first_name}}, thanks", cursor: 17 });
  assert.equal(insertTag("Hi NAME", 3, 7, "first_name").text, "Hi {{first_name}}");
});

test("a template opens as text; an HTML-only one is turned back into text", () => {
  assert.equal(templateText(template({ bodyText: "Plain" })), "Plain");
  assert.equal(templateText(template()), "Hello");
  assert.equal(htmlToText("<p>a &amp; b</p><p>c<br>d</p>"), "a & b\n\nc\nd");
});

test("'Save changes' only appears once the template has been changed", () => {
  const t = template({ bodyText: "Hello" });
  assert.equal(differsFromTemplate(t, "Hi", "Hello"), false);
  assert.equal(differsFromTemplate(t, "Hi", "Hello there"), true);
  assert.equal(differsFromTemplate(null, "Hi", "x"), false);
});

test("the text's length and the tag groups read plainly", () => {
  assert.equal(smsLengthLabel({ characters: 87, segments: 1 }), "1 text · 87 characters");
  assert.equal(smsLengthLabel({ characters: 200, segments: 2 }), "2 texts · 200 characters");
  assert.deepEqual(groupTags([{ tag: "a", label: "A", group: "Customer" }, { tag: "b", label: "B", group: "Business" }, { tag: "c", label: "C", group: "Customer" }])
    .map((g) => [g.group, g.tags.length]), [["Customer", 2], ["Business", 1]]);
});

test("the composer: three tabs, the server's preview, templates used, saved, changed and deleted with a confirm", () => {
  const composer = read("../components/ProfileComposer.tsx");
  for (const id of ["composer-tab-email", "composer-tab-sms", "composer-tab-letter", "composer-template", "composer-insert-tag", "composer-preview", "composer-save-new", "composer-update-template", "composer-delete-confirm"]) {
    assert.ok(composer.includes(id) || composer.includes("composer-tab-${c}"), id);
  }
  assert.match(composer, /\/profile-messages\/\$\{profile\.id\}\/preview/);
  assert.match(composer, /bodyText: body, templateId: template\?\.id \?\? null/);
  assert.match(composer, /"Idempotency-Key": sendKey\.current/);
  assert.match(composer, /useEffect\(\(\) => \{ sendKey\.current = crypto\.randomUUID\(\); \}, \[subject, body, emailTo, channel\]\);/);
  assert.match(composer, /disabled title="Waiting on a text provider"/);
  assert.doesNotMatch(composer, /firstName: profile\.firstName,\s*lastName/, "names are not sent to be trusted");
});

test("the profile opens it for email, text and letter, and Resend opens it as text", () => {
  const page = read("../pages/CustomerDetail.tsx");
  assert.match(page, /data-testid="profile-send-text"/);
  assert.match(page, /data-testid="profile-print-letter"/);
  assert.match(page, /initial: \{ subject: email\.subject, body: htmlToText\(email\.bodyHtml\) \}/);
  assert.doesNotMatch(page, /setEmailModal/);
});

test("letters in bulk: a letter template, ticked profiles, one PDF", () => {
  const bulk = read("../components/BulkLettersTab.tsx");
  assert.match(bulk, /\/api\/letters\/pdf/);
  assert.match(bulk, /X-Letters-Skipped/);
  assert.match(read("../pages/Communications.tsx"), /\{tab === "letters" {3}&& <BulkLettersTab \/>\}/);
});
