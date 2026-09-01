import { createHash } from "node:crypto";
import { getRoleCapabilities } from "./authorization.ts";
import { normalizeAuthorizationRole } from "./role-normalization.ts";

function stableVersion(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function deriveAuthorizationVersions(
  userId: string,
  role: string | null | undefined,
  assignedGraph: readonly unknown[],
) {
  const normalizedRole = normalizeAuthorizationRole(role);
  const capabilities = getRoleCapabilities(normalizedRole);
  return {
    normalizedRole,
    capabilities,
    permissionVersion: stableVersion({ normalizedRole, capabilities }),
    assignmentScopeVersion: stableVersion({ userId, assignedGraph }),
  };
}