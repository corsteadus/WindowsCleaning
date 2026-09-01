import assert from "node:assert/strict";
import test from "node:test";
import { canAccessPage, hasClientCapability, requiredPageCapability } from "./rbac.ts";

test("Team Users page requires the team user management capability", () => {
  assert.equal(requiredPageCapability("/team-users"), "team_users.manage");
  assert.equal(requiredPageCapability("/team-users/"), "team_users.manage");
});

test("access is derived only from the server capability envelope", () => {
  const ownerEnvelope = { capabilities: ["team_users.manage", "jobs.view"] };
  const techEnvelope = { capabilities: ["jobs.view", "jobs.manage", "schedule.view"] };
  assert.equal(hasClientCapability(ownerEnvelope, "team_users.manage"), true);
  assert.equal(canAccessPage("/team-users", ownerEnvelope), true);
  assert.equal(hasClientCapability(techEnvelope, "team_users.manage"), false);
  assert.equal(canAccessPage("/team-users", techEnvelope), false);
});

test("unresolved authentication is never treated as Team Users access", () => {
  assert.equal(canAccessPage("/team-users", null), false);
  assert.equal(canAccessPage("/team-users", undefined), false);
});

test("jobs/new has a stricter direct-entry guard than assigned job viewing", () => {
  const techEnvelope = { capabilities: ["jobs.view", "jobs.manage", "schedule.view"] };
  assert.equal(canAccessPage("/jobs", techEnvelope), true);
  assert.equal(requiredPageCapability("/jobs/new"), "schedule.manage");
  assert.equal(canAccessPage("/jobs/new", techEnvelope), false);
});

test("Prospect routes preserve the existing lead capability boundary", () => {
  assert.equal(requiredPageCapability("/prospects"), "leads.view");
  assert.equal(requiredPageCapability("/prospects/42"), "leads.view");
  assert.equal(canAccessPage("/prospects/42", { capabilities: ["leads.view"] }), true);
  assert.equal(canAccessPage("/prospects/42", { capabilities: ["jobs.view"] }), false);
});