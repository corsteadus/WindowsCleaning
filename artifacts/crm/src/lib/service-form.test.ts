import assert from "node:assert/strict";
import test from "node:test";
import { canSubmitService, emptyServiceDraft, isServiceCategory, isServicePricingType, serviceIdempotencyHeaders, validateServiceDraft } from "./service-form.ts";
import { hasClientCapability } from "./rbac.ts";

test("service form interaction state denies field tech and allows canonical admin capability envelopes", () => {
  assert.equal(hasClientCapability({ capabilities: [] }, "services.manage"), false);
  assert.equal(hasClientCapability({ capabilities: ["services.manage"] }, "services.manage"), true);
});

test("service dialog draft supports cancel/reset, validation, and pending double-submit protection", () => {
  const opened = emptyServiceDraft();
  assert.equal(validateServiceDraft(opened), "Service name is required.");
  assert.equal(validateServiceDraft({ ...opened, name: "Wash", basePrice: "-1" }), "Price must be a finite nonnegative number.");
  assert.equal(validateServiceDraft({ ...opened, name: "Wash", basePrice: "0", estimatedDuration: "1.2" }), "Duration must be a nonnegative whole number of minutes.");
  assert.deepEqual(emptyServiceDraft(), opened); // cancel/reopen resets the controlled form
  assert.equal(canSubmitService(true), false);
  assert.equal(canSubmitService(false), true);
  assert.deepEqual(serviceIdempotencyHeaders("retry-key"), { "Idempotency-Key": "retry-key" });
  assert.equal(isServiceCategory("window_cleaning"), true);
  assert.equal(isServicePricingType("per_hour"), true);
});
// Profile Notes #22: the catalogue page and the quick-add on quotes and jobs
// must store a service the same way, so both go through serviceDraftToBody.
test("a draft becomes the catalogue body the Service Catalog page sends", async () => {
  const { serviceDraftToBody } = await import("./service-form.ts");
  const prepared = serviceDraftToBody({
    ...emptyServiceDraft(), name: "  Exterior windows  ", pricingType: "per_window", basePrice: "4.5",
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(prepared.body, {
    name: "Exterior windows", description: null, category: "window_cleaning",
    pricingType: "per_window", basePrice: 4.5, unit: "window", estimatedDuration: null, isActive: true,
  });
});

test("an invalid draft is refused with the validator's reason", async () => {
  const { serviceDraftToBody } = await import("./service-form.ts");
  assert.deepEqual(serviceDraftToBody({ ...emptyServiceDraft(), basePrice: "10" }),
    { ok: false, error: "Service name is required." });
  assert.deepEqual(serviceDraftToBody({ ...emptyServiceDraft(), name: "Gutters", basePrice: "-1" }),
    { ok: false, error: "Price must be a finite nonnegative number." });
});
