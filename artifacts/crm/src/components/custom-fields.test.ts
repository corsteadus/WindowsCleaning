// Prospect Profile Notes #2 and #3, with the types Kyle named on 2026-09-23.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(fileURLToPath(new URL("./ProfileDetailsTab.tsx", import.meta.url)), "utf8");
const input = source.slice(source.indexOf("function CustomFieldInput("));

test("the five types Kyle named are offered when creating a field", () => {
  assert.match(source, /\["text", "Text"\], \["number", "Number"\], \["date", "Date"\], \["dropdown", "Dropdown"\], \["boolean", "Checkbox"\]/);
});

test("a field is created and named from the profile itself", () => {
  assert.match(source, /apiFetch<\{ id: number; label: string; fieldType: string \}>\("\/api\/custom-fields\/definitions"/);
  assert.match(source, /aria-label="New field name"/);
  assert.match(source, /aria-label="New field type"/);
});

test("creating a dropdown opens its choices straight away", () => {
  assert.match(source, /if \(created\.fieldType === "dropdown"\) setChoiceCatalog\(/);
});

test("a dropdown's choices are managed with the same dialog as the other dropdowns", () => {
  assert.match(source, /slug: `custom-field-\$\{fieldId\}`/);
  assert.match(source, /\{choiceCatalog && <CatalogManager slug=\{choiceCatalog\.slug\}/);
});

test("each type is entered the way it should be", () => {
  assert.match(input, /case "boolean":[\s\S]*type="checkbox"/);
  assert.match(input, /case "number":[\s\S]*type="number"/);
  assert.match(input, /case "date":[\s\S]*type="date"/);
  assert.match(input, /case "dropdown":[\s\S]*<select/);
});

test("a dropdown still shows a value that is no longer one of the choices", () => {
  assert.match(input, /value && !\(field\.choices \?\? \[\]\)\.includes\(value\) && <option value=\{value\}>/);
});

test("only someone allowed to manage fields sees the add and remove controls", () => {
  assert.match(source, /hasClientCapability\(user, "custom_fields\.manage"\)/);
  assert.match(source, /\{canManageFields && <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3/);
  assert.match(source, /\{canManageFields && fieldId != null && \(/);
});

test("removing a field says the values entered are kept", () => {
  assert.match(source, /Values already entered are kept/);
});
