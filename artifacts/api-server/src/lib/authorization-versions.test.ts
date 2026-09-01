import assert from "node:assert/strict";
import test from "node:test";
import { deriveAuthorizationVersions } from "./authorization-versions.ts";

test("authorization versions are stable and change with permissions or assignment graph", () => {
  const graph = [{ id: 1, customerId: 2, propertyId: 3, lineItems: "[]", updatedAt: "2026-01-01T00:00:00.000Z" }];
  const first = deriveAuthorizationVersions("tech-a", "team_tech", graph);
  const same = deriveAuthorizationVersions("tech-a", "field_tech", graph);
  assert.equal(first.permissionVersion, same.permissionVersion);
  assert.equal(first.assignmentScopeVersion, same.assignmentScopeVersion);

  const reassigned = deriveAuthorizationVersions("tech-a", "field_tech", []);
  assert.notEqual(first.assignmentScopeVersion, reassigned.assignmentScopeVersion);

  const promoted = deriveAuthorizationVersions("tech-a", "office_admin", graph);
  assert.notEqual(first.permissionVersion, promoted.permissionVersion);
});