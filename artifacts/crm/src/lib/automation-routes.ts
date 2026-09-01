export const AUTOMATION_ROUTES = {
  index: "/automations",
  health: "/automations/health",
  new: "/automations/new",
  detail: "/automations/:id",
} as const;

export type AutomationRouteMatch =
  | { kind: "index"; path: typeof AUTOMATION_ROUTES.index }
  | { kind: "health"; path: typeof AUTOMATION_ROUTES.health }
  | { kind: "new"; path: typeof AUTOMATION_ROUTES.new }
  | { kind: "detail"; path: string; id: string }
  | null;

/**
 * Keeps the reserved automation paths out of the dynamic :id namespace.
 * This mirrors the exact route semantics used by the Wouter Switch.
 */
export function matchAutomationRoute(pathname: string): AutomationRouteMatch {
  const path = pathname.split("?")[0].replace(/\/$/, "") || "/";

  if (path === AUTOMATION_ROUTES.index) return { kind: "index", path };
  if (path === AUTOMATION_ROUTES.health) return { kind: "health", path };
  if (path === AUTOMATION_ROUTES.new) return { kind: "new", path };

  const detailMatch = /^\/automations\/([^/]+)$/.exec(path);
  return detailMatch
    ? { kind: "detail", path, id: detailMatch[1] }
    : null;
}