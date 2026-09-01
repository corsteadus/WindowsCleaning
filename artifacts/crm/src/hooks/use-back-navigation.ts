import { useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";

const NAV_HISTORY_KEY = "crm_nav_history";
const MAX_HISTORY = 50;

function getNavHistory(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(NAV_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function pushNavHistory(path: string) {
  const history = getNavHistory();
  if (history[history.length - 1] === path) return;
  history.push(path);
  if (history.length > MAX_HISTORY) history.shift();
  sessionStorage.setItem(NAV_HISTORY_KEY, JSON.stringify(history));
}

function popNavHistory(): string | null {
  const history = getNavHistory();
  if (history.length < 2) return null;
  history.pop();
  const prev = history[history.length - 1] || null;
  sessionStorage.setItem(NAV_HISTORY_KEY, JSON.stringify(history));
  return prev;
}

export function useNavigationTracker() {
  const [location] = useLocation();
  const lastLocation = useRef<string | null>(null);

  useEffect(() => {
    if (location !== lastLocation.current) {
      pushNavHistory(location);
      lastLocation.current = location;
    }
  }, [location]);
}

export function useBackNavigation(fallbackPath: string) {
  const [, navigate] = useLocation();

  const goBack = useCallback(() => {
    const prev = popNavHistory();
    if (prev) {
      navigate(prev);
    } else {
      navigate(fallbackPath);
    }
  }, [fallbackPath, navigate]);

  const backLabel = (() => {
    const history = getNavHistory();
    if (history.length < 2) return null;
    const prev = history[history.length - 2];
    if (!prev) return null;

    if (prev.startsWith("/customers/")) return "Customer";
    if (prev.startsWith("/customers")) return "Customers";
    if (prev.startsWith("/jobs/")) return "Job";
    if (prev.startsWith("/jobs")) return "Jobs";
    if (prev.startsWith("/invoices/")) return "Invoice";
    if (prev.startsWith("/invoices")) return "Invoices";
    if (prev.startsWith("/quotes/")) return "Quote";
    if (prev.startsWith("/quotes")) return "Quotes";
    if (prev.startsWith("/leads/")) return "Lead";
    if (prev.startsWith("/leads")) return "Leads";
    if (prev.startsWith("/recurring-plans/")) return "Plan";
    if (prev.startsWith("/recurring-plans")) return "Recurring Plans";
    if (prev.startsWith("/automations/")) return "Automation";
    if (prev.startsWith("/automations")) return "Automations";
    if (prev.startsWith("/schedule")) return "Schedule";
    if (prev === "/") return "Dashboard";
    return null;
  })();

  return { goBack, backLabel };
}
