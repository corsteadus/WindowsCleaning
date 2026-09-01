import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./profile-details-catalogs-v1.ts", import.meta.url), "utf8");

test("profile migration is additive and snapshot-safe", () => {
  assert.match(source, /ALTER TABLE properties[\s\S]*ADD COLUMN IF NOT EXISTS county/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS contact_channels/);
  assert.match(source, /purpose IN \('general', 'billing', 'estimates'\)/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS profile_catalog_items/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS custom_field_definitions/);
  assert.doesNotMatch(source, /UPDATE\s+(quotes|jobs|quote_line_items)/i);
  assert.doesNotMatch(source, /INSERT INTO profile_catalog_items/i);
});

test("profile migration implements the complete safety lifecycle", () => {
  for (const stage of ["preflight", "backup", "apply", "postflight", "verify", "rollback"]) {
    assert.match(source, new RegExp(`\\b${stage}\\b`));
  }
  assert.match(source, /application_migration_backups/);
});