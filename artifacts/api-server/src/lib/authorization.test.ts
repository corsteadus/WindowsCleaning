import assert from "node:assert/strict";
import test from "node:test";
import {
  canCreateCustomerWithInitialJob,
  canViewBusinessReporting,
  authorizeApiRequest,
  getRoleCapabilities,
  hasCapability,
  isAppendOnlyJobNotesRole,
  isAssignmentScopedOperationalRole,
  isFieldTechJobStatusTransitionAllowed,
  isKnownAuthorizationRole,
  requiredCapabilityForJobMutation,
  requiredCapabilityForRequest,
  setAuthenticatedApiCacheHeaders,
  TEAM_USER_ROLES,
} from "./authorization.ts";

test("the v1 role matrix contains every intended team role", () => {
  assert.deepEqual(TEAM_USER_ROLES, [
    "super_admin",
    "owner",
    "office_admin",
    "sales",
    "field_tech",
  ]);
});

test("super_admin has full capability access", () => {
  assert.equal(hasCapability("super_admin", "admin.purge"), true);
  assert.equal(hasCapability("super_admin", "team_users.manage"), true);
  assert.equal(hasCapability("super_admin", "approvals.manage"), true);
  assert.equal(hasCapability("super_admin", "services.manage"), true);
});

test("owner has business and team-user access but not destructive admin utilities", () => {
  assert.equal(hasCapability("owner", "customers.manage"), true);
  assert.equal(hasCapability("owner", "team_users.manage"), true);
  assert.equal(hasCapability("owner", "admin.purge"), false);
  assert.equal(hasCapability("owner", "admin.import"), false);
});

test("office_admin has normal operations but not team users, automation admin, or policy admin", () => {
  assert.equal(hasCapability("office_admin", "invoices.manage"), true);
  assert.equal(hasCapability("office_admin", "payments.record"), true);
  assert.equal(hasCapability("office_admin", "communication.send"), true);
  assert.equal(hasCapability("office_admin", "campaigns.manage"), true);
  assert.equal(hasCapability("office_admin", "team_users.manage"), false);
  assert.equal(hasCapability("office_admin", "automation.manage"), false);
  assert.equal(hasCapability("office_admin", "approvals.manage"), false);
  assert.equal(hasCapability("office_admin", "services.manage"), true);
});

test("team_office is a narrow compatibility alias for office_admin", () => {
  assert.deepEqual(getRoleCapabilities("team_office"), getRoleCapabilities("office_admin"));
  assert.equal(hasCapability("team_office", "payments.record"), true);
  assert.equal(hasCapability("team_office", "team_users.manage"), false);
  assert.equal(hasCapability("field_tech", "payments.record"), false);
});

test("sales is limited to sales workflow and related job visibility", () => {
  assert.equal(hasCapability("sales", "customers.manage"), true);
  assert.equal(hasCapability("sales", "leads.convert"), true);
  assert.equal(hasCapability("sales", "quotes.manage"), true);
  assert.equal(hasCapability("sales", "jobs.view"), true);
  assert.equal(hasCapability("sales", "schedule.view"), true);
  assert.equal(hasCapability("sales", "invoices.view"), false);
  assert.equal(hasCapability("sales", "payments.record"), false);
  assert.equal(hasCapability("sales", "campaigns.manage"), false);
  assert.equal(hasCapability("sales", "settings.view"), false);
});

test("field_tech is limited to field operations and customer/property contact details", () => {
  assert.equal(hasCapability("field_tech", "jobs.manage"), true);
  assert.equal(hasCapability("field_tech", "schedule.view"), true);
  assert.equal(hasCapability("field_tech", "tasks.manage"), false);
  assert.equal(hasCapability("field_tech", "customers.view"), true);
  assert.equal(hasCapability("field_tech", "properties.view"), true);
  assert.equal(hasCapability("field_tech", "leads.view"), false);
  assert.equal(hasCapability("field_tech", "quotes.view"), false);
  assert.equal(hasCapability("field_tech", "estimates.finalize"), false);
  assert.equal(hasCapability("field_tech", "invoices.view"), false);
  assert.equal(hasCapability("field_tech", "team_users.manage"), false);
  assert.equal(hasCapability("field_tech", "services.view"), false);
  assert.equal(hasCapability("field_tech", "services.manage"), false);
});

test("team_tech is narrowly normalized to field_tech", () => {
  assert.deepEqual(getRoleCapabilities("team_tech"), getRoleCapabilities("field_tech"));
  assert.equal(hasCapability("team_tech", "jobs.manage"), true);
  assert.equal(hasCapability("team_tech", "customers.manage"), false);
  assert.equal(hasCapability("team_tech", "quotes.view"), false);
});

test("legacy admin remains compatible while employee is a least-privilege field compatibility role", () => {
  assert.equal(getRoleCapabilities("admin").length > 0, true);
  assert.equal(hasCapability("admin", "customers.manage"), true);
  assert.equal(hasCapability("employee", "jobs.manage"), true);
  assert.deepEqual(getRoleCapabilities("employee"), getRoleCapabilities("field_tech"));
  for (const capability of [
    "dashboard.view",
    "quotes.view",
    "estimates.schedule",
    "estimates.finalize",
    "tasks.view",
    "tasks.manage",
  ] as const) {
    assert.equal(hasCapability("employee", capability), false);
  }
  assert.equal(hasCapability("admin", "team_users.manage"), false);
  assert.equal(hasCapability("employee", "team_users.manage"), false);
});

test("unknown roles fail closed before route dispatch", () => {
  assert.equal(isKnownAuthorizationRole("mystery_role"), false);
  let advanced = 0;
  let status = 0;
  authorizeApiRequest({
    method: "GET",
    path: "/unclassified-route",
    user: { role: "mystery_role" },
  } as any, {
    status(value: number) {
      status = value;
      return { json() {} };
    },
  } as any, () => { advanced += 1; });
  assert.equal(status, 403);
  assert.equal(advanced, 0);
});

test("authenticated API responses are private and non-cacheable", () => {
  const headers = new Map<string, string>();
  const vary: string[] = [];
  let advanced = 0;
  setAuthenticatedApiCacheHeaders({ user: { role: "field_tech" } } as any, {
    setHeader(name: string, value: string) { headers.set(name, value); },
    vary(value: string) { vary.push(value); },
  } as any, () => { advanced += 1; });
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  assert.equal(headers.get("Pragma"), "no-cache");
  assert.deepEqual(vary, ["Cookie", "Authorization"]);
  assert.equal(advanced, 1);
});

test("unauthenticated public API responses keep their route cache policy", () => {
  let headerWrites = 0;
  let advanced = 0;
  setAuthenticatedApiCacheHeaders({} as any, {
    setHeader() { headerWrites += 1; },
    vary() { headerWrites += 1; },
  } as any, () => { advanced += 1; });
  assert.equal(headerWrites, 0);
  assert.equal(advanced, 1);
});

test("route actions resolve to capability guards, with specific safety routes first", () => {
  assert.equal(requiredCapabilityForRequest("GET", "/customers"), "customers.view");
  assert.equal(requiredCapabilityForRequest("POST", "/customers"), "customers.manage");
  assert.equal(requiredCapabilityForRequest("POST", "/customers/with-initial-job"), "schedule.manage");
  assert.equal(requiredCapabilityForRequest("GET", "/prospects"), "leads.view");
  assert.equal(requiredCapabilityForRequest("POST", "/prospects"), "leads.manage");
  assert.equal(requiredCapabilityForRequest("PATCH", "/prospects/1"), "leads.manage");
  assert.equal(requiredCapabilityForRequest("POST", "/prospects/1/status"), "leads.convert");
  assert.equal(requiredCapabilityForRequest("GET", "/customers/1/communication-safety"), "communication.view");
  assert.equal(requiredCapabilityForRequest("POST", "/payments"), "payments.record");
  assert.equal(requiredCapabilityForRequest("GET", "/payments"), "payments.view");
  assert.equal(requiredCapabilityForRequest("POST", "/admin/users"), "team_users.manage");
  assert.equal(requiredCapabilityForRequest("GET", "/team-users/active"), "schedule.manage");
  assert.equal(requiredCapabilityForRequest("PATCH", "/admin/users/1"), "team_users.manage");
  assert.equal(requiredCapabilityForRequest("POST", "/admin/purge"), "admin.settings");
  assert.equal(requiredCapabilityForRequest("GET", "/catalogs/counties"), "catalogs.view");
  assert.equal(requiredCapabilityForRequest("POST", "/catalogs/counties"), "catalogs.manage");
  assert.equal(requiredCapabilityForRequest("GET", "/custom-fields/definitions"), "custom_fields.view");
  assert.equal(requiredCapabilityForRequest("PATCH", "/custom-fields/definitions/1"), "custom_fields.manage");
  assert.equal(requiredCapabilityForRequest("PATCH", "/contact-channels/1"), "contacts.manage");
  assert.equal(requiredCapabilityForRequest("POST", "/jobs"), "schedule.manage");
  assert.equal(requiredCapabilityForRequest("DELETE", "/jobs/1"), "jobs.manage");
  assert.equal(requiredCapabilityForRequest("POST", "/jobs/1/generate-invoice"), "invoices.manage");
  assert.equal(requiredCapabilityForRequest("POST", "/attachments", { entityType: "job" }), "jobs.manage");
  assert.equal(requiredCapabilityForRequest("POST", "/services"), "services.manage");
});

test("job action authorization preserves field work while blocking scheduling and commercial mutations", () => {
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/1", { status: "in_progress" }), "jobs.manage");
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/1", { status: "completed", techNotes: "Done" }), "jobs.manage");
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/1", { notes: "Gate code updated" }), "jobs.manage");
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/1", { scheduledDate: "2026-05-01" }), "schedule.manage");
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/1", { crewId: 2 }), "schedule.manage");
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/1", { status: "canceled" }), "schedule.manage");
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/1", { status: "scheduled" }), "schedule.manage");
});

test("field tech job transitions permit start/complete but never reopen", () => {
  assert.equal(isFieldTechJobStatusTransitionAllowed("scheduled", "in_progress"), true);
  assert.equal(isFieldTechJobStatusTransitionAllowed("in_progress", "completed"), true);
  assert.equal(isFieldTechJobStatusTransitionAllowed("completed", "in_progress"), false);
  assert.equal(isFieldTechJobStatusTransitionAllowed("completed", "scheduled"), false);
  assert.equal(isFieldTechJobStatusTransitionAllowed("in_progress", "canceled"), false);
});

test("append-only job policy follows effective capabilities for field, team, and legacy employee users", () => {
  assert.equal(isAppendOnlyJobNotesRole("field_tech"), true);
  assert.equal(isAppendOnlyJobNotesRole("team_tech"), true);
  assert.equal(isAppendOnlyJobNotesRole("employee"), true);
  assert.equal(isAppendOnlyJobNotesRole("office_admin"), false);
  assert.equal(isAppendOnlyJobNotesRole("admin"), false);
  // PATCH applies this same policy to status transitions, so an employee
  // cannot use jobs.manage to reopen completed work.
  assert.equal(isFieldTechJobStatusTransitionAllowed("completed", "in_progress"), false);
});

test("assignment-scoped operational policy covers aliases and legacy employee", () => {
  for (const role of ["field_tech", "team_tech", "employee"]) {
    assert.equal(isAssignmentScopedOperationalRole(role), true);
  }
  for (const role of ["office_admin", "team_office", "admin", "owner", "super_admin", "sales"]) {
    assert.equal(isAssignmentScopedOperationalRole(role), false);
  }
});

test("field tech capability combination is denied scheduling and commercial job actions", () => {
  for (const capability of [
    requiredCapabilityForRequest("POST", "/jobs"),
    requiredCapabilityForRequest("PATCH", "/jobs/1", { scheduledStartTime: "09:00" }),
    requiredCapabilityForRequest("PATCH", "/jobs/1", { status: "canceled" }),
    requiredCapabilityForRequest("POST", "/jobs/1/generate-invoice"),
  ]) {
    assert.ok(capability);
    assert.equal(hasCapability("field_tech", capability), false);
  }
  assert.equal(hasCapability("field_tech", requiredCapabilityForRequest(
    "PATCH", "/jobs/1", { status: "completed" },
  )!), true);
  // DELETE has the jobs.manage domain capability globally; the job router
  // additionally denies assignment-scoped operational roles.
  assert.equal(hasCapability("field_tech", requiredCapabilityForRequest("DELETE", "/jobs/1")!), true);
});

test("organization-wide personnel pickers require their domain scheduling authority", () => {
  for (const role of ["field_tech", "team_tech", "employee"]) {
    assert.equal(hasCapability(role, requiredCapabilityForRequest("GET", "/team-users/active")!), false);
  }
  for (const role of ["office_admin", "owner", "super_admin", "admin"]) {
    assert.equal(hasCapability(role, requiredCapabilityForRequest("GET", "/team-users/active")!), true);
  }
  assert.equal(requiredCapabilityForRequest("GET", "/estimate-employees"), "estimates.schedule");
  assert.equal(hasCapability("sales", requiredCapabilityForRequest("GET", "/estimate-employees")!), true);
  assert.equal(hasCapability("sales", requiredCapabilityForRequest("POST", "/quotes/with-appointment")!), true);
  assert.equal(hasCapability("sales", "estimates.schedule"), true);
  assert.equal(requiredCapabilityForRequest("GET", "/crews"), "crews.view");
});

test("a field tech invoice-generation request is rejected before its handler can write", () => {
  let handlerReached = false;
  let responseStatus = 0;
  let responseBody: unknown;
  const req = {
    method: "POST",
    path: "/jobs/1/generate-invoice",
    body: {},
    user: { role: "field_tech" },
  } as any;
  const res = {
    status: (status: number) => {
      responseStatus = status;
      return res;
    },
    json: (body: unknown) => {
      responseBody = body;
      return res;
    },
  } as any;

  authorizeApiRequest(req, res, () => { handlerReached = true; });

  assert.equal(responseStatus, 403);
  assert.deepEqual(responseBody, {
    error: "Access denied",
    code: "capability_required",
    capability: "invoices.manage",
  });
  // In app.ts authorization precedes router dispatch. If next is not called,
  // the invoice transaction (including its idempotency write) is unreachable.
  assert.equal(handlerReached, false);
});

test("invoice generation reaches handlers for canonical admin and office roles", () => {
  for (const role of ["team_office", "office_admin", "super_admin"]) {
    let handlerReached = 0;
    authorizeApiRequest({
      method: "POST",
      path: "/jobs/1/generate-invoice",
      body: {},
      user: { role },
    } as any, {} as any, () => { handlerReached += 1; });
    assert.equal(handlerReached, 1, `${role} should reach invoice generation`);
  }
});

test("payment route authorization accepts both office role names and rejects field tech before dispatch", () => {
  for (const role of ["team_office", "office_admin", "super_admin"]) {
    let advanced = 0;
    authorizeApiRequest({
      method: "POST",
      path: "/payments",
      body: {},
      user: { role },
    } as any, {} as any, () => { advanced += 1; });
    assert.equal(advanced, 1, `${role} should reach the payment handler`);
  }

  let advanced = 0;
  let status = 0;
  authorizeApiRequest({
    method: "POST",
    path: "/payments",
    body: {},
    user: { role: "field_tech" },
  } as any, {
    status(value: number) {
      status = value;
      return { json() {} };
    },
  } as any, () => { advanced += 1; });
  assert.equal(status, 403);
  assert.equal(advanced, 0);
});

test("customer plus initial job creation requires both domain capabilities", () => {
  assert.equal(canCreateCustomerWithInitialJob("office_admin"), true);
  assert.equal(canCreateCustomerWithInitialJob("sales"), false);
  assert.equal(canCreateCustomerWithInitialJob("field_tech"), false);
  assert.equal(canCreateCustomerWithInitialJob(null), false);
});

test("business reporting requires dashboard and both financial read capabilities", () => {
  assert.equal(canViewBusinessReporting("owner"), true);
  assert.equal(canViewBusinessReporting("office_admin"), true);
  assert.equal(canViewBusinessReporting("sales"), false);
  assert.equal(canViewBusinessReporting("field_tech"), false);
});

test("Team Users API authorization has the same full role matrix", () => {
  for (const role of ["super_admin", "owner"]) {
    assert.equal(hasCapability(role, "team_users.manage"), true, `${role} should reach Team Users API`);
  }
  for (const role of ["office_admin", "sales", "field_tech", "admin", "employee"]) {
    assert.equal(hasCapability(role, "team_users.manage"), false, `${role} should be denied Team Users API`);
  }
});