// Phase 4 (Kyle, Video 4): callbacks for the office or a VA.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const dialog = read("../components/CallbackDialog.tsx");
const section = read("../components/ProfileCallbacks.tsx");
const page = read("./Callbacks.tsx");
const detail = read("./CustomerDetail.tsx");

test("the call screen: how to reach them, the estimate, the notes", () => {
  assert.match(dialog, /href=\{`tel:\$\{profile\.phone\}`\}/);
  assert.match(dialog, /data-testid="callback-estimates"/);
  assert.match(dialog, /data-testid="callback-recent-notes"/);
  assert.match(dialog, /kind: "specific", body: specificNote/);
});

test("spoke, left a message, or neither — and the next callback, which a made contact does not default to", () => {
  assert.match(dialog, /CALLBACK_OUTCOMES\.map/);
  assert.match(dialog, /if \(!nextTouched\) setScheduleNext\(outcome !== "spoke"\)/);
  assert.match(dialog, /next: withNext \? \{ dueAt, assignedUserId: next\.assignedUserId \|\| null \} : undefined/);
});

test("they said yes: the call is saved as spoken, then booking starts", () => {
  assert.match(dialog, /save\.mutate\(\{ chosen: "spoke", withNext: false \}, \{ onSuccess: \(\) => onBook\(\) \}\)/);
  assert.match(detail, /if \(target === "convert" && canConvertEstimates\) openConvert\(\);/);
  assert.match(page, /onBook=\{\(\) => navigate\(`\$\{profileHref\(calling\)\}\?book=1`\)\}/);
  assert.match(detail, /new URLSearchParams\(window\.location\.search\)\.get\("book"\) === "1"/);
});

test("Callbacks is a section under the profile, in Kyle's order, with Jump To", () => {
  assert.match(detail, /const SECTION_VIEWS = \["files", "quotes", "callbacks", "activity"\] as const;/);
  const sections = detail.slice(detail.indexOf('data-testid="profile-sections"'));
  assert.ok(sections.indexOf('id="quotes"') < sections.indexOf('id="callbacks"') && sections.indexOf('id="callbacks"') < sections.indexOf('id="activity"'));
});

test("a deactivated profile's callbacks are read-only; overdue ones are marked", () => {
  assert.match(detail, /canManage=\{canManageCustomer && !isDeactivatedProfile\(customer\)\}/);
  assert.match(section, /BUCKET_LABELS\[bucket\]/);
});

test("the call list is in the sidebar for the office", () => {
  assert.match(read("../components/Layout.tsx"), /\{ href: "\/callbacks",\s+label: "Callbacks",\s+icon: PhoneCall, requiredCapability: "customers\.manage" \}/);
  assert.match(read("../App.tsx"), /<Route path="\/callbacks" component=\{Callbacks\} \/>/);
});
