import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./profile-details.ts", import.meta.url), "utf8");
const propertyRoute = readFileSync(new URL("./properties.ts", import.meta.url), "utf8");
const customerRoute = readFileSync(new URL("./customers.ts", import.meta.url), "utf8");

test("profile APIs share customer IDs and lifecycle-scope Prospect aliases", () => {
  assert.match(route, /"\/customers\/:id\/profile-details", "\/prospects\/:id\/profile-details"/);
  assert.match(route, /customer\.lifecycleStatus !== "prospect"/);
  assert.match(route, /contactId does not belong to this account/);
  assert.match(route, /archive[dA-z]*By: actor\(req\)/);
});

test("communication purposes and catalog activation remain explicit", () => {
  for (const purpose of ["general", "billing", "estimates"]) assert.match(route, new RegExp(purpose));
  assert.match(route, /isActive: false/);
  assert.match(route, /customFieldDefinitionsTable/);
  assert.match(route, /eq\(customFieldDefinitionsTable\.scope, "account"\)/);
  assert.match(route, /inArray\(customFieldDefinitionsTable\.template, \["all", profileTemplate\]\)/);
});

test("rich locations are distinct from account and financial notes", () => {
  for (const field of ["county", "subdivision", "directions", "locationNotes"]) {
    assert.match(propertyRoute, new RegExp(field));
  }
  assert.doesNotMatch(route, /update\(quotesTable\)|update\(jobsTable\)|update\(quoteLineItemsTable\)/);
  assert.match(customerRoute, /notes/);
});