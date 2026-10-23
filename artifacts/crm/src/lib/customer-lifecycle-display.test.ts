import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { customerLifecycleDisplayStatus, isDeactivatedProfile } from "./customer-lifecycle-display.ts";

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
// Kyle, 2026-10-24: "Archived and Deactivated should mean the same thing."
describe("Deactivated", () => it("inactive and archived are both shown as Deactivated", () => {
  assert.equal(customerLifecycleDisplayStatus({ lifecycleStatus: "inactive" }), "deactivated");
  assert.equal(customerLifecycleDisplayStatus({ lifecycleStatus: "archived" }), "deactivated");
  assert.equal(isDeactivatedProfile({ lifecycleStatus: "prospect" }), false);
  assert.equal(isDeactivatedProfile({ lifecycleStatus: null, status: "inactive" }), true);
}));
