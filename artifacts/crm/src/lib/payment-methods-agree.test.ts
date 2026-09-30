// The CRM and the API each keep their own copy of the payment methods, because
// the two packages share no runtime code. If they drift, the CRM offers a method
// the API refuses — so this reads both files and compares them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  PAYMENT_METHOD_OPTIONS, PAYMENT_METHOD_VALUES, paymentMethodLabel, paymentReferenceHint,
} from "./payment-methods.ts";

const apiSource = readFileSync(
  fileURLToPath(new URL("../../../api-server/src/lib/payment-methods.ts", import.meta.url)),
  "utf8",
);

/** The option list as the API file writes it, read out of the source. */
function apiOptions(): Array<{ value: string; label: string; referenceHint?: string }> {
  const block = apiSource.slice(
    apiSource.indexOf("export const PAYMENT_METHOD_OPTIONS"),
    apiSource.indexOf("];", apiSource.indexOf("export const PAYMENT_METHOD_OPTIONS")),
  );
  return [...block.matchAll(/\{\s*value:\s*"([^"]+)",\s*label:\s*"([^"]+)"(?:,\s*referenceHint:\s*"([^"]+)")?\s*\}/g)]
    .map((match) => ({ value: match[1], label: match[2], ...(match[3] ? { referenceHint: match[3] } : {}) }));
}

test("the API file really does list some methods", () => {
  assert.ok(apiOptions().length >= 4, "the reader found nothing — the API file's shape changed");
});

test("both packages offer the same methods, in the same order", () => {
  assert.deepEqual(apiOptions().map((o) => o.value), [...PAYMENT_METHOD_VALUES]);
});

test("both packages give each method the same label", () => {
  assert.deepEqual(
    apiOptions().map((o) => `${o.value}=${o.label}`),
    PAYMENT_METHOD_OPTIONS.map((o) => `${o.value}=${o.label}`),
  );
});

test("both packages name the reference the same way", () => {
  for (const option of apiOptions()) {
    assert.equal(paymentReferenceHint(option.value), option.referenceHint ?? "Reference",
      `${option.value} describes its reference differently in the two packages`);
  }
});

test("Kyle's four come first", () => {
  assert.deepEqual(PAYMENT_METHOD_VALUES.slice(0, 4), ["cash", "credit_card", "check", "gift_certificate"]);
});

test("a stored method never shows as its raw value", () => {
  assert.equal(paymentMethodLabel("gift_certificate"), "Gift Certificate");
  assert.equal(paymentMethodLabel("credit_card"), "Credit Card");
  assert.equal(paymentMethodLabel("manual"), "Marked paid");
});
