import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeServiceUpdate, normalizeServiceInput, unitForPricingType, validateServiceInput,
  type CanonicalServiceInput,
} from "./service-validation.ts";

const SERVICE: CanonicalServiceInput = {
  name: "Exterior windows", description: null, category: "window_cleaning",
  pricingType: "per_window", basePrice: 12, unit: "window",
  estimatedDuration: 30, isActive: true,
};
const CATEGORIES = new Set(["window_cleaning", "gutter_cleaning"]);

describe("what the catalogue insists on", () => {
  it("needs a name and a category, and nothing else", () => {
    const bare: CanonicalServiceInput = {
      name: "Gutter clearing", description: null, category: "gutter_cleaning",
      pricingType: null, basePrice: null, unit: null, estimatedDuration: null, isActive: true,
    };
    assert.equal(validateServiceInput(normalizeServiceInput(bare), CATEGORIES), null);
  });

  it("refuses a service with no name", () => {
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { name: "   " }), CATEGORIES),
      "Service name is required");
  });

  it("refuses a service with no category", () => {
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { category: "" }), CATEGORIES),
      "Service category is required");
  });

  it("refuses a category the business has not defined", () => {
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { category: "made_up" }), CATEGORIES),
      "Service category is not one your company has defined");
  });

  it("accepts any category when the caller could not read the list", () => {
    // A catalogue problem must not stop somebody saving their work.
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { category: "made_up" }), null), null);
  });
});

describe("price, which is no longer asked for", () => {
  it("accepts a service with no price at all — Kyle 2026-10-01 #8", () => {
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { basePrice: null }), CATEGORIES), null);
  });

  it("keeps a price a service already carries", () => {
    const kept = mergeServiceUpdate(SERVICE, { name: "Renamed" });
    assert.equal(kept.basePrice, 12, "an existing price is not thrown away by an unrelated edit");
  });

  it("still refuses a nonsense price when one is given", () => {
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { basePrice: -1 }), CATEGORIES),
      "Price must be a finite nonnegative number");
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { basePrice: Number.NaN }), CATEGORIES),
      "Price must be a finite nonnegative number");
  });

  it("accepts no pricing type, and refuses one that does not exist", () => {
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { pricingType: null }), CATEGORIES), null);
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { pricingType: "per_moon" }), CATEGORIES),
      "Pricing type is invalid");
  });
});

describe("the unit, which nobody should have to pick", () => {
  it("follows the pricing type rather than being asked for", () => {
    assert.equal(mergeServiceUpdate(SERVICE, { pricingType: "per_hour" }).unit, "hour");
    assert.equal(mergeServiceUpdate(SERVICE, { pricingType: "flat" }).unit, "service");
  });

  it("is nothing when there is no pricing type", () => {
    assert.equal(mergeServiceUpdate(SERVICE, { pricingType: null }).unit, null);
  });

  it("ignores a unit that disagrees with the pricing type, rather than refusing the save", () => {
    const merged = mergeServiceUpdate(SERVICE, { pricingType: "per_hour", unit: "window" });
    assert.equal(merged.unit, "hour");
    assert.equal(validateServiceInput(merged, CATEGORIES), null);
  });

  it("knows the unit each pricing type implies", () => {
    assert.equal(unitForPricingType("per_sqft"), "sq_ft");
    assert.equal(unitForPricingType(null), null);
    assert.equal(unitForPricingType("per_moon"), null);
  });
});

describe("merging an update", () => {
  it("tidies the name and keeps everything not being changed", () => {
    const merged = mergeServiceUpdate(SERVICE, { name: " Hourly exterior " });
    assert.equal(merged.name, "Hourly exterior");
    assert.equal(merged.category, "window_cleaning");
    assert.equal(validateServiceInput(merged, CATEGORIES), null);
  });

  it("still refuses a fractional duration", () => {
    assert.equal(validateServiceInput(mergeServiceUpdate(SERVICE, { estimatedDuration: 1.5 }), CATEGORIES),
      "Estimated duration must be a nonnegative whole number of minutes");
  });
});
