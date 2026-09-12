import assert from "node:assert/strict";
import test from "node:test";
import { assertSeedable, toSeedRow, toSeedRows, type SeedAccount } from "./seed-team-users.ts";
import { verifyPassword } from "./password.ts";

const account = (overrides: Partial<SeedAccount> = {}): SeedAccount => ({
  username: "team_admin",
  password: "Sbx2-Admin!84Cedar",
  role: "super_admin",
  firstName: "Team",
  lastName: "Admin",
  email: "team_admin@example.test",
  ...overrides,
});

test("a seeded account can actually sign in", async () => {
  const row = await toSeedRow(account());
  assert.equal(await verifyPassword("Sbx2-Admin!84Cedar", row.passwordHash), true);
  assert.equal(await verifyPassword("wrong", row.passwordHash), false);
});

test("the plaintext password is never carried into the row", async () => {
  const row = await toSeedRow(account());
  assert.ok(!JSON.stringify(row).includes("Sbx2-Admin!84Cedar"));
  assert.match(row.passwordHash, /^scrypt:16384:8:1:[0-9a-f]{32}:[0-9a-f]{128}$/);
});

test("two accounts with the same password get different hashes", async () => {
  // A shared salt would make one cracked hash crack every account with that
  // password.
  const a = await toSeedRow(account({ username: "one" }));
  const b = await toSeedRow(account({ username: "two" }));
  assert.notEqual(a.passwordHash, b.passwordHash);
});

test("a role the authorization layer does not know is refused", () => {
  assert.throws(
    () => assertSeedable(account({ role: "administrator" as never })),
    /not one of/,
  );
});

test("every real role is seedable", () => {
  for (const role of ["super_admin", "owner", "office_admin", "sales", "field_tech"] as const) {
    assert.doesNotThrow(() => assertSeedable(account({ role })));
  }
});

test("a blank username or a toy password is refused", () => {
  assert.throws(() => assertSeedable(account({ username: "  " })), /no username/);
  assert.throws(() => assertSeedable(account({ password: "short" })), /too short/);
});

test("usernames that differ only in case are refused before the index sees them", async () => {
  // `users_username_lower_unique` is case-insensitive, so these collide.
  await assert.rejects(
    () => toSeedRows([account({ username: "team_admin" }), account({ username: "Team_Admin" })]),
    /Duplicate seed username/,
  );
});

test("seeding the three sandbox accounts produces three distinct rows", async () => {
  const rows = await toSeedRows([
    account(),
    account({ username: "team_office", password: "Sbx2-Office!29River", role: "office_admin" }),
    account({ username: "team_tech", password: "Sbx2-Tech!63Maple", role: "field_tech" }),
  ]);
  assert.deepEqual(rows.map((r) => r.username), ["team_admin", "team_office", "team_tech"]);
  assert.deepEqual(rows.map((r) => r.role), ["super_admin", "office_admin", "field_tech"]);
  assert.equal(new Set(rows.map((r) => r.passwordHash)).size, 3);
  assert.ok(rows.every((r) => r.isActive));
});
