import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  NO_CUSTOM_FIELD_FILTER,
  customFieldFilterParams,
  describeCustomFieldFilter,
  filterControlFor,
  isCustomFieldFilterActive,
  matchHintFor,
  withField,
} from "./custom-field-filter.ts";

const serverSource = readFileSync(
  fileURLToPath(new URL("../../../api-server/src/lib/custom-field-search.ts", import.meta.url)),
  "utf8",
);

test("each field type gets the control that suits it", () => {
  assert.equal(filterControlFor("text"), "text");
  assert.equal(filterControlFor("multiline"), "text");
  assert.equal(filterControlFor("number"), "number");
  assert.equal(filterControlFor("date"), "date");
  assert.equal(filterControlFor("dropdown"), "choice");
  assert.equal(filterControlFor("boolean"), "yesno");
  assert.equal(filterControlFor(null), "text", "a field type we do not know is text");
});

test("the screen says what a match means for that field", () => {
  assert.match(matchHintFor("number"), /exactly/);
  assert.match(matchHintFor("date"), /exactly/);
  assert.match(matchHintFor("dropdown"), /chosen option/);
  assert.match(matchHintFor("boolean"), /ticked/);
  assert.match(matchHintFor("text"), /anywhere in the text/);
});

test("the hints agree with the server about which types are exact", () => {
  // If the server's modes move, these words become a lie. The list there is the
  // one that decides.
  const exactBlock = serverSource.slice(
    serverSource.indexOf("switch (type)"),
    serverSource.indexOf('return "exact"'),
  );
  for (const type of ["dropdown", "boolean", "date", "number"]) {
    assert.match(exactBlock, new RegExp(`case "${type}":`), `${type} is no longer exact on the server`);
    assert.doesNotMatch(matchHintFor(type), /anywhere in the text/);
  }
  assert.match(matchHintFor("text"), /anywhere in the text/);
});

test("nothing chosen is not a filter", () => {
  assert.equal(isCustomFieldFilterActive(NO_CUSTOM_FIELD_FILTER), false);
  assert.deepEqual(customFieldFilterParams(NO_CUSTOM_FIELD_FILTER), {});
  // A value with no field cannot be compared against anything.
  assert.deepEqual(customFieldFilterParams({ fieldId: "", value: "Casement" }), {});
  assert.equal(isCustomFieldFilterActive({ fieldId: "  ", value: "x" }), false);
});

test("a field with no value asks who has it filled in at all", () => {
  assert.deepEqual(customFieldFilterParams({ fieldId: "4", value: "" }), { customFieldId: "4" });
  assert.deepEqual(customFieldFilterParams({ fieldId: "4", value: "   " }), { customFieldId: "4" });
});

test("a field and a value become the two parameters the API takes", () => {
  assert.deepEqual(customFieldFilterParams({ fieldId: "4", value: " Casement " }), {
    customFieldId: "4", customFieldValue: "Casement",
  });
  assert.deepEqual(customFieldFilterParams({ fieldId: " 7 ", value: "true" }), {
    customFieldId: "7", customFieldValue: "true",
  });
});

test("the filter reads back as a sentence", () => {
  assert.equal(describeCustomFieldFilter({ fieldId: "4", value: "Casement" }, "Window type"), "Window type is Casement");
  assert.equal(describeCustomFieldFilter({ fieldId: "4", value: "" }, "Window type"), "Window type has any value");
  assert.equal(describeCustomFieldFilter({ fieldId: "5", value: "true" }, "Needs ladder"), "Needs ladder is ticked");
  assert.equal(describeCustomFieldFilter({ fieldId: "5", value: "false" }, "Needs ladder"), "Needs ladder is not ticked");
  assert.equal(describeCustomFieldFilter({ fieldId: "5", value: "x" }, null), "That field is x");
  assert.equal(describeCustomFieldFilter(NO_CUSTOM_FIELD_FILTER, "Window type"), "");
});

test("choosing another field clears the value it cannot fit", () => {
  const casement = { fieldId: "4", value: "Casement" };
  assert.deepEqual(withField(casement, "2"), { fieldId: "2", value: "" });
  assert.equal(withField(casement, "4"), casement, "the same field keeps its value");
  assert.deepEqual(withField(casement, ""), { fieldId: "", value: "" });
});
