import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  customFieldChoiceCatalog,
  customFieldChoiceSlug,
  customFieldChoiceSlugId,
  isCustomFieldType,
  OFFERED_CUSTOM_FIELD_TYPES,
} from "./custom-field-types.ts";

test("the five types Kyle named are the ones offered, checkbox included", () => {
  assert.deepEqual(
    OFFERED_CUSTOM_FIELD_TYPES.map((type) => type.label),
    ["Text", "Number", "Date", "Dropdown", "Checkbox"],
  );
  // Checkbox is the existing boolean type under the name Kyle uses.
  assert.equal(OFFERED_CUSTOM_FIELD_TYPES.find((type) => type.label === "Checkbox")?.value, "boolean");
});

test("dropdown is accepted, and multiline still is for fields that already use it", () => {
  for (const type of ["text", "number", "date", "boolean", "dropdown", "multiline"]) {
    assert.equal(isCustomFieldType(type), true, `${type} should be a field type`);
  }
  for (const type of ["checkbox", "select", "", null, 7]) {
    assert.equal(isCustomFieldType(type), false, `${String(type)} should not be a field type`);
  }
});

test("each dropdown field has its own choice catalogue", () => {
  assert.equal(customFieldChoiceCatalog(12), "custom_field_12");
  assert.notEqual(customFieldChoiceCatalog(12), customFieldChoiceCatalog(13));
});

test("the slug round-trips to the definition it belongs to", () => {
  assert.equal(customFieldChoiceSlug(12), "custom-field-12");
  assert.equal(customFieldChoiceSlugId("custom-field-12"), 12);
});

test("anything that is not a choice catalogue slug is refused", () => {
  for (const slug of ["profile-types", "custom-field-", "custom-field-0", "custom-field-x", "custom-field--1", "custom-field-1x"]) {
    assert.equal(customFieldChoiceSlugId(slug), null, `${slug} should not resolve`);
  }
});

test("the choice catalogue cannot collide with a built-in catalogue name", () => {
  const source = readFileSync(fileURLToPath(new URL("../routes/profile-details.ts", import.meta.url)), "utf8");
  const builtIn = [...source.matchAll(/"([a-z_]+)",?\s*$/gm)].map((match) => match[1]);
  assert.ok(!builtIn.includes(customFieldChoiceCatalog(1)));
});
