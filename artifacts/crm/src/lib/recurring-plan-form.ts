/**
 * Pure helpers for the Recurring Plan creation form.
 *
 * Sentinel constants replace empty-string ("") controlled Select values that
 * cause Radix UI to throw a runtime error.  They are exported so that:
 *   1. The component imports them instead of inlining magic strings.
 *   2. The test suite can assert the sentinels are non-empty and that the
 *      payload builder converts them to the correct API shape.
 *
 * Rule: EVERY sentinel must be a non-empty string.
 */

export const CUSTOMER_NONE = "none" as const;
export const PROPERTY_NONE = "none" as const;
export const SERVICE_NONE  = "none" as const;

/**
 * Closed-trigger display strings — single source of truth for the page, the
 * sentinel <SelectItem> text, and the tests.
 *
 * Radix (@radix-ui/react-select 2.x) only renders SelectValue's `placeholder`
 * when the controlled value is "" or undefined (`shouldShowPlaceholder`).  A
 * non-empty sentinel like "none" that matches no mounted item therefore
 * renders NEITHER placeholder NOR item text — a visually blank closed
 * trigger.  The page must not rely on the placeholder for sentinel states;
 * it computes the visible label itself via the resolvers below.
 */
export const CUSTOMER_PLACEHOLDER = "Select customer…" as const;
export const SERVICE_ANY_LABEL    = "Any / Not specified" as const;

export interface CustomerOption {
  id: number;
  displayName?: string | null;
  firstName?:   string | null;
  lastName?:    string | null;
  /** Business name — the API serializes camelCase, but accept snake_case too. */
  companyName?:  string | null;
  company_name?: string | null;
}

/**
 * Cleans a single name component: non-strings and the literal tokens
 * "undefined"/"null" (any case) become "", everything else is trimmed.
 * Mirrors the API-side customerDisplayName() sanitizer so client labels and
 * server-enriched labels can never disagree on what counts as "blank".
 */
function cleanNamePart(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const t = raw.trim();
  if (!t || /^(undefined|null)$/i.test(t)) return "";
  return t;
}

export interface ServiceTypeOption {
  value: string;
  label: string;
}

/**
 * Deterministic display label for a customer — used for BOTH the dropdown
 * option rows and the closed trigger, so they can never disagree.
 * Never returns a blank/whitespace string: blank names fall back to
 * "Customer #<id>".
 */
export function customerOptionLabel(c: CustomerOption): string {
  const display = cleanNamePart(c.displayName);
  if (display) return display;
  const first = cleanNamePart(c.firstName);
  const last  = cleanNamePart(c.lastName);
  if (first || last) return [first, last].filter(Boolean).join(" ");
  // Business-only customers (blank person name, company_name set — e.g.
  // customer 8894 "Conoco Gas Station") must show their business name, not
  // the #id fallback.  Shared precedence with the API's customerDisplayName:
  // person name → company name → Customer #id.
  const company = cleanNamePart(c.companyName ?? c.company_name);
  if (company) return company;
  return `Customer #${c.id}`;
}

/**
 * State-transition guards for controlled Radix Select values.
 *
 * The canonical implementations (and the full explanation of the Radix
 * bubble-input reset circuit) live in the shared generic module
 * `select-guards.ts`, used by every page that renders a Select inside a
 * <form> (RecurringPlanNew, JobNew, AutomationNew).  This module re-exports
 * `nextSelectValue` and keeps the historical two-argument
 * `nextOptionalSelectValue` shape for the recurring-plan day/time selects,
 * so existing imports, page wiring, and tests are unchanged.
 */
export { nextSelectValue } from "./select-guards.ts";
import { nextOptionalSelectValue as nextOptionalSelectValueWithSentinel } from "./select-guards.ts";

/** Radix-facing sentinel for the Preferred Day / Preferred Time selects. */
export const DAY_TIME_ANY = "any" as const;

/**
 * nextSelectValue variant for selects whose STORED state uses "" to mean
 * "any" while the Radix-facing value uses the non-empty sentinel "any"
 * (value={stored || "any"}).  A naive `v === "any" ? "" : v` mapping lets
 * empty-string bubble noise masquerade as a legitimate reset-to-any and
 * silently wipe the user's chosen day/time.  Delegates to the shared
 * sentinel-space guard with DAY_TIME_ANY, so ONLY an actual click on the
 * "Any" item can clear the stored value.
 */
export function nextOptionalSelectValue(currentStored: string, incoming: unknown): string {
  return nextOptionalSelectValueWithSentinel(currentStored, incoming, DAY_TIME_ANY);
}

/**
 * Label for the closed Customer trigger.
 * Returns null when nothing is selected OR the id is not (yet) in the list —
 * the caller then shows CUSTOMER_PLACEHOLDER, never a blank trigger.
 * Matching is string-exact against String(id); with duplicate ids the first
 * match wins, so the result is stable regardless of list size or order.
 */
export function selectedCustomerLabel(
  customerId: string,
  customers: readonly CustomerOption[],
): string | null {
  if (!customerId || customerId === CUSTOMER_NONE) return null;
  const match = customers.find((c) => String(c.id) === customerId);
  return match ? customerOptionLabel(match) : null;
}

/**
 * Label for the closed Service Type trigger.
 * Returns null when nothing is selected (sentinel) — the caller then shows
 * SERVICE_ANY_LABEL.  A selected value unknown to the options list (or an
 * empty options list) falls back to the raw value, never a blank trigger.
 */
export function selectedServiceLabel(
  serviceType: string,
  serviceTypes: readonly ServiceTypeOption[],
): string | null {
  if (!serviceType || serviceType === SERVICE_NONE) return null;
  return serviceTypes.find((s) => s.value === serviceType)?.label ?? serviceType;
}

export interface RecurringPlanFormValues {
  customerId:             string; // numeric string or CUSTOMER_NONE
  propertyId:             string; // numeric string or PROPERTY_NONE
  name:                   string;
  status:                 string;
  frequencyType:          string;
  preferredDay:           string; // day string or "" for any
  preferredTime:          string; // time string or "" for any
  nextRunDate:            string;
  serviceType:            string; // SERVICE_TYPES value or SERVICE_NONE
  estimatedAmount:        string;
  defaultDurationMinutes: string;
  defaultServiceNotes:    string;
}

export interface RecurringPlanPayload {
  customerId:              number;
  propertyId?:             number;
  name:                    string;
  status:                  string;
  frequencyType:           string;
  intervalValue:           number;
  preferredDayOfWeek?:     string;
  preferredTimeWindow?:    string;
  nextRunDate?:            string;
  serviceType?:            string;
  estimatedAmount?:        string;
  defaultDurationMinutes?: number;
  defaultServiceNotes?:    string;
  autoGenerateJobs:        boolean;
}

/**
 * Converts raw form select values (including sentinels) into a clean API payload.
 *
 * Returns null when required fields are missing or still at their sentinel:
 *   - customerId must be a numeric string (not CUSTOMER_NONE)
 *   - name must be non-empty
 *   - frequencyType must be non-empty
 *
 * PROPERTY_NONE → propertyId omitted from payload (optional field).
 * SERVICE_NONE  → serviceType omitted from payload (optional field).
 */
export function buildRecurringPlanPayload(
  v: RecurringPlanFormValues,
): RecurringPlanPayload | null {
  if (!v.customerId || v.customerId === CUSTOMER_NONE) return null;
  if (!v.name.trim()) return null;
  if (!v.frequencyType) return null;

  return {
    customerId:             Number(v.customerId),
    propertyId:             v.propertyId && v.propertyId !== PROPERTY_NONE
                              ? Number(v.propertyId) : undefined,
    name:                   v.name,
    status:                 v.status,
    frequencyType:          v.frequencyType,
    intervalValue:          1,
    preferredDayOfWeek:     v.preferredDay  || undefined,
    preferredTimeWindow:    v.preferredTime || undefined,
    nextRunDate:            v.nextRunDate   || undefined,
    serviceType:            v.serviceType && v.serviceType !== SERVICE_NONE
                              ? v.serviceType : undefined,
    estimatedAmount:        v.estimatedAmount        || undefined,
    defaultDurationMinutes: v.defaultDurationMinutes
                              ? Number(v.defaultDurationMinutes) : undefined,
    defaultServiceNotes:    v.defaultServiceNotes    || undefined,
    autoGenerateJobs:       false,
  };
}
