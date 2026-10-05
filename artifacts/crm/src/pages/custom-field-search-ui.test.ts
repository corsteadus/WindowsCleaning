/**
 * Kyle (Testing Edits, 2026-10-01) #3's last part, as guards:
 * *"These custom fields should … be searchable/filterable so a company can
 * categorize and find prospects or customers based on the values entered."*
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const customers = read("./Customers.tsx");
const filter = read("../components/CustomFieldFilter.tsx");
const route = read("../../../api-server/src/routes/customers.ts");

test("#3 the search box looks inside custom field values", () => {
  // EXISTS, not a join: a profile with three matching fields is still one row.
  assert.match(route, /EXISTS \(\s*\n\s*SELECT 1 FROM \$\{customFieldValuesTable\}/);
  assert.match(route, /ILIKE \$\{containsPattern\(term\)\}/);
  assert.match(route, /inCustomField,/);
  // And it says so, rather than leaving people to guess.
  assert.match(customers, /placeholder="Search by name, company, city, email, phone, or a custom field…"/);
});

test("#3 one field and one value filter the list", () => {
  assert.match(route, /customFieldId, customFieldValue,/);
  assert.match(route, /parseCustomFieldFilter\(\{ customFieldId, customFieldValue \}, definitions\)/);
  // A bad field is a 400 with a reason, not an empty list.
  assert.match(route, /if \(parsed\.kind === "error"\) \{\s*\n\s*res\.status\(400\)\.json\(\{ error: parsed\.message \}\)/);
  // Exact or contains, decided by the field's type.
  assert.match(route, /mode === "exact"/);
  assert.match(route, /ILIKE \$\{containsPattern\(value\)\}/);
  // A field with no value asks who has it filled in at all.
  assert.match(route, /IS NOT NULL AND \$\{customFieldValuesTable\.value\} <> ''/);
});

test("#3 both profile screens carry the filter", () => {
  // One file serves Prospects and Customers.
  assert.match(customers, /<CustomFieldFilter/);
  assert.match(customers, /from "@\/components\/CustomFieldFilter"/);
  assert.match(customers, /customFieldFilterParams\(customField\)/);
});

test("changing the filter refetches rather than showing the last answer", () => {
  const key = customers.slice(customers.indexOf("queryKey: authScopedQueryKey(user, ["));
  assert.match(key.slice(0, 400), /customFieldParams\.customFieldId/);
  assert.match(key.slice(0, 400), /customFieldParams\.customFieldValue/);
});

test("the control follows the field's type and says what a match means", () => {
  assert.match(filter, /filterControlFor\(selected\?\.fieldType\)/);
  assert.match(filter, /matchHintFor\(selected\.fieldType\)/);
  // A dropdown's choices come from its own catalogue, and only when needed.
  assert.match(filter, /enabled: control === "choice" && Boolean\(selected\)/);
  assert.match(filter, /\/api\/catalogs\/custom-field-\$\{selected!\.id\}/);
});

test("every control in the filter has a name", () => {
  assert.match(filter, /aria-label="Filter by a custom field"/);
  assert.equal((filter.match(/aria-label=\{`\$\{selected\.label\} value`\}/g) ?? []).length, 3,
    "each value control names itself after its field");
});

test("a company with no custom fields sees no filter at all", () => {
  assert.match(filter, /if \(fields\.length === 0\) return null;/);
});
