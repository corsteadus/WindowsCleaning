export type ClientCapability =
  | "dashboard.view"
  | "customers.view" | "customers.manage"
  | "contacts.view" | "contacts.manage"
  | "properties.view" | "properties.manage"
  | "leads.view" | "leads.manage"
  | "quotes.view" | "quotes.manage"
  | "estimates.convert"
  | "jobs.view" | "jobs.manage"
  | "schedule.view" | "schedule.manage"
  | "recurring_plans.view" | "recurring_plans.manage"
  | "services.view" | "services.manage"
  | "catalogs.view" | "catalogs.manage"
  | "custom_fields.view" | "custom_fields.manage"
  | "crews.view" | "crews.manage"
  | "tasks.view" | "tasks.manage"
  | "invoices.view" | "invoices.manage"
  | "payments.view" | "payments.record"
  | "reconciliation.view"
  | "approvals.view"
  | "automation.view"
  | "automation_events.view"
  | "communication.view" | "communication.manage" | "communication.send"
  | "team_users.manage"
  | "settings.view"
  | "admin.settings";

export interface CapabilityEnvelope {
  capabilities?: readonly string[];
}

export function hasClientCapability(
  envelope: CapabilityEnvelope | null | undefined,
  capability: ClientCapability,
): boolean {
  return envelope?.capabilities?.includes(capability) === true;
}

interface PageRule {
  prefix: string;
  capability: ClientCapability;
}

const PAGE_RULES: readonly PageRule[] = [
  { prefix: "/team-users", capability: "team_users.manage" },
  { prefix: "/admin", capability: "admin.settings" },
  { prefix: "/settings/financial-permissions", capability: "approvals.view" },
  { prefix: "/settings", capability: "settings.view" },
  { prefix: "/leads", capability: "leads.view" },
  { prefix: "/prospects", capability: "leads.view" },
  { prefix: "/customers", capability: "customers.view" },
  { prefix: "/properties", capability: "properties.view" },
  { prefix: "/quotes", capability: "quotes.view" },
  { prefix: "/schedule", capability: "schedule.view" },
  { prefix: "/jobs/new", capability: "schedule.manage" },
  { prefix: "/jobs", capability: "jobs.view" },
  { prefix: "/recurring-plans", capability: "recurring_plans.view" },
  { prefix: "/tasks", capability: "tasks.view" },
  { prefix: "/invoices", capability: "invoices.view" },
  { prefix: "/payments", capability: "payments.view" },
  { prefix: "/reports/reconciliation", capability: "reconciliation.view" },
  { prefix: "/communications", capability: "communication.view" },
  { prefix: "/automations", capability: "automation.view" },
  { prefix: "/automation-health", capability: "automation.view" },
  { prefix: "/crews", capability: "crews.view" },
  { prefix: "/services", capability: "services.view" },
];

export function requiredPageCapability(path: string): ClientCapability | null {
  return PAGE_RULES.find((rule) => path === rule.prefix || path.startsWith(`${rule.prefix}/`))?.capability ?? null;
}

export function canAccessPage(path: string, envelope: CapabilityEnvelope | null | undefined): boolean {
  const capability = requiredPageCapability(path);
  return capability === null || hasClientCapability(envelope, capability);
}

export function roleLabel(role: string | null | undefined): string {
  return ({
    super_admin: "Super Admin",
    owner: "Owner",
    office_admin: "Office Admin",
    sales: "Sales",
    field_tech: "Field Tech",
    admin: "Office Admin",
    employee: "Field Tech",
  } as Record<string, string>)[role ?? ""] ?? "Team User";
}