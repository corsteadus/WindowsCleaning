/**
 * Kyle (Testing Edits, 2026-10-01) #11 and #13, read off the screens themselves.
 *
 * These are source guards: they do not render the pages, they assert that the
 * controls Kyle asked to be removed are really gone and that the ones he asked
 * for are wired to the company setting rather than to a field.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const quoteNew = read("./QuoteNew.tsx");
const quoteDetail = read("./QuoteDetail.tsx");
const settings = read("./Settings.tsx");
const card = read("../components/QuoteSettingsCard.tsx");

test("#11 nobody types a Valid Until date any more", () => {
  for (const [label, source] of [["the builder", quoteNew], ["the quote page", quoteDetail]] as const) {
    assert.doesNotMatch(source, /setValidUntil/, `${label} still sets a date`);
    assert.doesNotMatch(source, /setEditValidUntil/, `${label} still sets a date`);
    assert.doesNotMatch(
      source,
      /value=\{(?:edit)?[Vv]alidUntil\}/,
      `${label} still binds an input to the expiry`,
    );
  }
});

test("#11 the builder shows the expiry it calculated, and where it came from", () => {
  assert.match(quoteNew, /\/api\/quote-settings/);
  assert.match(quoteNew, /formatDateOnly\(expiryPreview\(quoteSettings\.validityDays\)\)/);
  assert.match(quoteNew, /from your company settings/i);
  // No date is sent: the server decides, so there is one answer not two.
  assert.doesNotMatch(quoteNew, /validUntil:/);
});

test("#13 the builder fills in the company's terms without trapping an edit", () => {
  assert.match(quoteNew, /setTerms\(quoteSettings\.terms \?\? ""\)/);
  assert.match(quoteNew, /termsTouched/);
  // The old placeholder suggested wording; Kyle asked Corstead not to.
  assert.doesNotMatch(quoteNew, /placeholder="Payment terms/);
});

test("the quote page no longer offers a status the server refuses", () => {
  // "Approved" was rejected with a 400 by assertStaffWritableQuoteStatus: a
  // control that could only ever fail.
  assert.doesNotMatch(quoteDetail, /SelectItem value="approved"/);
  assert.doesNotMatch(quoteDetail, /<SelectItem value="draft">Draft<\/SelectItem>/);
  // One correction control remains, over the statuses Kyle named.
  assert.match(quoteDetail, /CORRECTABLE_ESTIMATE_STATUSES\.map/);
});

test("an expiry is never printed as a bare ISO date", () => {
  for (const [label, source] of [
    ["the quote page", quoteDetail],
    ["the printed quote", read("./QuotePrint.tsx")],
    ["the profile", read("./CustomerDetail.tsx")],
  ] as const) {
    assert.doesNotMatch(source, /\$\{(?:quote|q)\.validUntil\}/, `${label} prints a raw date`);
    assert.match(source, /formatDateOnly\(/, `${label} does not format the date`);
  }
});

test("#11 and #13 are a company setting on the Settings page", () => {
  assert.match(settings, /<QuoteSettingsCard canManage=\{canManageQuoteSettings\}/);
  assert.match(settings, /hasClientCapability\(user, "admin\.settings"\)/);
});

test("the setting offers Kyle's four choices and another number", () => {
  assert.match(card, /QUOTE_VALIDITY_PRESETS\.map/);
  assert.match(card, /aria-label="Another number of days"/);
  assert.match(card, /max=\{365\}/);
});

test("#13 Corstead suggests no terms of its own on the screen either", () => {
  assert.doesNotMatch(card, /placeholder="[^"]*(?:payment|due|deposit|warrant)/i);
  assert.match(card, /Corstead supplies no wording of its own/);
  // The box must not start with anything in it.
  assert.match(card, /value=\{draft\.terms\}/);
  assert.doesNotMatch(card, /defaultValue=/);
});
