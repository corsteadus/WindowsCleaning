// Phase A1 (Kyle, Videos 7 and 9): the customer's decision, confirmed, kept and thanked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const publicPage = read("./PublicEstimate.tsx");
const card = read("../components/AcceptanceSettingsCard.tsx");

test("neither decision is one click: Accept and Decline each open a confirmation", () => {
  assert.match(publicPage, /onClick=\{\(\) => setConfirming\("accepted"\)\} data-testid="public-accept"/);
  assert.match(publicPage, /onClick=\{\(\) => setConfirming\("declined"\)\} data-testid="public-decline"/);
  assert.match(publicPage, /<DialogTitle>Almost done!<\/DialogTitle>/);
  assert.match(publicPage, /onClick=\{\(\) => decide\("accepted"\)\} data-testid="accept-confirm"/);
});

test("what the customer writes when accepting is sent as their Customer Notes", () => {
  assert.match(publicPage, /\{ decision: next, customerNotes: notes, acceptedLineItemIds: \[\.\.\.chosen\] \}/);
  assert.match(publicPage, /data-testid="accept-notes"/);
});

test("a failed decision keeps the dialog and what was typed", () => {
  assert.match(publicPage, /setDecisionError\(e instanceof Error \? e\.message : "Unable to record decision"\)/);
  assert.doesNotMatch(publicPage, /setError\(e instanceof Error \? e\.message : "Unable to record decision"\)/);
});

test("after accepting: the status, the business's thank-you, a recap and their comments", () => {
  assert.match(publicPage, /Estimate status – Accepted/);
  assert.match(publicPage, /Thank you for confirming!/);
  assert.match(publicPage, /data-testid="public-thank-you-message">\{estimate\.thankYouMessage\}/);
  assert.match(publicPage, /data-testid="public-recap"/);
  assert.match(publicPage, /data-testid="public-customer-notes">\{estimate\.customerNotes\}/);
});

test("a declined estimate shows no service as chosen", () => {
  assert.match(publicPage, /const on = decision !== "declined" && shownIds\.has\(line\.id\);/);
});

test("an accepted estimate's header says Accepted, not Draft", () => {
  assert.match(read("./QuoteDetail.tsx"), /accepted: \{ label: "Accepted"/);
});

test("the customer can print the estimate, and the print is recorded", () => {
  assert.match(publicPage, /\/api\/public\/estimates\/\$\{encodeURIComponent\(token\)\}\/pdf`\)\} target="_blank"/);
  assert.match(publicPage, /JSON\.stringify\(\{ activityType: "printed" \}\)/);
});

test("Customer Notes show on the estimate page and when scheduling it", () => {
  assert.match(read("./QuoteDetail.tsx"), /data-testid="customer-notes"/);
  assert.match(read("../components/EstimateConversionDialog.tsx"), /data-testid="convert-customer-notes"/);
});

test("Settings: the business words the thank-you and the email, for administrators", () => {
  assert.match(read("./Settings.tsx"), /<AcceptanceSettingsCard canManage=\{canManageQuoteSettings\} \/>/);
  assert.match(card, /estimateCall\("\/quote-settings\/acceptance", \{\s*method: "PUT"/);
  assert.match(card, /if \(!canManage\) return null;/);
  assert.match(card, /placeholder=\{defaults\.message\}/);
});
