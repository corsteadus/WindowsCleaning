import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  SUB_PROFILE_UNLINK,
  decideMainProfile,
  describeMainProfileChange,
  type MainProfileRequest,
} from "./customer-hierarchy.ts";

const base: MainProfileRequest = {
  customerId: 10,
  requestedParentId: 20,
  parentExists: true,
  parentHasParent: false,
  customerHasChildren: false,
};

test("a profile can be put beneath a main profile", () => {
  assert.deepEqual(decideMainProfile(base), { kind: "link", parentCustomerId: 20 });
});

test("and taken out from under it again", () => {
  assert.deepEqual(decideMainProfile({ ...base, requestedParentId: null }), { kind: "unlink" });
  assert.deepEqual(
    decideMainProfile({ ...base, requestedParentId: undefined as never }),
    { kind: "unlink" },
  );
});

test("a profile cannot sit beneath itself", () => {
  const result = decideMainProfile({ ...base, requestedParentId: 10 });
  assert.equal(result.kind, "error");
  assert.equal(result.kind === "error" && result.status, 400);
  assert.match(result.kind === "error" ? result.message : "", /beneath itself/);
});

test("a main profile that does not exist is a 404, not a silent link", () => {
  const result = decideMainProfile({ ...base, parentExists: false });
  assert.equal(result.kind === "error" && result.status, 404);
});

test("two levels only, from either direction", () => {
  // The one above is already beneath somebody.
  const deep = decideMainProfile({ ...base, parentHasParent: true });
  assert.equal(deep.kind === "error" && deep.status, 409);
  assert.match(deep.kind === "error" ? deep.message : "", /one level/);

  // This profile already has profiles beneath it.
  const alreadyMain = decideMainProfile({ ...base, customerHasChildren: true });
  assert.equal(alreadyMain.kind === "error" && alreadyMain.status, 409);
  assert.match(alreadyMain.kind === "error" ? alreadyMain.message : "", /already has profiles beneath/);
});

test("an archived profile cannot be a main profile", () => {
  const result = decideMainProfile({ ...base, parentIsArchived: true });
  assert.equal(result.kind === "error" && result.status, 409);
});

test("unlinking is always allowed, whatever shape things are in", () => {
  // Even a profile that has children can be taken out from under another, and a
  // profile whose parent has since been archived must be able to leave.
  for (const extra of [
    { customerHasChildren: true },
    { parentIsArchived: true },
    { parentExists: false },
    { parentHasParent: true },
  ]) {
    assert.deepEqual(
      decideMainProfile({ ...base, ...extra, requestedParentId: null }),
      { kind: "unlink" },
      JSON.stringify(extra),
    );
  }
});

test("rubbish ids are refused", () => {
  assert.equal(decideMainProfile({ ...base, customerId: 0 }).kind, "error");
  assert.equal(decideMainProfile({ ...base, requestedParentId: -3 }).kind, "error");
  assert.equal(decideMainProfile({ ...base, requestedParentId: 1.5 }).kind, "error");
});

test("the change reads as a sentence for the history", () => {
  assert.equal(
    describeMainProfileChange({ kind: "link", parentCustomerId: 20 }, { customer: "Acme Unit 4", parent: "Acme Holdings" }),
    "Acme Unit 4 now sits beneath Acme Holdings",
  );
  assert.equal(
    describeMainProfileChange({ kind: "unlink" }, { customer: "Acme Unit 4" }),
    "Acme Unit 4 no longer sits beneath another profile",
  );
});

test("the profiles beneath a deleted one are freed, not deleted", () => {
  // A sub-customer is a separate profile, not a belonging.
  assert.match(SUB_PROFILE_UNLINK, /^UPDATE customers SET parent_customer_id = NULL/);
  assert.match(SUB_PROFILE_UNLINK, /WHERE parent_customer_id = :id$/);
  assert.doesNotMatch(SUB_PROFILE_UNLINK, /DELETE/i);
});

test("linking changes nothing about billing", () => {
  // Kyle: "No 'bill to parent', no combined invoices." If a money file ever
  // starts reading the link, this is where it is noticed.
  const money = [
    "./payment-core.ts",
    "./invoice-create-core.ts",
    "./customer-credit-core.ts",
    "./financial-approval-service.ts",
  ];
  for (const file of money) {
    let source: string;
    try {
      source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    } catch {
      continue; // the file may be named differently; the ones that exist are checked
    }
    assert.doesNotMatch(source, /parentCustomerId|parent_customer_id/, `${file} reads the main-profile link`);
  }
});
