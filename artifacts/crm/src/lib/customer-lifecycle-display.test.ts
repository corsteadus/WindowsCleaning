import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { customerLifecycleDisplayStatus } from "./customer-lifecycle-display.ts";

describe("customer lifecycle display", () => {
  it("renders Prospect consistently for list cards and detail headers", () => {
    const prospect = { lifecycleStatus: "prospect", status: "prospect" };
    assert.equal(customerLifecycleDisplayStatus(prospect), "prospect");
    assert.equal(customerLifecycleDisplayStatus({ lifecycleStatus: null, status: "prospect" }), "prospect");
  });

  it("uses canonical lifecycle over a drifted legacy status", () => {
    assert.equal(
      customerLifecycleDisplayStatus({ lifecycleStatus: "customer", status: "prospect" }),
      "customer",
    );
  });
});