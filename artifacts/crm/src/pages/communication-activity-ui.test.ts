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

// A6 (Kyle, Video 8): what was sent is in one communication history, once each; the
// profile's own activity follows it, without the "email sent" lines that repeated it.
test("#5 it holds both the messages and the profile changes", () => {
  assert.match(source, /<CommunicationHistory\s/);
  assert.match(source, /logs=\{customer\.activityLogs \?\? \[\]\}/);
});

test("#5 the filters: all, emails, texts (and since A6 letters); profile changes shown on their own", () => {
  const history = readFileSync(fileURLToPath(new URL("../lib/communication-history.ts", import.meta.url)), "utf8");
  const filters = history.slice(history.indexOf("export const FILTERS"), history.indexOf("];", history.indexOf("export const FILTERS")));
  for (const label of ["All", "Emails", "Texts", "Letters"]) {
    assert.ok(filters.includes(`label: "${label}"`), `${label} is missing`);
  }
  assert.match(source, />Profile activity<\/p>/);
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
