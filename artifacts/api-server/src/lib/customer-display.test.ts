/**
 * Tests for the pure customer display-name resolver and its wiring into the
 * job/schedule enrichment paths.
 *
 * Run with:  node --test --experimental-strip-types src/lib/customer-display.test.ts
 * (Node 22.6+ / Node 24 — no extra dependencies required)
 *
 * Regression target: business-only customer records (blank first/last name,
 * non-empty companyName) previously produced customerName " " (a truthy
 * single space) via `${firstName} ${lastName}`, rendering blank Schedule
 * cards. Canonical exemplar: customer 8894 "Conoco Gas Station" via
 * job 27193 / J-40429.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { customerDisplayName } from "./customer-display.ts";

describe("customerDisplayName: person-name priority", () => {
  it("joins first + last", () => {
    assert.strictEqual(customerDisplayName({ firstName: "Jane", lastName: "Doe" }, 1), "Jane Doe");
  });

  it("trims padded components before joining", () => {
    assert.strictEqual(customerDisplayName({ firstName: "  Jane ", lastName: " Doe  " }, 1), "Jane Doe");
  });

  it("uses only first when last is blank", () => {
    assert.strictEqual(customerDisplayName({ firstName: "Jane", lastName: "   ", companyName: "Acme" }, 1), "Jane");
  });

  it("uses only last when first is blank", () => {
    assert.strictEqual(customerDisplayName({ firstName: null, lastName: "Doe" }, 1), "Doe");
  });

  it("person name wins over companyName when either component exists", () => {
    assert.strictEqual(
      customerDisplayName({ firstName: "Jane", lastName: "", companyName: "Acme Corp" }, 1),
      "Jane",
    );
  });
});

describe("customerDisplayName: company fallback (business-only records)", () => {
  it("falls back to companyName for empty-string person fields", () => {
    assert.strictEqual(
      customerDisplayName({ firstName: "", lastName: "", companyName: "Acme Corp" }, 5),
      "Acme Corp",
    );
  });

  it("falls back to companyName for whitespace-only person fields", () => {
    assert.strictEqual(
      customerDisplayName({ firstName: "   ", lastName: " ", companyName: " Acme Corp " }, 5),
      "Acme Corp",
    );
  });

  it("falls back to companyName for null person fields", () => {
    assert.strictEqual(
      customerDisplayName({ firstName: null, lastName: null, companyName: "Acme Corp" }, 5),
      "Acme Corp",
    );
  });

  it("resolves the exact customer 8894 shape to its company name", () => {
    // Shape confirmed by the read-only audit: blank first/last, company set.
    const conoco = { firstName: "", lastName: "", companyName: "Conoco Gas Station" };
    assert.strictEqual(customerDisplayName(conoco, 8894), "Conoco Gas Station");
  });
});

describe("customerDisplayName: id fallback", () => {
  it("uses Customer #<id> when companyName is whitespace-only", () => {
    assert.strictEqual(
      customerDisplayName({ firstName: "", lastName: "", companyName: "   " }, 77),
      "Customer #77",
    );
  });

  it("uses Customer #<id> when all name parts are null", () => {
    assert.strictEqual(customerDisplayName({ firstName: null, lastName: null, companyName: null }, 8894), "Customer #8894");
  });

  it("handles a missing customer row (undefined parts) with an id", () => {
    assert.strictEqual(customerDisplayName(undefined, 8894), "Customer #8894");
  });

  it("accepts string ids", () => {
    assert.strictEqual(customerDisplayName(null, "42"), "Customer #42");
  });
});

describe("customerDisplayName: generic fallback (no id)", () => {
  it("returns 'Customer' when nothing exists and id is null", () => {
    assert.strictEqual(customerDisplayName({}, null), "Customer");
  });

  it("returns 'Customer' when nothing exists and id is undefined", () => {
    assert.strictEqual(customerDisplayName(undefined, undefined), "Customer");
  });

  it("returns 'Customer' for whitespace-only everything without an id", () => {
    assert.strictEqual(
      customerDisplayName({ firstName: " ", lastName: "  ", companyName: "\t" }),
      "Customer",
    );
  });
});

describe("customerDisplayName: never blank, never literal undefined/null", () => {
  it("never emits an empty or whitespace-only name for any blank/present combination", () => {
    const fieldValues = [undefined, null, "", "   ", "Val"];
    for (const firstName of fieldValues) {
      for (const lastName of fieldValues) {
        for (const companyName of fieldValues) {
          for (const id of [undefined, null, 8894]) {
            const out = customerDisplayName({ firstName, lastName, companyName }, id);
            assert.strictEqual(typeof out, "string");
            assert.ok(out.trim().length > 0, `blank output for ${JSON.stringify({ firstName, lastName, companyName, id })}`);
            assert.strictEqual(out, out.trim(), "output must be pre-trimmed");
          }
        }
      }
    }
  });

  it("treats a literal 'undefined' name token as blank and falls back", () => {
    assert.strictEqual(
      customerDisplayName({ firstName: "undefined", lastName: "undefined", companyName: "Acme Corp" }, 9),
      "Acme Corp",
    );
  });

  it("treats a literal 'null' companyName as blank and falls back to the id", () => {
    assert.strictEqual(
      customerDisplayName({ firstName: "", lastName: "", companyName: "null" }, 9),
      "Customer #9",
    );
  });

  it("ignores non-string name values without throwing", () => {
    const weird = { firstName: 42 as unknown as string, lastName: undefined, companyName: "Acme Corp" };
    assert.strictEqual(customerDisplayName(weird, 9), "Acme Corp");
  });
});

describe("wiring: schedule/job enrichment paths use the resolver", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("routes/jobs.ts enrichJobs builds customerName via customerDisplayName", () => {
    const src = read("../routes/jobs.ts");
    assert.ok(src.includes("customerDisplayName(c, j.customerId)"), "enrichJobs must call the resolver");
    assert.ok(!src.includes("`${c.firstName} ${c.lastName}`"), "raw first/last template must be gone from jobs.ts");
  });

  it("lib/recurring-plan-engine.ts due-for-service rows build customerName via customerDisplayName", () => {
    const src = read("./recurring-plan-engine.ts");
    assert.ok(src.includes("customerDisplayName(cust, p.customerId)"), "getDueForService must call the resolver");
    assert.ok(!src.includes("`${cust.firstName} ${cust.lastName}`"), "raw first/last template must be gone from the engine");
  });
});
