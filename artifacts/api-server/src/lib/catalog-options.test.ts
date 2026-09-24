import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { catalogAddPlan, catalogOptionCode } from "./catalog-options.ts";

test("a new option is inserted", () => {
  assert.deepEqual(catalogAddPlan(undefined), { kind: "insert" });
});

// Kyle's example: Facebook Ads removed, then wanted back.
test("re-adding a removed option brings the same row back", () => {
  assert.deepEqual(
    catalogAddPlan({ id: 7, name: "Facebook Ads", isActive: false }),
    { kind: "reactivate", id: 7 },
  );
});

test("adding an option that is already there is refused by name", () => {
  assert.deepEqual(
    catalogAddPlan({ id: 7, name: "Facebook Ads", isActive: true }),
    { kind: "duplicate", name: "Facebook Ads" },
  );
});

test("the code ignores case, spacing and punctuation", () => {
  assert.equal(catalogOptionCode("Facebook Ads"), "facebook-ads");
  assert.equal(catalogOptionCode("  facebook   ADS! "), "facebook-ads");
});

test("a name with no letters or digits still gets a code of its own", () => {
  assert.equal(catalogOptionCode("!!!"), "!!!");
  assert.notEqual(catalogOptionCode("!!!"), catalogOptionCode("???"));
});

test("the catalogue route plans the add instead of inserting blindly", () => {
  const source = readFileSync(fileURLToPath(new URL("../routes/profile-details.ts", import.meta.url)), "utf8");
  const route = source.slice(source.indexOf('router.post("/catalogs/:type"'), source.indexOf('router.patch("/catalogs/:type/:id"'));
  assert.match(route, /catalogAddPlan\(existing\)/);
  assert.match(route, /is already an option/);
  assert.ok(route.indexOf("catalogAddPlan") < route.indexOf("db.insert(profileCatalogItemsTable)"));
});
