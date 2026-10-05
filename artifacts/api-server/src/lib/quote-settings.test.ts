import { strict as assert } from "node:assert";
import test from "node:test";
import {
  BUSINESS_TIME_ZONE,
  DEFAULT_QUOTE_SETTINGS,
  MAX_QUOTE_TERMS_LENGTH,
  QUOTE_VALIDITY_PRESETS,
  endOfDayInZone,
  hasQuoteExpired,
  normaliseQuoteTerms,
  normaliseValidityDays,
  quoteExpiryFor,
  validateQuoteSettingsInput,
} from "./quote-settings.ts";
import { businessDateStr } from "./date.ts";

const inZone = (at: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(at);

test("Kyle's four examples are the offered choices", () => {
  assert.deepEqual([...QUOTE_VALIDITY_PRESETS], [15, 30, 60, 90]);
});

test("a company with no settings gets thirty days and no terms", () => {
  // #13: Corstead supplies no wording of its own.
  assert.equal(DEFAULT_QUOTE_SETTINGS.validityDays, 30);
  assert.equal(DEFAULT_QUOTE_SETTINGS.terms, null);
});

test("validity days must be a whole number inside the range", () => {
  assert.equal(normaliseValidityDays(30), 30);
  assert.equal(normaliseValidityDays("45"), 45, "a form sends a string");
  assert.equal(normaliseValidityDays(" 90 "), 90);
  assert.equal(normaliseValidityDays(1), 1);
  assert.equal(normaliseValidityDays(365), 365);
  assert.equal(normaliseValidityDays(0), null);
  assert.equal(normaliseValidityDays(-30), null);
  assert.equal(normaliseValidityDays(366), null);
  assert.equal(normaliseValidityDays(30.5), null);
  assert.equal(normaliseValidityDays(""), null);
  assert.equal(normaliseValidityDays("thirty"), null);
  assert.equal(normaliseValidityDays(null), null);
  assert.equal(normaliseValidityDays(undefined), null);
});

test("an empty terms box means the company has none", () => {
  assert.equal(normaliseQuoteTerms(""), null);
  assert.equal(normaliseQuoteTerms("   \n  "), null);
  assert.equal(normaliseQuoteTerms(null), null);
  assert.equal(normaliseQuoteTerms(undefined), null);
  assert.equal(normaliseQuoteTerms("  Payment due on completion.  "), "Payment due on completion.");
});

test("the settings a company may save", () => {
  assert.equal(validateQuoteSettingsInput({ validityDays: 30, terms: null }), null);
  assert.equal(validateQuoteSettingsInput({ validityDays: 90, terms: "Ours alone." }), null);
  assert.equal(validateQuoteSettingsInput({ validityDays: 30 }), null, "terms may be left out");

  assert.match(
    String(validateQuoteSettingsInput({ validityDays: 0 })),
    /whole number of days between 1 and 365/,
  );
  assert.match(String(validateQuoteSettingsInput({ validityDays: 400 })), /between 1 and 365/);
  assert.match(String(validateQuoteSettingsInput({})), /between 1 and 365/);
  assert.match(
    String(validateQuoteSettingsInput({ validityDays: 30, terms: 42 })),
    /must be text/,
  );
  assert.match(
    String(validateQuoteSettingsInput({ validityDays: 30, terms: "x".repeat(MAX_QUOTE_TERMS_LENGTH + 1) })),
    /20000 characters or fewer/,
  );
});

test("the expiry date is counted in the business's own days", () => {
  // Mid-morning in Missouri.
  const expiry = quoteExpiryFor(new Date("2026-10-04T15:00:00Z"), 30);
  assert.equal(expiry.validUntil, "2026-11-03");
});

test("a quote raised late in the evening does not lose a day to UTC", () => {
  // 21:00 on 4 October in Missouri is already 5 October in London.
  const late = quoteExpiryFor(new Date("2026-10-05T02:00:00Z"), 30);
  assert.equal(businessDateStr(new Date("2026-10-05T02:00:00Z")), "2026-10-04");
  assert.equal(late.validUntil, "2026-11-03", "still thirty days from the 4th");
});

test("the link lives to the end of its last day where the customer is", () => {
  const expiry = quoteExpiryFor(new Date("2026-10-04T15:00:00Z"), 30);
  assert.equal(inZone(expiry.expiresAt), "03/11/2026, 23:59:59");
  // Central Standard Time by November: the last second is 05:59:59 UTC the day after.
  assert.equal(expiry.expiresAt.toISOString(), "2026-11-04T05:59:59.999Z");
});

test("all four of Kyle's choices work, including ninety days", () => {
  // The old hard-coded link code clamped at 60, which would have silently
  // shortened a 90-day company setting.
  const from = new Date("2026-10-04T15:00:00Z");
  assert.equal(quoteExpiryFor(from, 15).validUntil, "2026-10-19");
  assert.equal(quoteExpiryFor(from, 30).validUntil, "2026-11-03");
  assert.equal(quoteExpiryFor(from, 60).validUntil, "2026-12-03");
  assert.equal(quoteExpiryFor(from, 90).validUntil, "2027-01-02");
});

test("an unusable validity falls back rather than producing a broken date", () => {
  const expiry = quoteExpiryFor(new Date("2026-10-04T15:00:00Z"), Number.NaN);
  assert.equal(expiry.validUntil, "2026-11-03");
});

test("the end of the day survives the clocks going back", () => {
  // Daylight saving ends on 1 November 2026.
  assert.equal(inZone(endOfDayInZone("2026-10-31")), "31/10/2026, 23:59:59");
  assert.equal(inZone(endOfDayInZone("2026-11-01")), "01/11/2026, 23:59:59");
  assert.equal(inZone(endOfDayInZone("2026-03-08")), "08/03/2026, 23:59:59");
});

test("expiry is a question about the link, and null never expires", () => {
  const now = new Date("2026-10-04T15:00:00Z");
  assert.equal(hasQuoteExpired(new Date("2026-10-04T14:59:00Z"), now), true);
  assert.equal(hasQuoteExpired(new Date("2026-10-04T15:00:01Z"), now), false);
  assert.equal(hasQuoteExpired("2026-10-03T00:00:00Z", now), true);
  assert.equal(hasQuoteExpired(null, now), false);
  assert.equal(hasQuoteExpired(undefined, now), false);
  assert.equal(hasQuoteExpired("not a date", now), false);
});
