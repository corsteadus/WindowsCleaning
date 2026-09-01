/**
 * Regression tests for the canonical property display contract.
 *
 * Run with:  node --test --experimental-strip-types src/lib/property.test.ts
 * (Node 22.6+ / Node 24 — no extra dependencies required)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activePropertyChoices, effectivePropertyId, propertyLabel, jobPropertyLabel, propertyRelationshipLabel, type PropertyLike } from "./property.ts";
import { propertySearchParams } from "./property-search.ts";

describe("propertyLabel — canonical property display contract", () => {
  // ── Canonical field usage ────────────────────────────────────────────────

  it("full property: name, address, city, state, zip all present", () => {
    assert.strictEqual(
      propertyLabel({ id: 1, name: "HQ", address: "123 Main St", city: "Springfield", state: "IL", zip: "62701" }),
      "HQ — 123 Main St, Springfield, IL, 62701",
    );
  });

  it("includes street address when present (no name)", () => {
    assert.strictEqual(
      propertyLabel({ id: 2, address: "456 Oak Ave", city: "Portland", state: "OR", zip: "97201" }),
      "456 Oak Ave, Portland, OR, 97201",
    );
  });

  it("includes ZIP when present", () => {
    const label = propertyLabel({ id: 3, address: "789 Pine Rd", zip: "10001" });
    assert.ok(label.includes("10001"), `ZIP should appear in label, got: "${label}"`);
    assert.ok(label.includes("789 Pine Rd"), `street should appear in label, got: "${label}"`);
  });

  // ── Blank-part omission ──────────────────────────────────────────────────

  it("omits null fields — no stray commas, no 'null'/'undefined'", () => {
    const label = propertyLabel({ id: 4, address: "1 Main St", city: null, state: null, zip: "11001" });
    assert.strictEqual(label, "1 Main St, 11001");
    assert.ok(!label.includes("null"), "must not contain the string 'null'");
    assert.ok(!label.includes("undefined"), "must not contain the string 'undefined'");
  });

  it("omits undefined fields cleanly", () => {
    assert.strictEqual(
      propertyLabel({ id: 5, address: "2 Elm St" }),
      "2 Elm St",
    );
  });

  it("name-only (no address parts) returns just the name — no trailing separator", () => {
    const label = propertyLabel({ id: 6, name: "Warehouse" });
    assert.strictEqual(label, "Warehouse");
    assert.ok(!label.includes("—"), "no separator when addr is empty");
  });

  it("falls back to 'Property #id' when all fields blank", () => {
    assert.strictEqual(propertyLabel({ id: 7 }), "Property #7");
  });

  it("falls back to 'Property #id' when all fields are null", () => {
    assert.strictEqual(
      propertyLabel({ id: 8, address: null, city: null, state: null, zip: null, name: null }),
      "Property #8",
    );
  });

  it("name + full address uses ' — ' separator", () => {
    const label = propertyLabel({ id: 9, name: "Office", address: "10 St", city: "NYC", state: "NY", zip: "10001" });
    assert.ok(label.startsWith("Office — "), `label should start with "Office — ", got: "${label}"`);
  });

  // ── Legacy field rejection ───────────────────────────────────────────────

  it("ignores legacy 'addressLine1' — canonical 'address' is used instead", () => {
    const p = { id: 10, address: "100 Real St", zip: "90001" } as PropertyLike & Record<string, unknown>;
    p["addressLine1"] = "LEGACY — must not appear";
    const label = propertyLabel(p);
    assert.ok(!label.includes("LEGACY"), `addressLine1 must not appear in label, got: "${label}"`);
    assert.ok(label.includes("100 Real St"), `canonical address must appear, got: "${label}"`);
  });

  it("ignores legacy 'postalCode' — canonical 'zip' is used instead", () => {
    const p = { id: 11, zip: "10001" } as PropertyLike & Record<string, unknown>;
    p["postalCode"] = "99999";
    const label = propertyLabel(p);
    assert.ok(label.includes("10001"), `canonical zip must appear, got: "${label}"`);
    assert.ok(!label.includes("99999"), `legacy postalCode must not appear, got: "${label}"`);
  });

  it("ignores legacy 'nickname' — canonical 'name' is used instead", () => {
    const p = { id: 12, name: "Real Name", address: "1 St" } as PropertyLike & Record<string, unknown>;
    p["nickname"] = "LEGACY NICKNAME";
    const label = propertyLabel(p);
    assert.ok(label.startsWith("Real Name"), `canonical name must be used, got: "${label}"`);
    assert.ok(!label.includes("LEGACY NICKNAME"), `legacy nickname must not appear, got: "${label}"`);
  });
});

describe("jobPropertyLabel — enriched API response property display contract", () => {
  // ── propertyName takes priority ───────────────────────────────────────────

  it("returns propertyName when both propertyName and propertyAddress are present", () => {
    assert.strictEqual(
      jobPropertyLabel({ propertyId: 1, propertyName: "The Smiths", propertyAddress: "10 Oak St, Portland, OR" }),
      "The Smiths",
    );
  });

  it("returns propertyName when propertyAddress is absent", () => {
    assert.strictEqual(
      jobPropertyLabel({ propertyId: 2, propertyName: "Warehouse" }),
      "Warehouse",
    );
  });

  // ── propertyAddress fallback ──────────────────────────────────────────────

  it("returns propertyAddress when propertyName is null", () => {
    assert.strictEqual(
      jobPropertyLabel({ propertyId: 3, propertyName: null, propertyAddress: "42 Pine Ave, Salem, OR" }),
      "42 Pine Ave, Salem, OR",
    );
  });

  it("returns propertyAddress when propertyName is undefined", () => {
    assert.strictEqual(
      jobPropertyLabel({ propertyId: 4, propertyAddress: "99 Elm Rd" }),
      "99 Elm Rd",
    );
  });

  // ── 'Property #id' fallback ───────────────────────────────────────────────

  it("returns 'Property #id' when both name and address are absent", () => {
    assert.strictEqual(
      jobPropertyLabel({ propertyId: 5 }),
      "Property #5",
    );
  });

  it("returns 'Property #id' when both name and address are null", () => {
    assert.strictEqual(
      jobPropertyLabel({ propertyId: 6, propertyName: null, propertyAddress: null }),
      "Property #6",
    );
  });

  // ── null (no property linked) ─────────────────────────────────────────────

  it("returns null when no property fields are present (job with no property)", () => {
    assert.strictEqual(jobPropertyLabel({}), null);
  });

  it("returns null when propertyId is null and name/address are absent", () => {
    assert.strictEqual(jobPropertyLabel({ propertyId: null }), null);
  });

  // ── propertyNickname must not be used ────────────────────────────────────

  it("does NOT read a legacy propertyNickname field — that name is removed from the contract", () => {
    // Even if a stale response accidentally contains propertyNickname,
    // jobPropertyLabel must not expose it (it only reads propertyName).
    const stale = { propertyId: 7, propertyAddress: "5 Main St" } as Record<string, unknown>;
    stale["propertyNickname"] = "SHOULD NOT APPEAR";
    // Cast via JobPropertyFields — propertyNickname is not in the type,
    // so TypeScript prevents accidental reads. The runtime result must
    // fall through to propertyAddress, not pick up the legacy field.
    const label = jobPropertyLabel(stale as { propertyId: number; propertyAddress: string });
    assert.strictEqual(label, "5 Main St", `must use propertyAddress, not propertyNickname; got: "${label}"`);
    assert.ok(String(label) !== "SHOULD NOT APPEAR", "propertyNickname must never be returned");
  });
});

describe("property selection scope — active owned/shared locations only", () => {
  const properties: PropertyLike[] = [
    { id: 21, name: "Owned home", address: "1 Main", isOwner: true },
    { id: 22, name: "Shared office", address: "2 Main", isOwner: false, relationshipType: "shared" },
    { id: 23, name: "Old location", address: "3 Main", archivedAt: "2025-01-01" },
  ];

  it("removes archived properties from new-record choices", () => {
    assert.deepStrictEqual(activePropertyChoices(properties).map((property) => property.id), [21, 22]);
  });

  it("accepts the customer's effective default only when it is active", () => {
    assert.strictEqual(effectivePropertyId(properties, 22), 22);
    assert.strictEqual(effectivePropertyId(properties, 23), null);
  });

  it("labels account relationship without changing the canonical property label", () => {
    assert.strictEqual(propertyRelationshipLabel(properties[0]), "Owned");
    assert.strictEqual(propertyRelationshipLabel(properties[1]), "Shared");
    assert.strictEqual(propertyLabel(properties[1]), "Shared office — 2 Main");
  });
});

describe("global property search contract", () => {
  it("sends trimmed account-aware search terms with the paginated filters", () => {
    assert.deepEqual(
      propertySearchParams({
        page: 2,
        pageSize: 25,
        search: " Judy Heinje ",
        status: "active",
        relationship: "all",
      }),
      {
        page: 2,
        pageSize: 25,
        search: "Judy Heinje",
        status: "active",
        relationship: "all",
      },
    );
  });

  it("keeps empty search omitted so pagination and filters remain server-owned", () => {
    assert.deepEqual(
      propertySearchParams({
        page: 1,
        pageSize: 25,
        search: "   ",
        status: "all",
        relationship: "shared",
      }),
      {
        page: 1,
        pageSize: 25,
        search: undefined,
        status: "all",
        relationship: "shared",
      },
    );
  });
});
