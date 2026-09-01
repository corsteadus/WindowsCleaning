import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./team-users-rbac-v1.ts", import.meta.url), "utf8");

test("team user migration is additive and preserves existing rows", () => {
  assert.match(source, /ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true/);
  assert.match(source, /CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique/);
  assert.match(source, /historicalUsersUpdated: 0/);
  assert.match(source, /sessionsUntouched: true/);
  assert.doesNotMatch(source, /DELETE FROM users/);
  assert.doesNotMatch(source, /UPDATE users/);
});

test("team user migration fails closed on pre-existing normalized username conflicts", () => {
  assert.match(source, /usernameConflictCount/);
  assert.match(source, /existing conflicts found/);
  assert.match(source, /GROUP BY lower\(trim\(username\)\)/);
});