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

test("deleting asks for the profile name to be typed, because it cannot be undone", () => {
  assert.match(source, /Type <span className="font-mono text-slate-900">\{accountName\}<\/span> to confirm/);
  assert.match(source, /disabled=\{deleteConfirmation\.trim\(\) !== accountName \|\| deleteProfile\.isPending\}/);
  assert.match(source, /It cannot be undone\./);
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
