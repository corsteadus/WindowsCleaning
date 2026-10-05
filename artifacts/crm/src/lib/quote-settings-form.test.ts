import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DEFAULT_QUOTE_VALIDITY_DAYS,
  MAX_QUOTE_TERMS_LENGTH,
  MAX_QUOTE_VALIDITY_DAYS,
  MIN_QUOTE_VALIDITY_DAYS,
  QUOTE_VALIDITY_PRESETS,
  addDays,
  businessToday,
  draftFromSaved,
  expiryPreview,
  formatDateOnly,
  isQuoteSettingsDirty,
  quoteSettingsBody,
  validateQuoteSettingsDraft,
  validityChoice,
} from "./quote-settings-form.ts";

const serverSource = readFileSync(
  fileURLToPath(new URL("../../../api-server/src/lib/quote-settings.ts", import.meta.url)),
  "utf8",
);

test("the form offers exactly the choices Kyle named", () => {
  assert.deepEqual([...QUOTE_VALIDITY_PRESETS], [15, 30, 60, 90]);
});

test("the twin has not drifted from the server", () => {
  // The two packages do not share code, so the numbers are repeated. If the
  // server's bounds move, this fails rather than letting the form accept
  // something the API will reject.
  assert.match(serverSource, /QUOTE_VALIDITY_PRESETS: readonly number\[\] = \[15, 30, 60, 90\]/);
  assert.match(serverSource, new RegExp(`DEFAULT_QUOTE_VALIDITY_DAYS = ${DEFAULT_QUOTE_VALIDITY_DAYS}\\b`));
  assert.match(serverSource, new RegExp(`MIN_QUOTE_VALIDITY_DAYS = ${MIN_QUOTE_VALIDITY_DAYS}\\b`));
  assert.match(serverSource, new RegExp(`MAX_QUOTE_VALIDITY_DAYS = ${MAX_QUOTE_VALIDITY_DAYS}\\b`));
  assert.match(serverSource, /MAX_QUOTE_TERMS_LENGTH = 20_000/);
  assert.equal(MAX_QUOTE_TERMS_LENGTH, 20_000);
});

test("Corstead suggests no terms of its own, not even as a placeholder", () => {
  // Kyle #13: "Corstead should not provide legal wording or suggest specific
  // terms." Neither file may carry sample wording.
  const formSource = readFileSync(
    fileURLToPath(new URL("./quote-settings-form.ts", import.meta.url)),
    "utf8",
  );
  for (const [label, source] of [["the form", formSource], ["the server", serverSource]] as const) {
    assert.doesNotMatch(source, /Payment (?:is )?due/i, `${label} suggests payment wording`);
    assert.doesNotMatch(source, /deposit|non-refundable|warrant/i, `${label} suggests terms`);
  }
});

test("a saved setting becomes the form's starting point", () => {
  assert.deepEqual(draftFromSaved({ validityDays: 60, terms: "Ours." }), {
    validityDays: "60", terms: "Ours.",
  });
  assert.deepEqual(draftFromSaved({ validityDays: 30, terms: null }), {
    validityDays: "30", terms: "",
  }, "no terms shows an empty box");
});

test("a number off the list belongs to the Other box", () => {
  assert.equal(validityChoice("30"), 30);
  assert.equal(validityChoice("90"), 90);
  assert.equal(validityChoice("45"), "other");
  assert.equal(validityChoice(""), "other");
  assert.equal(validityChoice("abc"), "other");
});

test("what the form refuses to send", () => {
  assert.equal(validateQuoteSettingsDraft({ validityDays: "30", terms: "" }), null);
  assert.equal(validateQuoteSettingsDraft({ validityDays: " 45 ", terms: "Ours." }), null);

  assert.match(String(validateQuoteSettingsDraft({ validityDays: "", terms: "" })), /Choose how many days/);
  assert.match(String(validateQuoteSettingsDraft({ validityDays: "0", terms: "" })), /between 1 and 365/);
  assert.match(String(validateQuoteSettingsDraft({ validityDays: "366", terms: "" })), /between 1 and 365/);
  assert.match(String(validateQuoteSettingsDraft({ validityDays: "30.5", terms: "" })), /whole number/);
  assert.match(String(validateQuoteSettingsDraft({ validityDays: "lots", terms: "" })), /whole number/);
  assert.match(
    String(validateQuoteSettingsDraft({ validityDays: "30", terms: "x".repeat(MAX_QUOTE_TERMS_LENGTH + 1) })),
    /20000 characters or fewer/,
  );
});

test("an empty terms box is sent as nothing, not as an empty string", () => {
  assert.deepEqual(quoteSettingsBody({ validityDays: "30", terms: "   " }), {
    validityDays: 30, terms: null,
  });
  assert.deepEqual(quoteSettingsBody({ validityDays: " 90 ", terms: "  Ours alone.  " }), {
    validityDays: 90, terms: "Ours alone.",
  });
});

test("the Save button knows when something has changed", () => {
  const saved = { validityDays: 30, terms: "Ours." };
  assert.equal(isQuoteSettingsDirty({ validityDays: "30", terms: "Ours." }, saved), false);
  assert.equal(isQuoteSettingsDirty({ validityDays: "30", terms: "Ours. " }, saved), false, "trailing space is not a change");
  assert.equal(isQuoteSettingsDirty({ validityDays: "60", terms: "Ours." }, saved), true);
  assert.equal(isQuoteSettingsDirty({ validityDays: "30", terms: "" }, saved), true, "clearing the terms is a change");
  assert.equal(isQuoteSettingsDirty({ validityDays: "", terms: "Ours." }, saved), true);
  assert.equal(
    isQuoteSettingsDirty({ validityDays: "30", terms: "" }, { validityDays: 30, terms: null }),
    false,
    "an empty box over no terms is not a change",
  );
});

test("the expiry a quote raised today would carry", () => {
  const noon = new Date("2026-10-04T15:00:00Z");
  assert.equal(businessToday(noon), "2026-10-04");
  assert.equal(expiryPreview(30, noon), "2026-11-03");
  assert.equal(expiryPreview(15, noon), "2026-10-19");
  assert.equal(expiryPreview(90, noon), "2027-01-02");
  // Late evening in Missouri is already tomorrow in UTC; the date must not slip.
  assert.equal(expiryPreview(30, new Date("2026-10-05T02:00:00Z")), "2026-11-03");
});

test("calendar arithmetic crosses months, years and a leap day", () => {
  assert.equal(addDays("2026-10-04", 30), "2026-11-03");
  assert.equal(addDays("2026-12-20", 30), "2027-01-19");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-07", 1), "2026-03-08", "the day the clocks go forward");
});

test("a date is shown the way the office reads it, never as a bare ISO string", () => {
  assert.equal(formatDateOnly("2026-11-03"), "Nov 3, 2026");
  assert.equal(formatDateOnly("2027-01-02"), "Jan 2, 2027");
  assert.equal(formatDateOnly(null), "");
  assert.equal(formatDateOnly(""), "");
  assert.equal(formatDateOnly("not a date"), "");
});
