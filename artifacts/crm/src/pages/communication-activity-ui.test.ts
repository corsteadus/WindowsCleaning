// Random Edits #3, #5 and #6: one Communication & Activity tab, and the
// Overview saying who wrote the last note and who touched the profile.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(fileURLToPath(new URL("./CustomerDetail.tsx", import.meta.url)), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

test("#5 there is one tab, not two", () => {
  assert.match(source, /\{ id: "activity", +label: "Communication & Activity"/);
  assert.doesNotMatch(code, /label: "Communications"/);
  assert.doesNotMatch(code, /activeTab === "communications"/);
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

test("#6 the Overview says who created the profile and who touched it last", () => {
  assert.match(source, /Created by/);
  assert.match(source, /Last updated by/);
  assert.match(source, /profileStewardship\(\(customer\.activityLogs \?\? \[\]\) as never/);
});

test("#3 General Notes sit on the Overview, with who and when", () => {
  const overview = source.slice(source.indexOf("function OverviewTab("));
  assert.match(overview, /<Section title="General Notes"/);
  assert.match(overview, /Last updated by \$\{noteChange\.performedBy/);
  assert.match(overview, /Job, estimate and location notes are kept with their own records\./);
});

test("#3 the note is editable in place, through the profile's own form", () => {
  const overview = source.slice(source.indexOf("function OverviewTab("));
  assert.match(overview, /\{\.\.\.form\.register\("notes"\)\}/);
});
