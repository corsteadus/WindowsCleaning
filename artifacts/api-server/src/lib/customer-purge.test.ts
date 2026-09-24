import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CUSTOMER_PURGE_ORDER,
  purgeStatements,
  remainingReferenceQuery,
  REMAINING_REFERENCE_CHECKS,
} from "./customer-purge.ts";

const order = CUSTOMER_PURGE_ORDER.map((step) => step.table);
const positionOf = (table: string) => order.indexOf(table);

test("the profile itself is deleted last", () => {
  assert.equal(order.at(-1), "customers");
});

test("children are deleted before the rows they point at", () => {
  const pairs: Array<[string, string]> = [
    ["payment_allocations", "payments"],
    ["payment_allocations", "invoices"],
    ["invoice_credit_lines", "invoice_credit_notes"],
    ["invoice_credit_notes", "invoices"],
    ["invoice_lines", "invoices"],
    ["invoice_jobs", "invoices"],
    ["invoice_jobs", "jobs"],
    ["invoices", "jobs"],
    ["schedule_entries", "jobs"],
    ["quote_line_items", "quotes"],
    ["estimate_revisions", "quotes"],
    ["estimate_public_links", "quotes"],
    ["contact_channel_purposes", "contact_channels"],
    ["property_account_relationships", "properties"],
  ];
  for (const [child, parent] of pairs) {
    assert.ok(positionOf(child) >= 0, `${child} is not in the order`);
    assert.ok(positionOf(parent) >= 0, `${parent} is not in the order`);
    assert.ok(positionOf(child) < positionOf(parent), `${child} must be deleted before ${parent}`);
  }
});

test("no table is deleted twice", () => {
  assert.equal(new Set(order).size, order.length);
});

// The real risk is a table nobody remembered. Every schema file that carries a
// customer_id must be named in the order, or be excused here by name.
test("every table with a customer_id is accounted for", () => {
  const schemaDir = fileURLToPath(new URL("../../../../lib/db/src/schema/", import.meta.url));
  const withCustomerId = new Set<string>();
  for (const file of readdirSync(schemaDir).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(schemaDir + file, "utf8");
    for (const match of source.matchAll(/pgTable\("([a-z_]+)"([\s\S]*?)\n\}/g)) {
      if (/\("customer_id"/.test(match[2])) withCustomerId.add(match[1]);
    }
  }
  const excused = new Set([
    // its own foreign key sets these to null or cascades on delete
    "communication_safety_decisions",
    "communication_safety_overrides",
    // migration bookkeeping, not customer data
    "application_migrations",
  ]);
  for (const table of withCustomerId) {
    if (excused.has(table)) continue;
    assert.ok(order.includes(table), `${table} has a customer_id but is not in CUSTOMER_PURGE_ORDER`);
  }
});

test("history keyed by entity, not by customer, is erased too", () => {
  for (const table of ["activity_logs", "attachments", "email_logs", "communication_events"]) {
    const step = CUSTOMER_PURGE_ORDER.find((candidate) => candidate.table === table);
    assert.ok(step, `${table} is not purged`);
    assert.match(step.where, /'customer'/);
    assert.match(step.where, /FROM jobs WHERE customer_id/);
    assert.match(step.where, /FROM quotes WHERE customer_id/);
    assert.match(step.where, /FROM invoices WHERE customer_id/);
  }
});

test("a converted lead is unlinked, not deleted", () => {
  const statements = purgeStatements(7);
  assert.match(statements[0], /^UPDATE leads SET converted_customer_id = NULL WHERE converted_customer_id = 7$/);
  assert.ok(!statements.some((statement) => /DELETE FROM leads\b/.test(statement)));
});

test("the customer id is substituted everywhere, and only integers are accepted", () => {
  for (const statement of purgeStatements(42)) {
    assert.ok(!statement.includes(":id"), statement);
    assert.match(statement, /\b42\b/);
  }
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => purgeStatements(bad as number), /positive integer/);
  }
});

test("the safety net counts what is left in the tables that matter", () => {
  const query = remainingReferenceQuery(9);
  assert.equal((query.match(/UNION ALL/g) ?? []).length, REMAINING_REFERENCE_CHECKS.length - 1);
  for (const check of REMAINING_REFERENCE_CHECKS) {
    assert.ok(query.includes(`'${check.table}' AS table_name`), `${check.table} is not checked`);
    assert.ok(order.includes(check.table), `${check.table} is checked but never purged`);
  }
});

test("the delete route uses this order rather than its own", () => {
  const route = readFileSync(fileURLToPath(new URL("../routes/customers.ts", import.meta.url)), "utf8");
  const deleteRoute = route.slice(route.indexOf('router.delete(["/customers/:id"'), route.indexOf("// ─── Helpers"));
  assert.match(deleteRoute, /purgeStatements\(/);
  assert.match(deleteRoute, /remainingReferenceQuery\(/);
});
