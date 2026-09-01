/**
 * Authentication historically emits team_office for the Office Admin role.
 * Keep that compatibility detail at the authorization boundary so every
 * capability matrix continues to use the canonical office_admin role.
 */
export function normalizeAuthorizationRole(role: string | null | undefined): string {
  if (role === "team_office") return "office_admin";
  if (role === "team_tech") return "field_tech";
  return role ?? "";
}