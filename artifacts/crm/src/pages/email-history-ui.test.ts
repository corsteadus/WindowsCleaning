// Phase 2 (Kyle, Video 4): open any email that was sent, and resend it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const history = read("../components/EmailHistory.tsx");
const detail = read("./CustomerDetail.tsx");

test("each email shows when, to whom and who sent it — in the business's time", () => {
  assert.match(history, /\{when\(email\.at\)\} · to /);
  assert.match(history, /email\.sender \?\? "Sender not recorded"/);
  assert.match(history, /timeZone: "America\/Chicago"/);
});

test("the message opens in a sandboxed frame, so no script in it can run", () => {
  assert.match(history, /<iframe title="Email content" data-testid="email-body" sandbox="" srcDoc=\{one\.data\.bodyHtml\}/);
});

test("Resend opens the profile's own composer with the email in it, and only for people who may send", () => {
  // A5: it opens the email / text / letter composer, the old message as text.
  assert.match(detail, /onResend=\{canSendEmail \? \(email\) => setComposer\(\{\s*channel: "email", to: email\.to,\s*initial: \{ subject: email\.subject, body: htmlToText\(email\.bodyHtml\) \},/);
});

test("the history lives in the Email History section, and refreshes after a send", () => {
  const section = detail.slice(detail.indexOf('id="activity" title="Email History & Activity"'));
  assert.ok(section.indexOf("<EmailHistory") > 0 && section.indexOf("<EmailHistory") < section.indexOf("<CommunicationActivityTab"));
  assert.match(detail, /invalidateQueries\(\{ queryKey: authScopedQueryKey\(user, \["profile-emails"\]\) \}\)/);
});
