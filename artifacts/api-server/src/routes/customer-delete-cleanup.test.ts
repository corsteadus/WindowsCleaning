// DELETE /customers/:id erases the profile and everything attached to it
// (Kyle, 2026-09-23 #3). This guards the route's own rules; the table order it
// runs lives in lib/customer-purge.ts and is tested there.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(fileURLToPath(new URL("./customers.ts", import.meta.url)), "utf8");
const route = source.slice(
  source.indexOf('router.delete(["/customers/:id", "/prospects/:id"]'),
  source.indexOf("// ─── Helpers"),
);

test("work on file no longer blocks the delete", () => {
  assert.doesNotMatch(route, /customer_has_history/);
  assert.doesNotMatch(source, /customer_has_history/);
});

test("an unconfirmed request is refused, so a stray DELETE cannot erase a profile", () => {
  assert.match(route, /req\.query\.confirm \?\? ""\) !== "delete-everything"/);
  assert.match(route, /code: "confirmation_required"/);
  assert.ok(route.indexOf("confirmation_required") < route.indexOf("db.transaction"));
});

test("the row is locked before anything is deleted", () => {
  assert.match(route, /\.where\(target\)\.for\("update"\)/);
  assert.ok(route.indexOf('for("update")') < route.indexOf("purgeStatements("));
});

test("a missed table rolls the whole thing back", () => {
  assert.match(route, /remainingReferenceQuery\(id\)/);
  assert.match(route, /throw new Error\(`Profile \$\{id\} still has rows in/);
  assert.ok(route.indexOf("remainingReferenceQuery") < route.indexOf("activityLogsTable"));
});

test("the deletion is recorded after the profile's own history is erased", () => {
  assert.match(route, /action: "customer_deleted"/);
  assert.ok(
    route.indexOf("purgeStatements(") < route.indexOf('action: "customer_deleted"'),
    "the audit row must be written after the purge, or it would be deleted with everything else",
  );
  assert.match(route, /deleted permanently, with \$\{summary\}/);
});

test("the caller is told what was erased", () => {
  assert.match(route, /res\.json\(\{ deleted: true, name: outcome\.name, erased: outcome\.erased \}\)/);
  assert.match(route, /\["jobs", jobsTable\][\s\S]*\["estimates", quotesTable\][\s\S]*\["invoices", invoicesTable\][\s\S]*\["payments", paymentsTable\]/);
});

test("a profile that is not there is still a 404", () => {
  assert.match(route, /kind: "notFound"/);
  assert.match(route, /res\.status\(404\)\.json\(\{ error: "Customer not found" \}\)/);
});
