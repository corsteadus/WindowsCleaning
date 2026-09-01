import type { NextFunction, Request, Response } from "express";
import { normalizeAuthorizationRole } from "./role-normalization.ts";

export const TEAM_USER_ROLES = [
  "super_admin",
  "owner",
  "office_admin",
  "sales",
  "field_tech",
] as const;

export type TeamUserRole = (typeof TEAM_USER_ROLES)[number];

export const APP_CAPABILITIES = [
  "dashboard.view",
  "customers.view",
  "customers.manage",
  "contacts.view",
  "contacts.manage",
  "properties.view",
  "properties.manage",
  "leads.view",
  "leads.manage",
  "leads.convert",
  "quotes.view",
  "quotes.manage",
  "estimates.schedule",
  "estimates.finalize",
  "estimates.deliver",
  "estimates.follow_up",
  "estimates.convert",
  "jobs.view",
  "jobs.manage",
  "schedule.view",
  "schedule.manage",
  "recurring_plans.view",
  "recurring_plans.manage",
  "services.view",
  "services.manage",
  "catalogs.view",
  "catalogs.manage",
  "custom_fields.view",
  "custom_fields.manage",
  "crews.view",
  "crews.manage",
  "tasks.view",
  "tasks.manage",
  "invoices.view",
  "invoices.manage",
  "payments.view",
  "payments.record",
  "credits.view",
  "customer_credit.apply",
  "refunds.record",
  "reconciliation.view",
  "reconciliation.export",
  "approvals.view",
  "approvals.decide",
  "approvals.manage",
  "automation.view",
  "automation.manage",
  "automation_events.view",
  "automation_events.manage",
  "communication.view",
  "communication.manage",
  "communication.send",
  "communication.settings",
  "campaigns.view",
  "campaigns.manage",
  "team_users.manage",
  "settings.view",
  "admin.settings",
  "admin.import",
  "admin.purge",
] as const;

export type AppCapability = (typeof APP_CAPABILITIES)[number];

const OFFICE_ADMIN_CAPABILITIES: readonly AppCapability[] = [
  "dashboard.view",
  "customers.view", "customers.manage",
  "contacts.view", "contacts.manage",
  "properties.view", "properties.manage",
  "leads.view", "leads.manage", "leads.convert",
  "quotes.view", "quotes.manage",
  "estimates.schedule", "estimates.finalize", "estimates.deliver", "estimates.follow_up", "estimates.convert",
  "jobs.view", "jobs.manage",
  "schedule.view", "schedule.manage",
  "recurring_plans.view", "recurring_plans.manage",
  "services.view", "services.manage",
  "catalogs.view", "custom_fields.view",
  "crews.view", "crews.manage",
  "tasks.view", "tasks.manage",
  "invoices.view", "invoices.manage",
  "payments.view", "payments.record",
  "credits.view", "customer_credit.apply", "refunds.record",
  "reconciliation.view", "reconciliation.export",
  "approvals.view", "approvals.decide",
  "communication.view", "communication.manage", "communication.send",
  "communication.settings",
  "campaigns.view", "campaigns.manage",
];

const OWNER_CAPABILITIES: readonly AppCapability[] = [
  ...OFFICE_ADMIN_CAPABILITIES,
  "catalogs.manage", "custom_fields.manage",
  "automation.view", "automation.manage",
  "automation_events.view", "automation_events.manage",
];

const ROLE_CAPABILITIES: Record<string, readonly AppCapability[]> = {
  super_admin: [...APP_CAPABILITIES],
  owner: [...OWNER_CAPABILITIES, "team_users.manage", "settings.view"],
  office_admin: [...OFFICE_ADMIN_CAPABILITIES],
  sales: [
    "dashboard.view",
    "customers.view", "customers.manage",
    "contacts.view", "contacts.manage",
    "properties.view", "properties.manage",
    "leads.view", "leads.manage", "leads.convert",
    "quotes.view", "quotes.manage",
    "estimates.schedule", "estimates.finalize", "estimates.deliver", "estimates.follow_up",
    "jobs.view", "schedule.view",
    "tasks.view", "tasks.manage",
  ],
  field_tech: [
    "customers.view",
    "contacts.view",
    "properties.view",
    "jobs.view", "jobs.manage",
    "schedule.view",
  ],
  // Legacy role names remain accepted, but never retain broader access than
  // their compatibility role.
  admin: [...OWNER_CAPABILITIES],
  employee: [
    "customers.view",
    "contacts.view",
    "properties.view",
    "jobs.view", "jobs.manage",
    "schedule.view",
  ],
};

export function isKnownAuthorizationRole(role: string | null | undefined): boolean {
  return Object.prototype.hasOwnProperty.call(
    ROLE_CAPABILITIES,
    normalizeAuthorizationRole(role),
  );
}

export function getRoleCapabilities(role: string | null | undefined): AppCapability[] {
  return [...(ROLE_CAPABILITIES[normalizeAuthorizationRole(role)] ?? [])];
}

export function isFieldTechRole(role: string | null | undefined): boolean {
  return normalizeAuthorizationRole(role) === "field_tech";
}

/**
 * Operational users who may update job execution state but have no scheduling
 * authority must always be constrained to their assigned-job graph.
 */
export function isAssignmentScopedOperationalRole(
  role: string | null | undefined,
): boolean {
  return hasCapability(role, "jobs.manage") && !hasCapability(role, "schedule.manage");
}

export function hasCapability(
  role: string | null | undefined,
  capability: AppCapability,
): boolean {
  return getRoleCapabilities(role).includes(capability);
}

/**
 * Append-only field operations are a capability policy, not a role alias.
 * This deliberately covers legacy employee accounts with the same effective
 * job/scheduling capabilities without changing their unrelated access.
 */
export function isAppendOnlyJobNotesRole(role: string | null | undefined): boolean {
  return isAssignmentScopedOperationalRole(role);
}

export function canCreateCustomerWithInitialJob(role: string | null | undefined): boolean {
  return hasCapability(role, "customers.manage") && hasCapability(role, "schedule.manage");
}

export function canViewBusinessReporting(role: string | null | undefined): boolean {
  return hasCapability(role, "dashboard.view")
    && hasCapability(role, "invoices.view")
    && hasCapability(role, "payments.view");
}

export function isTeamUserRole(value: unknown): value is TeamUserRole {
  return typeof value === "string" && TEAM_USER_ROLES.includes(value as TeamUserRole);
}

function isMethod(method: string, ...methods: string[]): boolean {
  return methods.includes(method.toUpperCase());
}

interface RouteRule {
  prefix: string;
  methods?: readonly string[];
  matches?: (method: string, path: string) => boolean;
  capability: AppCapability;
}

const FIELD_TECH_JOB_PATCH_FIELDS = new Set(["status", "notes", "techNotes"]);
const FIELD_TECH_JOB_STATUSES = new Set(["in_progress", "completed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Job operations need a finer distinction than the broad jobs.manage
 * capability.  Field technicians retain their operational actions (start,
 * complete, and job notes), while scheduling and commercial actions use the
 * existing schedule.manage and invoices.manage capabilities.
 */
export function requiredCapabilityForJobMutation(
  method: string,
  path: string,
  body: unknown,
): AppCapability | null {
  if (isMethod(method, "POST") && path === "/jobs") return "schedule.manage";
  if (isMethod(method, "DELETE") && /^\/jobs\/[^/]+$/.test(path)) return "jobs.manage";
  if (isMethod(method, "POST") && /^\/jobs\/[^/]+\/generate-invoice$/.test(path)) {
    return "invoices.manage";
  }
  if (!isMethod(method, "PATCH") || !/^\/jobs\/[^/]+$/.test(path)) return null;

  if (!isRecord(body)) return "schedule.manage";
  const fields = Object.keys(body);
  const hasOnlyAppendableNotes = ["notes", "techNotes"].every((field) =>
    body[field] === undefined || (typeof body[field] === "string" && body[field].trim().length > 0),
  );
  const isFieldOperation = fields.length > 0
    && fields.every((field) => FIELD_TECH_JOB_PATCH_FIELDS.has(field))
    && hasOnlyAppendableNotes
    && (body.status === undefined || (
      typeof body.status === "string" && FIELD_TECH_JOB_STATUSES.has(body.status)
    ));
  return isFieldOperation ? "jobs.manage" : "schedule.manage";
}

/**
 * Request-shape authorization cannot distinguish "start" from a reopen because
 * both submit status=in_progress. After the job row is locked, field techs may
 * only move forward through the operational workflow (or repeat the current
 * state idempotently).
 */
export function isFieldTechJobStatusTransitionAllowed(
  currentStatus: string,
  requestedStatus: string,
): boolean {
  if (currentStatus === requestedStatus) return true;
  return (currentStatus === "scheduled" && requestedStatus === "in_progress")
    || (currentStatus === "in_progress" && requestedStatus === "completed");
}

const ROUTE_RULES: readonly RouteRule[] = [
  { prefix: "/catalogs", methods: ["GET"], capability: "catalogs.view" },
  { prefix: "/catalogs", capability: "catalogs.manage" },
  { prefix: "/custom-fields/definitions", methods: ["GET"], capability: "custom_fields.view" },
  { prefix: "/custom-fields/definitions", capability: "custom_fields.manage" },
  { prefix: "/contact-channels", capability: "contacts.manage" },
  // This is an organization-wide personnel picker, not an assigned-work
  // projection. Scheduling authority is required so field/append-only roles
  // cannot enumerate the active workforce.
  { prefix: "/team-users/active", methods: ["GET"], capability: "schedule.manage" },
  { prefix: "/admin/users", capability: "team_users.manage" },
  { prefix: "/admin", capability: "admin.settings" },
  { prefix: "/dashboard", capability: "dashboard.view" },
  { prefix: "/leads", methods: ["GET"], capability: "leads.view" },
  { prefix: "/leads", methods: ["POST"], capability: "leads.manage" },
  { prefix: "/leads", capability: "leads.manage" },
  {
    prefix: "/prospects",
    matches: (method, path) => isMethod(method, "POST") && /^\/prospects\/[^/]+\/status$/.test(path),
    capability: "leads.convert",
  },
  { prefix: "/prospects", methods: ["GET"], capability: "leads.view" },
  { prefix: "/prospects", capability: "leads.manage" },
  {
    prefix: "/customers",
    matches: (method, path) => isMethod(method, "GET") && /^\/customers\/[^/]+\/communication-safety(?:\/|$)/.test(path),
    capability: "communication.view",
  },
  {
    prefix: "/customers",
    matches: (_method, path) => /^\/customers\/[^/]+\/communication-safety(?:\/|$)/.test(path),
    capability: "communication.manage",
  },
  {
    prefix: "/customers/with-initial-job",
    methods: ["POST"],
    capability: "schedule.manage",
  },
  { prefix: "/customers", methods: ["GET"], capability: "customers.view" },
  { prefix: "/customers", capability: "customers.manage" },
  {
    prefix: "/contacts",
    matches: (method, path) => isMethod(method, "GET") && /^\/contacts\/[^/]+\/communication-safety(?:\/|$)/.test(path),
    capability: "communication.view",
  },
  {
    prefix: "/contacts",
    matches: (_method, path) => /^\/contacts\/[^/]+\/communication-safety(?:\/|$)/.test(path),
    capability: "communication.manage",
  },
  { prefix: "/contacts", methods: ["GET"], capability: "contacts.view" },
  { prefix: "/contacts", capability: "contacts.manage" },
  { prefix: "/properties", methods: ["GET"], capability: "properties.view" },
  { prefix: "/properties", capability: "properties.manage" },
  { prefix: "/quotes", methods: ["GET"], capability: "quotes.view" },
  { prefix: "/quotes", matches: (method, path) => isMethod(method, "POST") && /\/appointment$/.test(path), capability: "estimates.schedule" },
  { prefix: "/quotes", matches: (method, path) => isMethod(method, "POST") && /\/(?:finalize|revisions)$/.test(path), capability: "estimates.finalize" },
  { prefix: "/quotes", matches: (method, path) => isMethod(method, "POST") && /\/deliver$/.test(path), capability: "estimates.deliver" },
  { prefix: "/quotes", matches: (method, path) => /\/(?:conversion-preview|convert-and-schedule)$/.test(path), capability: "estimates.convert" },
  { prefix: "/quotes", capability: "quotes.manage" },
  { prefix: "/estimate-calendar", methods: ["GET"], capability: "quotes.view" },
  { prefix: "/estimate-employees", methods: ["GET"], capability: "estimates.schedule" },
  { prefix: "/estimates/follow-up", methods: ["GET"], capability: "estimates.follow_up" },
  { prefix: "/jobs", methods: ["GET"], capability: "jobs.view" },
  { prefix: "/jobs", capability: "jobs.manage" },
  { prefix: "/schedule", methods: ["GET"], capability: "schedule.view" },
  { prefix: "/recurring-plans", methods: ["GET"], capability: "recurring_plans.view" },
  { prefix: "/recurring-plans", capability: "recurring_plans.manage" },
  { prefix: "/services", methods: ["GET"], capability: "services.view" },
  { prefix: "/services", capability: "services.manage" },
  { prefix: "/crews", methods: ["GET"], capability: "crews.view" },
  { prefix: "/crews", capability: "crews.manage" },
  { prefix: "/tasks", methods: ["GET"], capability: "tasks.view" },
  { prefix: "/tasks", capability: "tasks.manage" },
  { prefix: "/invoices", methods: ["GET"], capability: "invoices.view" },
  { prefix: "/invoices", capability: "invoices.manage" },
  { prefix: "/payments", methods: ["GET"], capability: "payments.view" },
  { prefix: "/payments", capability: "payments.record" },
  { prefix: "/customer-credits", methods: ["GET"], capability: "credits.view" },
  { prefix: "/customer-credits/applications", capability: "customer_credit.apply" },
  { prefix: "/customer-credits/refunds", methods: ["GET"], capability: "credits.view" },
  { prefix: "/customer-credits/refunds", capability: "refunds.record" },
  { prefix: "/financial-reconciliation", methods: ["GET"], capability: "reconciliation.view" },
  { prefix: "/financial-reconciliation/export.csv", capability: "reconciliation.export" },
  { prefix: "/financial-approval-policies", methods: ["GET"], capability: "approvals.view" },
  { prefix: "/financial-approval-policies", capability: "approvals.manage" },
  { prefix: "/financial-approvals", methods: ["GET"], capability: "approvals.view" },
  { prefix: "/financial-approvals", capability: "approvals.decide" },
  { prefix: "/automation-events", methods: ["GET"], capability: "automation_events.view" },
  { prefix: "/automation-event-attempts", methods: ["GET"], capability: "automation_events.view" },
  { prefix: "/automation-events", capability: "automation_events.manage" },
  { prefix: "/automations", methods: ["GET"], capability: "automation.view" },
  { prefix: "/message-logs", methods: ["GET"], capability: "automation.view" },
  { prefix: "/automations", capability: "automation.manage" },
  { prefix: "/emails", methods: ["GET"], capability: "communication.view" },
  { prefix: "/emails/preview", capability: "communication.view" },
  { prefix: "/emails", capability: "communication.send" },
  { prefix: "/campaigns", methods: ["GET"], capability: "campaigns.view" },
  { prefix: "/campaigns", capability: "campaigns.manage" },
  { prefix: "/email-templates", methods: ["GET"], capability: "communication.view" },
  { prefix: "/email-templates", capability: "communication.manage" },
  { prefix: "/activity-logs", capability: "admin.settings" },
  // Attachment reads have no row-level assignment implementation. Keep them
  // unavailable to field technicians rather than exposing customer documents.
  { prefix: "/attachments", methods: ["GET"], capability: "customers.manage" },
  { prefix: "/attachments", capability: "customers.manage" },
  { prefix: "/storage", capability: "dashboard.view" },
  { prefix: "/communication-safety", methods: ["GET"], capability: "communication.view" },
  { prefix: "/communication-safety", capability: "communication.manage" },
  { prefix: "/financial-permissions/capabilities", capability: "dashboard.view" },
  { prefix: "/settings/financial-permissions", capability: "approvals.view" },
  { prefix: "/settings", capability: "settings.view" },
  { prefix: "/stripe/webhook", capability: "dashboard.view" },
  { prefix: "/stripe", capability: "payments.record" },
];

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function requiredCapabilityForRequest(
  method: string,
  path: string,
  body?: unknown,
): AppCapability | null {
  const jobCapability = requiredCapabilityForJobMutation(method, path, body);
  if (jobCapability) return jobCapability;
  if (isMethod(method, "POST") && path === "/attachments" && isRecord(body) && body.entityType === "job") {
    return "jobs.manage";
  }
  const rule = ROUTE_RULES.find(
    (candidate) =>
      matchesPrefix(path, candidate.prefix)
      && (!candidate.matches || candidate.matches(method, path))
      && (!candidate.methods || isMethod(method, ...candidate.methods)),
  );
  return rule?.capability ?? null;
}

const PUBLIC_PATHS = new Set([
  "/healthz",
  "/auth/user",
  "/auth/login",
  "/login",
  "/callback",
  "/logout",
  "/mobile-auth/token-exchange",
  "/mobile-auth/logout",
  "/stripe/webhook",
]);

export function authorizeApiRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith("/public/estimates/")) {
    next();
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }
  if (!isKnownAuthorizationRole(req.user.role)) {
    res.status(403).json({ error: "Access denied", code: "unknown_role" });
    return;
  }
  // This runs before every route handler (and therefore before invoice
  // idempotency claims or transactions), so a denied invoice request is
  // provably write-free.
  const capability = requiredCapabilityForRequest(req.method, req.path, req.body);
  if (capability && !hasCapability(req.user.role, capability)) {
    res.status(403).json({
      error: "Access denied",
      code: "capability_required",
      capability,
    });
    return;
  }
  next();
}

export function setAuthenticatedApiCacheHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.user) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Pragma", "no-cache");
    res.vary("Cookie");
    res.vary("Authorization");
  }
  next();
}

export function requireCapability(capability: AppCapability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
      return;
    }
    if (!isKnownAuthorizationRole(req.user.role)) {
      res.status(403).json({ error: "Access denied", code: "unknown_role" });
      return;
    }
    if (!hasCapability(req.user.role, capability)) {
      res.status(403).json({ error: "Access denied", code: "capability_required", capability });
      return;
    }
    next();
  };
}