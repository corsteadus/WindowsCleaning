// Kyle's Prospect Profile Notes, items #1, #4, #5, #6, #12 and the unblocked
// part of #13. Source-level guards, in the style of the other page tests here:
// they fail if a removed field is put back or the account type drops down the form.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");

const customers = read("Customers.tsx");
const detail = read("CustomerDetail.tsx");
const properties = read("Properties.tsx");

test("#1 the account type is the first thing on the new-account form", () => {
  const form = customers.slice(customers.indexOf("<form onSubmit={handleSubmit(onSubmit)}"));
  const accountType = form.indexOf('aria-label="Account type"');
  const contact = form.indexOf('title="Contact Information"');
  assert.ok(accountType > 0, "account type choice is missing");
  assert.ok(accountType < contact, "account type must come before Contact Information");
  assert.match(form, /type="radio" value=\{value\} \{\.\.\.register\("accountType"\)\}/);
});

test("#4 Customer Since cannot be typed on create or edit", () => {
  assert.doesNotMatch(customers, /register\("customerDate"\)/);
  assert.match(detail, /label="Customer Since"[^\n]*editing=\{false\}/);
});

test("#5 and #6 Preferred Contact and Sending Preferences are gone from both forms", () => {
  for (const source of [customers, detail]) {
    assert.doesNotMatch(source, /register\("preferredContactMethod"\)|name="preferredContactMethod"/);
    assert.doesNotMatch(source, /register\("sendingPreferences"\)|name="sendingPreferences"/);
    assert.doesNotMatch(source, /label="Preferred Contact"|label="Sending Preferences"/);
  }
});

test("#12 no Screens / Hard Water / Tracks checkboxes on either property form", () => {
  assert.doesNotMatch(detail, /key: "hasScreens"|key: "hasHardWater"|key: "hasTracks"/);
  assert.doesNotMatch(properties, /\["hasScreens", "hasHardWater", "hasTracks"/);
});

test("#13 no Type, Windows or Stories inputs on either property form", () => {
  assert.doesNotMatch(detail, /set\("propertyType"|set\("windowCount"|set\("stories"/);
  assert.doesNotMatch(properties, /setField\("propertyType"|setField\("windowCount"|setField\("stories"/);
});

// Kyle answered on 2026-09-23: remove both entirely, form and crew view, so that
// Corstead never invites anyone to store a gate code. Custom fields remain a
// company's own choice.
test("#13 Gate Code and Access Notes are gone from every property screen", () => {
  for (const source of [detail, properties]) {
    // the comments explaining the removal say the words; the code must not
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /gateCode|accessNotes/);
    assert.doesNotMatch(code, /Gate [Cc]ode|Access [Nn]otes/);
  }
});

test("an older property keeps its stored values when edited", () => {
  // The inputs are gone but the values still ride along in the submitted form.
  assert.match(detail, /windowCount: initialProperty\?\.windowCount/);
  assert.match(detail, /hasScreens: initialProperty\?\.hasScreens/);
  assert.match(properties, /stories: draft\.stories \? Number\(draft\.stories\) : null/);
});
