import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canSubmitService, emptyServiceDraft, serviceDraftToBody,
  serviceIdempotencyHeaders, validateServiceDraft,
} from "./service-form.ts";
import { hasClientCapability } from "./rbac.ts";

describe("who may add to the catalogue", () => {
  it("denies a field tech and allows a canonical admin envelope", () => {
    assert.equal(hasClientCapability({ capabilities: [] }, "services.manage"), false);
    assert.equal(hasClientCapability({ capabilities: ["services.manage"] }, "services.manage"), true);
  });
});

describe("what the catalogue asks for", () => {
  // Kyle (Testing Edits, 2026-10-01, #8): a name and a category, nothing else.
  it("needs a name", () => {
    assert.equal(validateServiceDraft(emptyServiceDraft("window_cleaning")), "Service name is required.");
  });

  it("needs a category", () => {
    assert.equal(validateServiceDraft({ ...emptyServiceDraft(), name: "Wash" }), "Choose a category.");
  });

  it("asks for no price at all", () => {
    const draft = { ...emptyServiceDraft("window_cleaning"), name: "Wash" };
    assert.equal(validateServiceDraft(draft), null);
    assert.ok(!("basePrice" in draft), "a price has no place on a catalogue draft");
    assert.ok(!("pricingType" in draft), "nor a pricing type");
  });

  it("still refuses a fractional duration", () => {
    assert.equal(
      validateServiceDraft({ ...emptyServiceDraft("window_cleaning"), name: "Wash", estimatedDuration: "1.2" }),
      "Duration must be a nonnegative whole number of minutes.",
    );
  });

  it("resets cleanly when the dialog is reopened", () => {
    assert.deepEqual(emptyServiceDraft(), emptyServiceDraft());
  });

  it("guards against a double submit while one is in flight", () => {
    assert.equal(canSubmitService(true), false);
    assert.equal(canSubmitService(false), true);
  });

  it("carries the idempotency key the server insists on", () => {
    assert.deepEqual(serviceIdempotencyHeaders("retry-key"), { "Idempotency-Key": "retry-key" });
  });
});

// Profile Notes #22: the catalogue page and the quick-add on quotes and jobs
// must store a service the same way, so both go through serviceDraftToBody.
describe("the body both screens send", () => {
  it("tidies the name and sends no price", () => {
    const prepared = serviceDraftToBody({
      ...emptyServiceDraft("window_cleaning"), name: "  Exterior windows  ",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.deepEqual(prepared.body, {
      name: "Exterior windows", description: null, category: "window_cleaning",
      pricingType: null, basePrice: null, unit: null, estimatedDuration: null, isActive: true,
    });
  });

  it("keeps a duration when one is given", () => {
    const prepared = serviceDraftToBody({
      ...emptyServiceDraft("gutter_cleaning"), name: "Gutters", estimatedDuration: "45",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.body.estimatedDuration, 45);
    assert.equal(prepared.body.category, "gutter_cleaning");
  });

  it("is refused with the validator's reason", () => {
    assert.deepEqual(serviceDraftToBody(emptyServiceDraft("window_cleaning")),
      { ok: false, error: "Service name is required." });
    assert.deepEqual(serviceDraftToBody({ ...emptyServiceDraft(), name: "Gutters" }),
      { ok: false, error: "Choose a category." });
  });
});
