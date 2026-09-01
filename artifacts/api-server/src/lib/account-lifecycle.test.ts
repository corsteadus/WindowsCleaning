import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  customerLifecycleStatus,
  legacyStatusFromLifecycleStatus,
  lifecycleStatusFromLegacyStatus,
  normalizeAccountType,
  parseLifecycleStatus,
} from "./account-lifecycle.ts";

const customerRouteSource = fs.readFileSync(
  new URL("../routes/customers.ts", import.meta.url),
  "utf8",
);

describe("account lifecycle normalization", () => {
  it("maps legacy customer statuses to canonical lifecycle values", () => {
    assert.equal(lifecycleStatusFromLegacyStatus("active"), "customer");
    assert.equal(lifecycleStatusFromLegacyStatus("prospect"), "prospect");
    assert.equal(lifecycleStatusFromLegacyStatus("inactive"), "inactive");
    assert.equal(lifecycleStatusFromLegacyStatus("archived"), "archived");
    assert.equal(lifecycleStatusFromLegacyStatus("unknown"), null);
  });

  it("maps canonical customer back to the legacy active status", () => {
    assert.equal(legacyStatusFromLifecycleStatus("customer"), "active");
    assert.equal(legacyStatusFromLifecycleStatus("prospect"), "prospect");
    assert.equal(legacyStatusFromLifecycleStatus("inactive"), "inactive");
  });

  it("normalizes account types without changing the stored clientType contract", () => {
    assert.equal(normalizeAccountType("COMMERCIAL"), "commercial");
    assert.equal(normalizeAccountType("residential"), "residential");
    assert.equal(normalizeAccountType(undefined), "residential");
    assert.equal(normalizeAccountType("legacy-value"), "residential");
  });

  it("prefers canonical lifecycle and falls back to legacy status", () => {
    assert.equal(customerLifecycleStatus({ lifecycleStatus: "inactive", status: "active" }), "inactive");
    assert.equal(customerLifecycleStatus({ lifecycleStatus: null, status: "active" }), "customer");
    assert.equal(customerLifecycleStatus({ lifecycleStatus: "prospect", status: "prospect" }), "prospect");
    assert.equal(customerLifecycleStatus({ lifecycleStatus: null, status: "prospect" }), "prospect");
    assert.equal(customerLifecycleStatus({ lifecycleStatus: "customer", status: "prospect" }), "customer");
    assert.equal(customerLifecycleStatus({ status: "unrecognized" }), "customer");
    assert.equal(parseLifecycleStatus(" CUSTOMER "), "customer");
  });

  it("filters Prospect by the canonical field used by list/detail serialization", () => {
    assert.match(
      customerRouteSource,
      /conditions\.push\(eq\(customersTable\.lifecycleStatus, lifecycle\)\)/,
    );
    assert.doesNotMatch(customerRouteSource, /eq\(customersTable\.status, legacyStatus\)/);
  });
});