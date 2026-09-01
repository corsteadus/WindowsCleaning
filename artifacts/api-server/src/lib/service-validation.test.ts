import assert from "node:assert/strict";
import test from "node:test";
import { mergeServiceUpdate, validateServiceInput, type CanonicalServiceInput } from "./service-validation.ts";

const SERVICE: CanonicalServiceInput = {
  name: "Exterior windows", description: null, category: "window_cleaning",
  pricingType: "per_window", basePrice: 12, unit: "window",
  estimatedDuration: 30, isActive: true,
};

test("service update validation merges existing values before checking canonical invariants", () => {
  const changedPricing = mergeServiceUpdate(SERVICE, { pricingType: "per_hour" });
  assert.equal(validateServiceInput(changedPricing), "Unit must be hour for per_hour pricing");
  assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { basePrice: -1 })), "Base price must be a finite nonnegative number");
  assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { category: "invalid" })), "Service category is invalid");
  assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { estimatedDuration: 1.5 })), "Estimated duration must be a nonnegative whole number of minutes");
});

test("a compatible merged service update preserves canonical values", () => {
  const merged = mergeServiceUpdate(SERVICE, { pricingType: "per_hour", unit: "hour", name: " Hourly exterior " });
  assert.equal(validateServiceInput(merged), null);
  assert.equal(merged.name, "Hourly exterior");
});