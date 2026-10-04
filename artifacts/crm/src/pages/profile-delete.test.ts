// Profile Notes #20, as Kyle answered it on 2026-09-23: a profile deletes
// permanently with everything on it, and single jobs and estimates delete from
// their own sections.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(fileURLToPath(new URL("./CustomerDetail.tsx", import.meta.url)), "utf8");

test("the profile carries a Delete button, for people who may manage customers", () => {
  assert.match(source, /\{!isEditing && canManageCustomer && \([\s\S]{0,400}Delete/);
});

// Kyle (Testing Edits, 2026-10-01, #6) asked for the typed name to go: one plain
// question and two buttons, keeping the warning about what else is erased.
test("deleting asks once, plainly, and does not make you type the name", () => {
  assert.match(source, /Are you sure you want to permanently delete this profile\?/);
  assert.match(source, /It cannot be undone\./);
  assert.doesNotMatch(source, /deleteConfirmation/,
    "the typed-name confirmation was removed at the client's request");
  assert.match(source, /disabled=\{deleteProfile\.isPending\}/,
    "the only thing that disables Delete now is the request being in flight");
});

test("the dialog offers exactly two ways out", () => {
  const dialog = source.slice(source.indexOf("Delete {accountName}?"), source.indexOf("</Dialog>", source.indexOf("Delete {accountName}?")));
  const buttons = [...dialog.matchAll(/<button\b/g)].length;
  assert.equal(buttons, 2, `the dialog should offer Cancel and Delete only, found ${buttons} buttons`);
  assert.match(dialog, /Cancel/);
  assert.match(dialog, /Delete permanently/);
});

test("the dialog says what will be erased", () => {
  for (const line of ["customer.jobs.length", "(customer.quotes ?? []).length", "(customer.invoices ?? []).length", "activeProperties.length"]) {
    assert.ok(source.includes(line), `${line} is not counted in the dialog`);
  }
});

test("the request carries the confirmation the server insists on", () => {
  assert.match(source, /\$\{apiBase\}\/\$\{id\}\?confirm=delete-everything`, \{ method: "DELETE" \}/);
});

test("after deleting, the page leaves rather than showing a profile that is gone", () => {
  assert.match(source, /navigate\(isProspectRoute \? "\/prospects" : "\/customers"\)/);
});

test("a single job or estimate deletes from its own section", () => {
  assert.match(source, /protectedFetch\(`\/api\/\$\{kind\}\/\$\{recordId\}`, \{ method: "DELETE" \}\)/);
  assert.match(source, /aria-label=\{`Delete job \$\{j\.jobNumber\}`\}/);
  assert.match(source, /aria-label=\{`Delete estimate \$\{q\.quoteNumber\}`\}/);
  assert.match(source, /window\.confirm\(`Delete \$\{label\}\? This cannot be undone\.`\)/);
});

test("those buttons do not open the record they sit on", () => {
  const rows = source.match(/onClick=\{\(event\) => \{ event\.preventDefault\(\); event\.stopPropagation\(\); onDelete\(/g) ?? [];
  assert.equal(rows.length, 2, "both the job and the estimate button must stop the link");
});

test("the delete controls are hidden without customers.manage", () => {
  assert.match(source, /onDelete=\{canManageCustomer \? confirmDeleteRecord : undefined\}/);
  assert.equal((source.match(/onDelete=\{canManageCustomer \? confirmDeleteRecord : undefined\}/g) ?? []).length, 2);
});
