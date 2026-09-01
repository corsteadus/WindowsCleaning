import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  INVOICE_PROPERTIES_V1_CHECKSUM,
  INVOICE_PROPERTIES_V1_ID,
  invoicePropertiesV1Migration,
} from "./invoice-properties-v1.ts";

const source = readFileSync(new URL("./invoice-properties-v1.ts", import.meta.url), "utf8");

test("invoice property migration is required and checksumed", () => {
  assert.equal(INVOICE_PROPERTIES_V1_ID, "invoice-properties-v1");
  assert.equal(invoicePropertiesV1Migration.id, INVOICE_PROPERTIES_V1_ID);
  assert.equal(invoicePropertiesV1Migration.required, true);
  assert.match(INVOICE_PROPERTIES_V1_CHECKSUM, /^[0-9a-f]{64}$/);
});

test("invoice property migration is additive and preserves history", () => {
  assert.match(source, /ADD COLUMN IF NOT EXISTS property_id integer/);
  assert.match(source, /CREATE INDEX IF NOT EXISTS idx_invoices_property_id/);
  assert.match(source, /historicalRowsRewritten: 0/);
  assert.match(source, /Invoice property migration is Sandbox-only/);
});