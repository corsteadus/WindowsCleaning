/**
 * Kyle (2026-09-23, answer #5), as guards: *"Linking only … No 'bill to
 * parent', no combined invoices — linking changes nothing about billing."*
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const detail = read("./CustomerDetail.tsx");
const card = read("../components/MainProfileCard.tsx");
const route = read("../../../api-server/src/routes/customers.ts");
const rules = read("../../../api-server/src/lib/customer-hierarchy.ts");

test("the profile shows what it is linked to, both ways", () => {
  assert.match(detail, /<MainProfileCard/);
  assert.match(detail, /mainProfile=\{customer\.mainProfile \?\? null\}/);
  assert.match(detail, /subProfiles=\{customer\.subProfiles \?\? \[\]\}/);
  // The server sends both with the profile, so the card needs no request of its own.
  assert.match(route, /mainProfile: mainProfileRow\[0\] \? asProfileLink\(mainProfileRow\[0\]\) : null/);
  assert.match(route, /subProfiles: subProfiles\.map\(asProfileLink\)/);
});

test("linking changes nothing about billing, and the card says so", () => {
  assert.match(card, /does not change billing/i);
  // No totals, balances or money of any kind on this card — a number here would
  // be the first step towards the combined billing he ruled out.
  assert.doesNotMatch(card, /formatCurrency|balanceDue|totalAmount|outstanding/i);
});

test("only somebody who may manage the profile can change the link", () => {
  assert.match(detail, /canManage=\{canManageCustomer\}/);
  assert.match(card, /canManage && \(/);
});

test("the rules live in one place, and the route uses them", () => {
  assert.match(route, /decideMainProfile\(\{/);
  assert.match(route, /res\.status\(result\.decision\.status\)\.json\(\{ error: result\.decision\.message \}\)/);
  // Two levels, from either direction.
  assert.match(rules, /parentHasParent/);
  assert.match(rules, /customerHasChildren/);
  assert.match(rules, /beneath itself/);
});

test("a main profile is not offered one of its own", () => {
  assert.match(card, /const isMainProfile = subProfiles\.length > 0;/);
  // The sentence wraps in the source, so match across the break.
  assert.match(card, /keeps this to one\s+level/);
});

test("erasing a main profile frees the profiles beneath it", () => {
  const purge = read("../../../api-server/src/lib/customer-purge.ts");
  assert.match(purge, /SUB_PROFILE_UNLINK/);
  // It runs before the deletes, like the lead unlink beside it.
  assert.match(purge, /withId\(LEAD_UNLINK, customerId\),[\s\S]{0,200}withId\(SUB_PROFILE_UNLINK, customerId\)/);
});
