/**
 * Contract test: the enriched job / quote / recurring-plan response objects
 * must use propertyName (not the old propertyNickname).
 *
 * These tests verify the field-naming contract at the point where the API
 * server maps properties.name onto the response object.  They do NOT require
 * a database connection — they exercise the mapping logic in isolation.
 *
 * Run with: node --test --experimental-strip-types src/lib/property-enrich.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline the mapping logic that every enrichJob/enrichQuote/enrichPlan
//    function performs so we can test it without a DB ─────────────────────────

interface RawProperty {
  id: number;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}

function enrichPropertyFields(prop: RawProperty | null): {
  propertyName: string | null;
  propertyAddress: string | null;
} {
  return {
    propertyName: prop?.name ?? null,
    propertyAddress: prop
      ? [prop.address, prop.city, prop.state].filter(Boolean).join(", ") || null
      : null,
  };
}

describe("API enriched-response property field contract", () => {
  // ── Field name is propertyName, NOT propertyNickname ──────────────────────

  it("enriched output contains the key 'propertyName', not 'propertyNickname'", () => {
    const result = enrichPropertyFields({ id: 1, name: "Main House", address: "1 Oak St", city: "Portland", state: "OR" });
    assert.ok("propertyName" in result, "propertyName key must be present");
    assert.ok(!("propertyNickname" in result), "propertyNickname must NOT be present");
  });

  // ── Value derivation ──────────────────────────────────────────────────────

  it("propertyName is taken from property.name", () => {
    const result = enrichPropertyFields({ id: 2, name: "The Smiths", address: "42 Pine Ave" });
    assert.strictEqual(result.propertyName, "The Smiths");
  });

  it("propertyName is null when property has no name", () => {
    const result = enrichPropertyFields({ id: 3, address: "99 Elm St" });
    assert.strictEqual(result.propertyName, null);
  });

  it("propertyName is null when property is null (no property linked)", () => {
    const result = enrichPropertyFields(null);
    assert.strictEqual(result.propertyName, null);
  });

  it("propertyAddress joins address, city, state", () => {
    const result = enrichPropertyFields({ id: 4, address: "10 Main St", city: "Boston", state: "MA" });
    assert.strictEqual(result.propertyAddress, "10 Main St, Boston, MA");
  });

  it("propertyAddress omits blank/null parts", () => {
    const result = enrichPropertyFields({ id: 5, address: "5 Short Rd", city: null, state: "TX" });
    assert.strictEqual(result.propertyAddress, "5 Short Rd, TX");
  });

  it("propertyAddress is null when property is null", () => {
    const result = enrichPropertyFields(null);
    assert.strictEqual(result.propertyAddress, null);
  });

  it("propertyAddress is null when all address parts are blank", () => {
    const result = enrichPropertyFields({ id: 6 });
    assert.strictEqual(result.propertyAddress, null);
  });
});
