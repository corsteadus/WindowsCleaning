import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  customerSinceOnCreate,
  customerSinceOnTransition,
  withoutClientCustomerSince,
} from "./customer-since.ts";

const TODAY = "2026-09-22";

test("an account created as a customer is a customer from today", () => {
  assert.equal(customerSinceOnCreate("customer", TODAY), TODAY);
});

test("a prospect has no Customer Since date yet", () => {
  assert.equal(customerSinceOnCreate("prospect", TODAY), null);
  assert.equal(customerSinceOnCreate(undefined, TODAY), null);
});

test("converting a prospect sets Customer Since to the day of conversion", () => {
  assert.equal(
    customerSinceOnTransition({ lifecycle: "prospect", customerSince: null }, "customer", TODAY),
    TODAY,
  );
});

test("an existing Customer Since date is never moved", () => {
  // e.g. a customer archived years ago and brought back today
  assert.equal(
    customerSinceOnTransition({ lifecycle: "archived", customerSince: "2021-04-02" }, "customer", TODAY),
    undefined,
  );
});

test("staying a customer changes nothing", () => {
  assert.equal(
    customerSinceOnTransition({ lifecycle: "customer", customerSince: null }, "customer", TODAY),
    undefined,
  );
});

test("moving to anything other than customer changes nothing", () => {
  for (const next of ["prospect", "inactive", "archived"]) {
    assert.equal(
      customerSinceOnTransition({ lifecycle: "prospect", customerSince: null }, next, TODAY),
      undefined,
    );
  }
});

test("a value the client sent is dropped", () => {
  const fields: Record<string, unknown> = { firstName: "Jane", customerDate: "1999-01-01" };
  assert.equal(withoutClientCustomerSince(fields), fields);
  assert.deepEqual(fields, { firstName: "Jane" });
});

test("create, edit and status change all go through the system rule", () => {
  const source = readFileSync(fileURLToPath(new URL("../routes/customers.ts", import.meta.url)), "utf8");
  assert.match(source, /withoutClientCustomerSince\(normalized\.fields\);/);
  assert.match(source, /const updateData = withoutClientCustomerSince\(normalized\.fields\);/);
  assert.match(source, /customerSinceOnCreate\(/);
  assert.equal(source.match(/customerSinceOnTransition\(/g)?.length, 2);
});
