import { sql } from "drizzle-orm";
import { jobsTable } from "@workspace/db";

export type ActiveAssignmentGraph = {
  users: ReadonlyMap<string, { isActive: boolean }>;
  crews: ReadonlyMap<number, { isActive: boolean }>;
  memberships: Iterable<{ crewId: number; userId: string; role: string }>;
};

/**
 * In-memory form of the same normalized authorization predicate used by
 * assignedJobCondition.  It is deliberately limited to canonical assignment
 * columns and normalized membership rows so repository-adapter tests can
 * exercise the release contract without a database.
 */
export function hasActiveJobAssignment(
  job: { assignedTechnicianUserId?: string | null; crewId?: number | null },
  userId: string,
  graph: ActiveAssignmentGraph,
): boolean {
  if (!graph.users.get(userId)?.isActive) return false;
  if (job.assignedTechnicianUserId === userId) return true;
  if (job.crewId === null || job.crewId === undefined || !graph.crews.get(job.crewId)?.isActive) return false;
  for (const membership of graph.memberships) {
    if (
      membership.crewId === job.crewId
      && membership.userId === userId
      && (membership.role === "lead" || membership.role === "member")
    ) return true;
  }
  return false;
}

/**
 * Canonical assignments are either a direct user id or an active crew
 * membership. Legacy line-item assignment snapshots are presentation data and
 * must never grant access.
 */
export function assignedJobCondition(userId: string) {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM users assignment_user
     WHERE assignment_user.id = ${userId}
       AND assignment_user.is_active = true
       AND (
         ${jobsTable.assignedTechnicianUserId} = ${userId}
         OR EXISTS (
           SELECT 1
             FROM crew_members membership
             JOIN crews assignment_crew ON assignment_crew.id = membership.crew_id
            WHERE membership.crew_id = ${jobsTable.crewId}
              AND membership.user_id = ${userId}
              AND membership.role IN ('lead', 'member')
              AND assignment_crew.is_active = true
         )
       )
  )`;
}

const OPERATIONAL_JOB_FIELDS = new Set([
  "id", "customerId", "propertyId", "crewId", "assignedTechnicianUserId", "assignedTechnician",
  "jobNumber", "status",
  "serviceType", "scheduledDate", "scheduledStartTime", "scheduledEndTime",
  "estimatedDuration", "isRecurring", "recurringFrequency", "recurringPlanId",
  "notes", "techNotes", "completedAt", "createdAt", "updatedAt", "lineItems",
  "customerName", "propertyAddress", "propertyName", "assignedUserIds",
  "assignedEmployeeNames", "crewName", "customer", "property",
]);

const OPERATIONAL_LINE_FIELDS = new Set([
  "id", "serviceId", "propertyId", "name", "description", "serviceType",
  "quantity", "assignedUserIds", "assignedEmployeeNames", "notes",
  "serviceNotes", "status", "startedAt", "completedAt",
]);

const OPERATIONAL_CUSTOMER_FIELDS = new Set([
  "id", "firstName", "lastName", "displayName", "companyName", "email", "phone",
  "homePhone", "workPhone", "cellPhone", "altPhone", "preferredContactMethod",
]);

const OPERATIONAL_PROPERTY_FIELDS = new Set([
  "id", "customerId", "name", "address", "city", "state", "zip", "propertyType",
  "stories", "windowCount", "directions", "locationNotes", "accessNotes",
  "gateCode", "riskNotes", "serviceNotes", "hasScreens", "hasHardWater", "hasTracks",
]);

const TOP_LEVEL_COMPLEX_FIELDS = new Set(["lineItems", "customer", "property"]);

function allowFields(
  value: unknown,
  fields: Set<string>,
  complexFields: Set<string> = new Set(),
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (!fields.has(key)) return [];
    if (complexFields.has(key)) return [[key, child]];
    if (child instanceof Date) return [[key, child.toISOString()]];
    if (child === null || ["string", "number", "boolean"].includes(typeof child)) {
      return [[key, child]];
    }
    if (Array.isArray(child) && child.every((item) =>
      item === null || ["string", "number", "boolean"].includes(typeof item))) {
      return [[key, child]];
    }
    return [];
  }));
}

/**
 * Field responses are built from an operational allowlist rather than by
 * subtracting known financial fields. This keeps newly-added commercial,
 * quote, invoice, and payment fields private by default.
 */
export function redactAssignedJob<T extends Record<string, any>>(job: T): Record<string, unknown> {
  const safe = allowFields(job, OPERATIONAL_JOB_FIELDS, TOP_LEVEL_COMPLEX_FIELDS) ?? {};

  if (typeof safe.lineItems === "string") {
    try {
      const lines = JSON.parse(safe.lineItems) as unknown;
      safe.lineItems = Array.isArray(lines)
        ? JSON.stringify(lines.map((line) => allowFields(line, OPERATIONAL_LINE_FIELDS) ?? {}))
        : null;
    } catch {
      safe.lineItems = null;
    }
  } else if (Array.isArray(safe.lineItems)) {
    safe.lineItems = safe.lineItems.map((line) => allowFields(line, OPERATIONAL_LINE_FIELDS) ?? {});
  } else if (safe.lineItems !== null && safe.lineItems !== undefined) {
    safe.lineItems = null;
  }

  if ("customer" in safe) safe.customer = allowFields(safe.customer, OPERATIONAL_CUSTOMER_FIELDS);
  if ("property" in safe) safe.property = allowFields(safe.property, OPERATIONAL_PROPERTY_FIELDS);
  return safe;
}