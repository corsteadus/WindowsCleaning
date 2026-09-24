// None of the tables that belong to a customer carry a foreign key to it, so
// DELETE /customers/:id has to clear each one itself. This guards the list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(fileURLToPath(new URL("./customers.ts", import.meta.url)), "utf8");
const route = source.slice(
  source.indexOf('router.delete(["/customers/:id", "/prospects/:id"]'),
  source.indexOf("// ─── Helpers"),
);
const finalDelete = route.indexOf("tx.delete(customersTable)");

test("a customer with work on file is refused rather than deleted", () => {
  for (const table of ["jobsTable", "quotesTable", "invoicesTable", "paymentsTable"]) {
    assert.match(route, new RegExp(`\\["\\w+", ${table}\\]`), `${table} must block the delete`);
  }
  assert.match(route, /code: "customer_has_history"/);
});

test("everything that only describes the customer goes before the customer does", () => {
  for (const table of [
    "contactChannelPurposesTable",
    "contactChannelsTable",
    "customFieldValuesTable",
    "accountProfileSettingsTable",
    "propertyAccountRelationshipsTable",
    "propertiesTable",
    "contactsTable",
  ]) {
    const at = route.indexOf(`tx.delete(${table})`);
    assert.ok(at > 0, `${table} is not cleared`);
    assert.ok(at < finalDelete, `${table} must be cleared before the customer row`);
  }
});

test("channel purposes are cleared before the channels they hang off", () => {
  assert.ok(route.indexOf("tx.delete(contactChannelPurposesTable)") < route.indexOf("tx.delete(contactChannelsTable)"));
});
