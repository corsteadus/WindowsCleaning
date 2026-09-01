import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
  revalidate: () => Promise<void>;
}

type Snapshot = Pick<AuthState, "user" | "isLoading" | "isAuthenticated">;
const listeners = new Set<() => void>();
let snapshot: Snapshot = { user: null, isLoading: true, isAuthenticated: false };
let request: Promise<void> | null = null;
let initialized = false;

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function validUser(value: unknown): value is AuthUser {
  const user = value as Partial<AuthUser> | null;
  return !!user
    && typeof user.tenantId === "string" && !!user.tenantId
    && typeof user.userId === "string" && !!user.userId
    && typeof user.normalizedRole === "string" && !!user.normalizedRole
    && typeof user.permissionVersion === "string" && !!user.permissionVersion
    && typeof user.assignmentScopeVersion === "string" && !!user.assignmentScopeVersion
    && Array.isArray(user.capabilities);
}

export function revalidateAuth(): Promise<void> {
  if (request) return request;
  request = fetch("/api/auth/user", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { user?: unknown };
      const user = validUser(data.user) ? data.user : null;
      emit({ user, isLoading: false, isAuthenticated: !!user });
    })
    .catch(() => {
      emit({ user: null, isLoading: false, isAuthenticated: false });
    })
    .finally(() => {
      request = null;
    });
  return request;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAuth(): AuthState {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);

  useEffect(() => {
    if (!initialized) {
      initialized = true;
      void revalidateAuth();
    }

    const refresh = () => { void revalidateAuth(); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const login = useCallback(() => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";
    window.location.href = `/api/login?returnTo=${encodeURIComponent(base)}`;
  }, []);

  const logout = useCallback(() => {
    window.location.href = "/api/logout";
  }, []);

  return {
    ...state,
    login,
    logout,
    revalidate: revalidateAuth,
  };
}
