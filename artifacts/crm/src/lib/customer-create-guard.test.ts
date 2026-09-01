import assert from "node:assert/strict";
import test from "node:test";
import {
  hasSeparateAccountReason,
  shouldDisableCustomerCreate,
} from "./customer-create-guard.ts";

test("separate-account creation stays disabled for blank and whitespace-only reasons", () => {
  for (const reason of ["", " ", "\t", "\n", "  \n  "]) {
    assert.equal(hasSeparateAccountReason(reason), false, `reason=${JSON.stringify(reason)}`);
    assert.equal(
      shouldDisableCustomerCreate(false, "candidates", "separate", reason),
      true,
      `reason=${JSON.stringify(reason)}`,
    );
  }
});

test("separate-account creation enables only for a non-blank trimmed reason", () => {
  assert.equal(hasSeparateAccountReason("Intentional household split"), true);
  assert.equal(
    shouldDisableCustomerCreate(false, "candidates", "separate", " Intentional household split "),
    false,
  );
});