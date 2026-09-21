import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { primaryCustomerPhone } from "./customer-phone.ts";

test("the cell phone is what a crew is given first", () => {
  assert.equal(
    primaryCustomerPhone({ cellPhone: "8165550147", homePhone: "8165550148", phone: "8165550149" }),
    "8165550147",
  );
});

test("a customer with only a home phone still has a number", () => {
  assert.equal(primaryCustomerPhone({ homePhone: "8165550148" }), "8165550148");
});

// The profile form writes cellPhone/homePhone and never the legacy column, so
// every customer created through the UI looked phoneless to the crew.
test("the legacy column is used when it is the only one filled", () => {
  assert.equal(primaryCustomerPhone({ phone: "8165550149" }), "8165550149");
});

test("the work phone is the last resort", () => {
  assert.equal(primaryCustomerPhone({ workPhone: "8165550150" }), "8165550150");
});

test("blank and whitespace-only numbers are not numbers", () => {
  assert.equal(primaryCustomerPhone({ cellPhone: "   ", homePhone: "", phone: null }), null);
  assert.equal(primaryCustomerPhone({ cellPhone: "  ", homePhone: "8165550148" }), "8165550148");
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(primaryCustomerPhone({ cellPhone: " 8165550147 " }), "8165550147");
});

test("a missing customer is not an error", () => {
  assert.equal(primaryCustomerPhone(null), null);
  assert.equal(primaryCustomerPhone(undefined), null);
  assert.equal(primaryCustomerPhone({}), null);
});

test("the job payload resolves the phone rather than reading the legacy column", () => {
  const source = readFileSync(fileURLToPath(new URL("../routes/jobs.ts", import.meta.url)), "utf8");
  assert.match(source, /phone: primaryCustomerPhone\(customer\)/);
  assert.doesNotMatch(source, /phone: customer\.phone/);
});
