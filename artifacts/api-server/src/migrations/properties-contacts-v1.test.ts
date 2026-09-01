import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PROPERTIES_CONTACTS_V1_CHECKSUM,
  PROPERTIES_CONTACTS_V1_ID,
  propertiesContactsV1Migration,
} from "./properties-contacts-v1.ts";

const source = readFileSync(new URL("./properties-contacts-v1.ts", import.meta.url), "utf8");

test("properties and contacts migration is guarded and required", () => {
  assert.equal(PROPERTIES_CONTACTS_V1_ID, "properties-contacts-v1");
  assert.equal(propertiesContactsV1Migration.id, PROPERTIES_CONTACTS_V1_ID);
  assert.equal(propertiesContactsV1Migration.required, true);
  assert.match(PROPERTIES_CONTACTS_V1_CHECKSUM, /^[0-9a-f]{64}$/);
});

test("properties and contacts migration preserves recoverable provenance", () => {
  assert.match(source, /application_migration_backups/);
  assert.match(source, /customer:/);
  assert.match(source, /contact:/);
  assert.match(source, /property:/);
  assert.match(source, /relationship:/);
  assert.match(source, /migration_source = \$1/);
  assert.match(source, /ON CONFLICT \(migration_id, backup_key\) DO NOTHING/);
});

test("backfill never address-merges accounts and creates owner relationships", () => {
  assert.match(source, /NOT EXISTS \(\s*SELECT 1 FROM properties/);
  assert.match(source, /INSERT INTO property_account_relationships/);
  assert.match(source, /relationship_type, is_primary, migration_source/);
  assert.match(source, /default_property_id IS NULL/);
  assert.match(source, /without address-based merging/);
});

test("rollback is scoped to migration-created rows", () => {
  assert.match(source, /DELETE FROM property_account_relationships\s+WHERE migration_source = \$1/);
  assert.match(source, /DELETE FROM properties\s+WHERE migration_source = \$1/);
  assert.match(source, /DELETE FROM contacts\s+WHERE migration_source = \$1/);
});