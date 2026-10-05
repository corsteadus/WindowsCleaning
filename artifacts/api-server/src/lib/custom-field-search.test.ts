import { strict as assert } from "node:assert";
import test from "node:test";
import {
  containsPattern,
  customFieldMatchMode,
  normaliseCustomFieldValue,
  parseCustomFieldFilter,
} from "./custom-field-search.ts";

const DEFINITIONS = [
  { id: 1, fieldType: "text" },
  { id: 2, fieldType: "number" },
  { id: 3, fieldType: "date" },
  { id: 4, fieldType: "dropdown" },
  { id: 5, fieldType: "boolean" },
  { id: 6, fieldType: "multiline" },
];

test("a choice, a date, a tick and a number match exactly", () => {
  // Filtering a Windows field by 12 must not return the profile with 120.
  assert.equal(customFieldMatchMode("dropdown"), "exact");
  assert.equal(customFieldMatchMode("date"), "exact");
  assert.equal(customFieldMatchMode("boolean"), "exact");
  assert.equal(customFieldMatchMode("number"), "exact");
});

test("free text is a contains match, because nobody types a note twice the same way", () => {
  assert.equal(customFieldMatchMode("text"), "contains");
  assert.equal(customFieldMatchMode("multiline"), "contains");
  assert.equal(customFieldMatchMode("something new"), "contains");
  assert.equal(customFieldMatchMode(null), "contains");
});

test("a tick is stored as true or false, however the form sends it", () => {
  for (const yes of ["true", "TRUE", "yes", "1", "checked", "  true  "]) {
    assert.equal(normaliseCustomFieldValue(yes, "boolean"), "true", yes);
  }
  for (const no of ["false", "No", "0", "unchecked"]) {
    assert.equal(normaliseCustomFieldValue(no, "boolean"), "false", no);
  }
  assert.equal(normaliseCustomFieldValue("maybe", "boolean"), null);
});

test("other values are kept as typed, trimmed", () => {
  assert.equal(normaliseCustomFieldValue("  Casement  ", "dropdown"), "Casement");
  assert.equal(normaliseCustomFieldValue("12", "number"), "12");
  assert.equal(normaliseCustomFieldValue("2026-10-05", "date"), "2026-10-05");
  assert.equal(normaliseCustomFieldValue("", "text"), null);
  assert.equal(normaliseCustomFieldValue("   ", "text"), null);
  assert.equal(normaliseCustomFieldValue(null, "text"), null);
  assert.equal(normaliseCustomFieldValue(42, "number"), null, "only a string arrives from a query");
});

test("no filter asked for", () => {
  assert.deepEqual(parseCustomFieldFilter({}, DEFINITIONS), { kind: "none" });
  assert.deepEqual(parseCustomFieldFilter({ customFieldId: "" }, DEFINITIONS), { kind: "none" });
  assert.deepEqual(
    parseCustomFieldFilter({ customFieldId: undefined, customFieldValue: "   " }, DEFINITIONS),
    { kind: "none" },
  );
});

test("a value with no field to compare it against is an error", () => {
  const result = parseCustomFieldFilter({ customFieldValue: "Casement" }, DEFINITIONS);
  assert.equal(result.kind, "error");
  assert.match(String(result.kind === "error" ? result.message : ""), /customFieldId is required/);
});

test("a field the company does not have says so, rather than finding nothing", () => {
  // A stale bookmark should not look like "no matches".
  const result = parseCustomFieldFilter({ customFieldId: "99", customFieldValue: "x" }, DEFINITIONS);
  assert.equal(result.kind, "error");
  assert.match(String(result.kind === "error" ? result.message : ""), /does not exist/);
});

test("an unusable field id is refused", () => {
  for (const id of ["0", "-3", "1.5", "abc"]) {
    const result = parseCustomFieldFilter({ customFieldId: id }, DEFINITIONS);
    assert.equal(result.kind, "error", id);
    assert.match(String(result.kind === "error" ? result.message : ""), /positive integer/);
  }
});

test("a filter carries the mode its field implies", () => {
  assert.deepEqual(
    parseCustomFieldFilter({ customFieldId: "4", customFieldValue: "Casement" }, DEFINITIONS),
    { kind: "filter", filter: { definitionId: 4, value: "Casement", mode: "exact" } },
  );
  assert.deepEqual(
    parseCustomFieldFilter({ customFieldId: "1", customFieldValue: " gate " }, DEFINITIONS),
    { kind: "filter", filter: { definitionId: 1, value: "gate", mode: "contains" } },
  );
  assert.deepEqual(
    parseCustomFieldFilter({ customFieldId: 5, customFieldValue: "yes" }, DEFINITIONS),
    { kind: "filter", filter: { definitionId: 5, value: "true", mode: "exact" } },
  );
});

test("a field with no value asks which profiles have it filled in at all", () => {
  assert.deepEqual(
    parseCustomFieldFilter({ customFieldId: "2" }, DEFINITIONS),
    { kind: "filter", filter: { definitionId: 2, value: null, mode: "exact" } },
  );
  assert.deepEqual(
    parseCustomFieldFilter({ customFieldId: "2", customFieldValue: "" }, DEFINITIONS),
    { kind: "filter", filter: { definitionId: 2, value: null, mode: "exact" } },
  );
});

test("a checkbox refuses anything that is not yes or no", () => {
  const result = parseCustomFieldFilter({ customFieldId: "5", customFieldValue: "sometimes" }, DEFINITIONS);
  assert.equal(result.kind, "error");
  assert.match(String(result.kind === "error" ? result.message : ""), /true or false/);
});

test("a value's own wildcards are searched for, not treated as wildcards", () => {
  // Otherwise searching for "100%" would match every profile.
  assert.equal(containsPattern("gate"), "%gate%");
  assert.equal(containsPattern("100%"), "%100\\%%");
  assert.equal(containsPattern("a_b"), "%a\\_b%");
  assert.equal(containsPattern("back\\side"), "%back\\\\side%");
});
