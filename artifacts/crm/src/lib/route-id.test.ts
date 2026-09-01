import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePositiveRouteId } from "./route-id.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const detailSrc = readFileSync(
  join(HERE, "../pages/RecurringPlanDetail.tsx"),
  "utf8",
);

describe("parsePositiveRouteId", () => {
  it("accepts positive decimal digit strings, including leading zeroes", () => {
    assert.strictEqual(parsePositiveRouteId("1"), 1);
    assert.strictEqual(parsePositiveRouteId("0042"), 42);
    assert.strictEqual(
      parsePositiveRouteId(String(Number.MAX_SAFE_INTEGER)),
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects partial numeric strings instead of accepting a parseInt prefix", () => {
    assert.strictEqual(parsePositiveRouteId("123abc"), null);
    assert.strictEqual(parsePositiveRouteId("123 "), null);
    assert.strictEqual(parsePositiveRouteId(" 123"), null);
  });

  it("rejects missing, blank, whitespace, zero, and negative values", () => {
    for (const value of [undefined, null, "", " ", "\t", "0", "-1"]) {
      assert.strictEqual(parsePositiveRouteId(value), null, `value=${String(value)}`);
    }
  });

  it("rejects non-decimal notation and unsafe values", () => {
    for (const value of [
      "+1",
      "1.0",
      "1e3",
      "0x10",
      "NaN",
      "Infinity",
      "9007199254740992",
    ]) {
      assert.strictEqual(parsePositiveRouteId(value), null, `value=${value}`);
    }
  });
});

describe("RecurringPlanDetail route-ID guards", () => {
  it("uses the pure parser instead of parseInt for the route parameter", () => {
    assert.match(detailSrc, /parsePositiveRouteId\(id\)/);
    assert.ok(!detailSrc.includes("parseInt(id, 10)"));
  });

  it("keeps both generated hooks unconditional but disables the plan GET for invalid routes", () => {
    assert.match(detailSrc, /useGetRecurringPlan\(planId, \{\s*query: \{\s*enabled: isValidRouteId/);
    assert.match(detailSrc, /useListJobs\(/);
    assert.ok(!detailSrc.includes("if (!isValidRouteId) return"), "hooks must stay above conditional returns");
  });

  it("does not mount the broad jobs GET until route and customer IDs both exist", () => {
    assert.match(
      detailSrc,
      /enabled: isValidRouteId && plan\?\.customerId != null/,
    );
    assert.ok(
      !detailSrc.includes("useListJobs({ customerId: plan?.customerId });"),
      "jobs query must use its supported enabled option",
    );
  });

  it("renders a distinct invalid-link state with a Recurring Plans escape action", () => {
    assert.match(detailSrc, /Invalid recurring plan link/);
    assert.match(detailSrc, /positive whole number/);
    assert.match(detailSrc, /navigate\("\/recurring-plans"\)/);
    assert.match(detailSrc, /if \(!isValidRouteId\)/);
  });

  it("renders valid numeric not-found through the same stable escape presentation", () => {
    assert.match(detailSrc, /if \(!plan\)/);
    assert.match(detailSrc, /Recurring plan not found/);
    assert.match(detailSrc, /RecurringPlanUnavailable kind="missing"/);
    assert.match(detailSrc, /RecurringPlanUnavailable kind="invalid"/);
    assert.equal(
      detailSrc.match(/Back to Recurring Plans/g)?.length,
      1,
      "both states must share the one stable back-action component",
    );
    assert.match(detailSrc, /onBack=\{\(\) => navigate\("\/recurring-plans"\)\}/);
  });

  it("defensively blocks every mutation path when the route is invalid", () => {
    assert.match(detailSrc, /if \(!canMutate\) return;\s*updateMutation\.mutate/);
    assert.match(detailSrc, /const toggleAutoGenerate = \(\) => \{\s*if \(!canMutate\) return;/);
    assert.match(detailSrc, /const generateNextJob = \(\) => \{\s*if \(!canMutate\) return;/);
    assert.match(detailSrc, /const deletePlan = \(\) => \{\s*if \(!canMutate\) return;/);
  });
});