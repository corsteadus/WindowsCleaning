// Random Edits #3, #5 and #6: one Communication & Activity tab, and the
// Overview saying who wrote the last note and who touched the profile.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(fileURLToPath(new URL("./CustomerDetail.tsx", import.meta.url)), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
// Since the 2026-10-21 redesign the Overview is the profile page, ProfileSheet.
const sheet = readFileSync(fileURLToPath(new URL("../components/ProfileSheet.tsx", import.meta.url)), "utf8");

test("#5 there is one tab, not two", () => {
  assert.match(source, /\{ id: "activity", +label: "Communication & Activity"/);
  assert.doesNotMatch(code, /label: "Communications"/);
  assert.doesNotMatch(code, /activeView === "communications"/);
});

test("#5 it holds both the messages and the profile changes", () => {
  assert.match(source, /<CommunicationActivityTab[\s\S]{0,160}messages=\{customer\.messages\}/);
  assert.match(source, /logs=\{customer\.activityLogs \?\? \[\]\}/);
});

test("#5 the four filters Kyle named are the ones offered", () => {
  const chips = source.slice(source.indexOf("const chips:"), source.indexOf("];", source.indexOf("const chips:")));
  for (const label of ["All activity", "Email", "Text", "Profile changes"]) {
    assert.ok(chips.includes(label), `${label} is missing`);
  }
});

test("#5 an item links to the estimate, job or invoice it belongs to", () => {
  assert.match(source, /item\.related\.type === "quote" \? "quotes" : item\.related\.type === "invoice" \? "invoices" : "jobs"/);
});

test("#6 history cannot be edited from the tab, and says so", () => {
  assert.match(source, /History is recorded automatically and cannot be edited here\./);
  const tab = source.slice(source.indexOf("function CommunicationActivityTab("), source.indexOf("function ", source.indexOf("function CommunicationActivityTab(") + 20));
  assert.doesNotMatch(tab, /method: "DELETE"|method: "PATCH"/);
});

test("#6 the profile says who created it and who touched it last", () => {
  assert.match(sheet, /Created by/);
  assert.match(sheet, /Last updated by/);
  assert.match(sheet, /profileStewardship\(\(customer\.activityLogs \?\? \[\]\) as never/);
});

test("#3 General Notes sit on the profile page, with who and when", () => {
  assert.match(sheet, /<Area label="General notes"/);
  assert.match(sheet, /Last changed by \$\{noteChange\.performedBy/);
  assert.match(sheet, /Job, estimate and location notes are kept with their own records\./);
});

test("#3 the note is editable in place, saved by the page's one Update", () => {
  assert.match(sheet, /value=\{draft\.account\.notes\} onChange=\{\(v\) => setAccount\("notes", v\)\}/);
});
