import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalProspectCreateBody,
  prospectLifecycleTransition,
} from "./prospect-account.ts";

test("canonical Prospect creation always uses the shared prospect lifecycle", () => {
  assert.deepEqual(
    canonicalProspectCreateBody({
      firstName: "Pat",
      lastName: "Example",
      status: "active",
      lifecycleStatus: "customer",
    }, "2026-08-29"),
    {
      firstName: "Pat",
      lastName: "Example",
      status: "prospect",
      lifecycleStatus: "prospect",
      prospectDate: "2026-08-29",
    },
  );
});

test("canonical Prospect creation preserves an existing source prospect date", () => {
  const body = canonicalProspectCreateBody(
    { firstName: "Pat", lastName: "Example", prospectDate: "2025-03-01" },
    "2026-08-29",
  );

  assert.equal(body.prospectDate, "2025-03-01");
});

test("explicit Prospect conversion adds a customer date and distinct audit action", () => {
  assert.deepEqual(
    prospectLifecycleTransition(true, "prospect", "customer", "2026-08-29"),
    { customerDate: "2026-08-29", action: "prospect_converted" },
  );
  assert.deepEqual(
    prospectLifecycleTransition(false, "inactive", "customer", "2026-08-29"),
    { action: "reactivated" },
  );
});