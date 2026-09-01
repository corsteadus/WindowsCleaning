import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./CustomerDetail.tsx", import.meta.url), "utf8");

test("customer detail exposes contacts alongside properties", () => {
  assert.match(source, /id: "contacts",\s+label: "Contacts"/);
  assert.match(source, /activeTab === "contacts"/);
  assert.match(source, /contacts: Contact\[\]/);
});

test("customer detail relation controls use recoverable archive flows", () => {
  assert.match(source, /\/api\/contacts\/\$\{id\}\/\$\{action\}/);
  assert.match(source, /action: "primary" \| "archive" \| "restore"/);
  assert.match(source, /action: archived \? "restore" : "archive"/);
  assert.match(source, /useRestoreProperty/);
  assert.match(source, /restoreProp\.mutate/);
  assert.match(source, /Show archived/);
  assert.match(source, /Set primary/);
});

test("business account display names remain separate from primary contact names", () => {
  assert.match(source, /const accountName = customer\.companyName\?\.trim\(\) \|\| fullName/);
  assert.match(source, /Primary contact: \{fullName\}/);
});

test("customer detail can link and unlink shared properties without editing owner fields", () => {
  assert.match(source, /useLinkPropertyAccount/);
  assert.match(source, /shareProp\.mutate/);
  assert.match(source, /relationshipType: shareRelationshipType/);
  assert.match(source, /useUnlinkPropertyAccount/);
  assert.match(source, /unlinkProp\.mutate/);
  assert.match(source, /const isOwner = p\.isOwner !== false/);
  assert.match(source, /!isOwner && \(/);
});