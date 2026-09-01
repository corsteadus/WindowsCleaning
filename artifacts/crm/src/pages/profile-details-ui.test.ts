import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const detail = readFileSync(new URL("./CustomerDetail.tsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("../components/ProfileDetailsTab.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./Settings.tsx", import.meta.url), "utf8");
const properties = readFileSync(new URL("./Properties.tsx", import.meta.url), "utf8");

test("Customer and Prospect detail share the profile details surface", () => {
  assert.match(detail, /ProfileDetailsTab/);
  assert.match(detail, /apiBase=\{apiBase\}/);
  assert.match(profile, /"general"/);
  assert.match(profile, /"billing"/);
  assert.match(profile, /"estimates"/);
  assert.match(profile, /general notes.*location notes.*estimate and job notes/i);
  for (const idField of ["profileTypeId", "profileGroupId", "paymentTermsId", "marketingSourceId"]) {
    assert.match(profile, new RegExp(`${idField}: null`));
  }
});

test("Settings catalogs are separate from the purge danger zone", () => {
  assert.match(settings, /Catalog & field manager/);
  assert.match(settings, /profile-types/);
  assert.match(settings, /service-types/);
  assert.match(settings, /Custom profile fields/);
  assert.match(settings, /Danger Zone/);
});

test("service location forms include structured metadata and distinct notes", () => {
  for (const field of ["county", "subdivision", "directions", "locationNotes"]) {
    assert.match(properties, new RegExp(field));
    assert.match(detail, new RegExp(field));
  }
});