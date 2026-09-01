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