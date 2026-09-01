import type { QueryKey } from "@tanstack/react-query";
import type { AuthUser } from "@workspace/replit-auth-web";

export const AUTH_INVALID_EVENT = "crm:protected-auth-invalid";
export const AUTH_REVALIDATE_EVENT = "crm:protected-auth-revalidate";
let activeFingerprint: string | null = null;

export type AuthScopeEnvelope = Pick<
  AuthUser,
  "tenantId" | "userId" | "normalizedRole" | "permissionVersion" | "assignmentScopeVersion" | "capabilities"
>;

export function authScopeFingerprint(user: AuthScopeEnvelope | null | undefined): string | null {
  if (
    !user
    || !user.tenantId
    || !user.userId
    || !user.normalizedRole
    || !user.permissionVersion
    || !user.assignmentScopeVersion
    || !Array.isArray(user.capabilities)
  ) return null;

  return JSON.stringify([
    user.tenantId,
    user.userId,
    user.permissionVersion,
    user.assignmentScopeVersion,
    user.normalizedRole,
    [...user.capabilities].sort(),
  ]);
}

export function authScopedQueryKey(
  user: AuthScopeEnvelope | null | undefined,
  key: QueryKey,
): QueryKey {
  const fingerprint = authScopeFingerprint(user);
  return ["auth-scope", fingerprint ?? "invalid", ...key];
}

/** Mandatory QueryClient-level partition for every query, including future
 * generated/bespoke consumers that forget to wrap their visible query key. */
export function setActiveAuthScopeFingerprint(fingerprint: string | null): void {
  activeFingerprint = fingerprint;
}

export function mandatoryAuthScopeQueryHash(queryKey: QueryKey): string {
  // Explicit scoped keys remain readable in devtools; this central suffix
  // prevents any unwrapped key from sharing a cache entry across authorities.
  return JSON.stringify(["mandatory-auth-scope", activeFingerprint ?? "invalid", queryKey]);
}

export function isAuthorizationError(error: unknown): boolean {
  const candidate = error as { status?: number; response?: { status?: number } } | null;
  const status = candidate?.status ?? candidate?.response?.status;
  return status === 401 || status === 403;
}

export function signalInvalidAuthorization(): void {
  window.dispatchEvent(new Event(AUTH_INVALID_EVENT));
}

/** A forbidden resource may be ordinary RBAC denial, or a changed authority.
 * Revalidate the envelope before deciding whether a scope transition is needed. */
export function signalAuthorizationRevalidation(): void {
  window.dispatchEvent(new Event(AUTH_REVALIDATE_EVENT));
}

export async function protectedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: init.credentials ?? "include",
    cache: "no-store",
  });
  if (response.status === 401) signalInvalidAuthorization();
  if (response.status === 403) signalAuthorizationRevalidation();
  return response;
}