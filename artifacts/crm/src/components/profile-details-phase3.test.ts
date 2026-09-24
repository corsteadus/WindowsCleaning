// Kyle's Prospect Profile Notes #8 and #14, in ProfileDetailsTab.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(fileURLToPath(new URL("./ProfileDetailsTab.tsx", import.meta.url)), "utf8");
const manager = source.slice(source.indexOf("function CatalogManager("));

test("#14 all four dropdowns can be managed, by people allowed to", () => {
  assert.match(source, /hasClientCapability\(user, "catalogs\.manage"\)/);
  for (const key of ["profileTypes", "profileGroups", "paymentTerms", "marketingSources"]) {
    assert.match(source, new RegExp(`setManaging\\("${key}"\\)`), `${key} has no Manage options`);
  }
});

test("#14 the manager adds and removes through the catalogue API and refreshes every dropdown", () => {
  assert.match(manager, /method: "POST"/);
  assert.match(manager, /method: "DELETE"/);
  assert.match(manager, /invalidateQueries\(\{ queryKey: \["profile-catalogs"\] \}\)/);
});

test("#14 payment terms carry a number of days", () => {
  assert.match(manager, /const withDays = catalog === "paymentTerms"/);
  assert.match(manager, /daysUntilDue: Number\(days\)/);
});

test("#14 the Manage button is not inside the <label>", () => {
  const field = source.slice(source.indexOf("function Field("), source.indexOf("function SelectField("));
  const labelOpen = field.lastIndexOf('<label className="block">');
  assert.ok(field.indexOf("Manage options") < labelOpen, "the button must come before, and outside, the label");
});

test("a DELETE answering 204 is not parsed as JSON", () => {
  assert.match(source, /if \(response\.status === 204\) return undefined as T;/);
});

test("#8 a phone or email can be given to a new person without leaving the form", () => {
  assert.match(source, /<option value=\{NEW_PERSON\}>\+ New person…<\/option>/);
  assert.match(source, /apiFetch<\{ id: number \}>\("\/api\/contacts"/);
  // the person is created first, then the channel is attached to them
  const add = source.slice(source.indexOf("const addChannel = useMutation"), source.indexOf("const updateChannel"));
  assert.ok(add.indexOf('"/api/contacts"') < add.indexOf("/channels`"));
  assert.match(add, /setDraftChannel\(d => \(\{ \.\.\.d, contactId: String\(person\.id\) \}\)\)/, "a retry must not create the person twice");
});

test("saving refreshes the profile under the key it is actually cached by", () => {
  assert.match(source, /authScopedQueryKey\(user, \["customer", String\(customerId\)\]\)/);
  assert.doesNotMatch(source, /invalidateQueries\(\{ queryKey: \["customer", String\(customerId\)\] \}\)/);
});
