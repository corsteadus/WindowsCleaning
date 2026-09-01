import assert from "node:assert/strict";
import test from "node:test";

import { customerListSearchLocation } from "./customer-list-url.ts";

test("customer search set, change, and clear stay refresh-safe while preserving unrelated parameters", () => {
  const initial = customerListSearchLocation("/customers", "view=active", "qa dEb");
  assert.equal(initial, "/customers?view=active&q=qa+dEb");

  const changed = customerListSearchLocation(
    "/customers",
    initial.split("?")[1] ?? "",
    "Ada Lovelace",
  );
  assert.equal(changed, "/customers?view=active&q=Ada+Lovelace");

  const cleared = customerListSearchLocation(
    "/customers",
    changed.split("?")[1] ?? "",
    "",
  );
  assert.equal(cleared, "/customers?view=active");
  assert.equal(new URL(`https://sandbox.invalid${cleared}`).searchParams.get("q"), null);
});

test("customer search preserves the currently mounted route alias", () => {
  assert.equal(
    customerListSearchLocation("/leads", "tab=open&q=old", "new"),
    "/leads?tab=open&q=new",
  );
});