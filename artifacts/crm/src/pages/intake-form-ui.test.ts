// Profile redesign piece B (Kyle, Video 2): the Add form reads in the same
// order as the profile page, and what it asks for is actually sent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(fileURLToPath(new URL("./Customers.tsx", import.meta.url)), "utf8");
const form = source.slice(source.indexOf("function NewCustomerForm("), source.indexOf("function DuplicateReviewPanel("));

test("the Add form follows the profile page: name, contact, address, notes, more details", () => {
  const order = ['title="Name"', 'title="Contact Information"', 'title="Service Address"', 'title="Notes"', "More details"]
    .map((marker) => form.indexOf(marker));
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])), order.join(","));
});

test("the six phones each say whose number it is, and emails are a list", () => {
  assert.match(form, /INTAKE_PHONES\.map\(\(\{ slot, field \}\)/);
  assert.match(form, /<OwnerSelect label=\{`Whose \$\{slot\} number`\}/);
  assert.match(form, /<EmailRows rows=\{emailRows\}/);
});

test("up to two more named locations, and the marketing source from the managed list", () => {
  assert.match(form, /<ExtraLocations rows=\{extraLocations\}/);
  assert.match(form, /\/api\/catalogs\/marketing-sources/);
  assert.doesNotMatch(form, /register\("howHeard"\)/, "the free-text box gave way to the dropdown");
});

test("both create paths send the intake, after its problems are checked", () => {
  assert.match(form, /if \(problems\.length\) return;\s*const intake = buildIntake\(intakeState\);/);
  assert.match(form, /\.\.\.\(\{ intake \} as object\),\s*initialJob:/);
  assert.match(form, /\.\.\.v,\s*intake,/);
});

test("nothing that was on the form was dropped", () => {
  for (const field of ["salutation", "companyName", "billingAddress", "county", "subdivision", "birthday", "notes",
    "directions", "isNonProfit", "ccFeeExempt", "taxExempt", "tags", "starRating", "altContact", "altPhoneType"]) {
    assert.ok(form.includes(`"${field}"`), `${field} is missing from the form`);
  }
});
