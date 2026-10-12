import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const card = read("./ProfileCustomFieldsCard.tsx");
const input = read("./CustomFieldInput.tsx");
const details = read("./ProfileDetailsTab.tsx");
const detail = read("../pages/CustomerDetail.tsx");

describe("custom fields on the tab a profile opens on — Kyle #3", () => {
  // His report was that the fields "are not appearing on Prospect or Customer
  // profiles". They were — on Profile Details. A profile opens on Overview,
  // which showed nothing of them.
  it("the Overview tab renders them", () => {
    assert.match(detail, /import \{ ProfileCustomFieldsCard \}/);
    assert.match(detail, /<ProfileCustomFieldsCard customerId=\{customer\.id\} apiBase=\{apiBase\} \/>/);
  });

  it("it works for a prospect as well as a customer", () => {
    // apiBase is "/api/prospects" on a prospect route, and the server serves
    // both spellings of every route this card uses.
    assert.match(detail, /const apiBase = isProspectRoute \? "\/api\/prospects" : "\/api\/customers"/);
    assert.match(card, /\$\{apiBase\}\/\$\{customerId\}\/profile-details/);
    assert.match(card, /\$\{apiBase\}\/\$\{customerId\}\/custom-fields/);
  });

  it("saves the same way Profile Details does", () => {
    assert.match(card, /method: "PUT"/);
    assert.match(details, /\/custom-fields`, \{ method: "PUT"/);
  });

  it("does not offer managing the fields, only filling them in", () => {
    // Creating, deleting and editing a dropdown's choices stay in one place.
    for (const managing of ["New field name", "Remove ", "Choices", "createField", "removeField"]) {
      assert.ok(!card.includes(managing), `the Overview card should not offer "${managing}"`);
    }
    assert.match(details, /New field name/);
  });

  it("shows nothing at all when the company has no custom fields", () => {
    // An empty box on the front page of every profile is worse than silence.
    assert.match(card, /if \(!stored\.length\) return null;/);
  });

  it("asks Profile Details to refetch, so the two cannot disagree", () => {
    assert.match(card, /invalidateQueries\(\{ queryKey: \["profile-details"\] \}\)/);
  });
});

describe("one input, used by both screens", () => {
  it("lives in its own file now", () => {
    assert.match(input, /export function CustomFieldInput/);
    assert.match(card, /from "@\/components\/CustomFieldInput"/);
    assert.match(details, /from "@\/components\/CustomFieldInput"/);
  });

  it("Profile Details no longer keeps its own copy", () => {
    assert.doesNotMatch(details, /^function CustomFieldInput/m);
  });

  it("still handles every field type the server allows", () => {
    for (const type of ["boolean", "number", "date", "multiline", "dropdown"]) {
      assert.match(input, new RegExp(`case "${type}":`), type);
    }
  });

  it("a stored dropdown value that is no longer on the list stays selectable", () => {
    // Otherwise editing some other field silently clears it.
    assert.match(input, /value && !\(field\.choices \?\? \[\]\)\.includes\(value\)/);
  });
});
