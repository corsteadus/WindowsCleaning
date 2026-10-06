import { protectedFetch } from "./auth-scope.ts";
import type { CalendarTotalsResponse } from "./calendar-totals.ts";

// The totals shape and its arithmetic live in a module with no fetch and no
// `import.meta`, so they stay unit-testable. Re-exported here so callers keep
// a single import for the calendar's data contract.
export {
  sumDayTotals,
  totalsByDate,
  type CalendarDayTotal,
  type CalendarPeriodTotal,
  type CalendarTotalsResponse,
} from "./calendar-totals.ts";

/**
 * Client for the two bounded calendar reads.
 *
 * These are hand-written rather than generated because they are not in the
 * OpenAPI surface the client is generated from, and because the calendar's
 * contract is deliberately narrower than the job model: a card's worth of
 * fields, and day totals the server has already summed.
 *
 * Both calls require a window. There is no "fetch everything" form, by design.
 */

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface CalendarOccurrence {
  id: number;
  jobNumber: string;
  status: string;
  scheduledDate: string;
  startTime: string | null;
  endTime: string | null;
  serviceType: string | null;
  isRecurring: boolean;
  crewId: number | null;
  crewName: string | null;
  customerLabel: string;
  clientType: string | null;
  propertyLabel: string | null;
  /** Integer cents, or null when the viewer may not see amounts. */
  amountCents: number | null;
  invoiceStatus: string | null;
}

export interface CalendarOccurrencesResponse {
  range: { start: string; end: string };
  occurrences: CalendarOccurrence[];
  /** True when the window held more work than one read returns. */
  truncated: boolean;
  limit: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await protectedFetch(`${BASE}/api${path}`);
  if (!res.ok) {
    // Surface the server's wording — a refused window explains which rule it
    // broke (missing, malformed, reversed, too wide).
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* a non-JSON error body leaves the status text in place */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

function windowQuery(range: { start: string; end: string }): string {
  return `?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`;
}

export function fetchCalendarOccurrences(range: { start: string; end: string }) {
  return getJson<CalendarOccurrencesResponse>(`/calendar/occurrences${windowQuery(range)}`);
}

export function fetchCalendarTotals(range: { start: string; end: string }) {
  return getJson<CalendarTotalsResponse>(`/calendar/totals${windowQuery(range)}`);
}

/**
 * What this person left the calendar looking like (spec §11.6).
 *
 * Eighteen settings, of which the filters are the ones Step 3 uses. Nobody
 * else's preferences are reachable: the server reads the signed-in user.
 */
export interface CalendarPreferences {
  defaultView: "month" | "week" | "day";
  lastViewedDate: string | null;
  weekStartsOn: 0 | 1;
  showSunday: boolean;
  assignmentDisplay: "grouped" | "separate";
  showCompletedJobs: boolean;
  showInvoiceStatus: boolean;
  showHolidays: boolean;
  showEmployeeBirthdays: boolean;
  showJobCounts: boolean;
  showScheduledValue: boolean;
  showDurationTotals: boolean;
  colorMode: "assignment" | "event_type" | "customer_type" | "service_type";
  sidebarOpen: boolean;
  selectedAppointmentTypes: string[];
  selectedAssignments: string[];
  cardFields: string[];
  expandedSections: string[];
  sidebarOrder: string[];
}

/**
 * A day, or part of one, that work should not be booked on (spec V1 #12).
 *
 * Not a job: it lives in `calendar_events`, so it never reaches a day's job
 * count or its scheduled value (§11.4).
 */
export interface SchedulingBlock {
  id: number;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  scopeType: "company" | "crew" | "employee";
  crewId: number | null;
  userId: string | null;
  /** `hard` refuses a booking, `soft` warns (§7.15). */
  blockMode: "hard" | "soft";
  reason: string | null;
  isActive: boolean;
}

export interface CalendarBlocksResponse {
  range: { start: string; end: string };
  blocks: SchedulingBlock[];
}

export function fetchCalendarBlocks(range: { start: string; end: string }) {
  return getJson<CalendarBlocksResponse>(`/calendar/blocks${windowQuery(range)}`);
}

export async function createCalendarBlock(input: Record<string, unknown>): Promise<SchedulingBlock> {
  const res = await protectedFetch(`${BASE}/api/calendar/blocks`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? "The block could not be saved");
  return body as SchedulingBlock;
}

/** Lifting a block switches it off; the record of it stays. */
export async function liftCalendarBlock(id: number): Promise<SchedulingBlock> {
  const res = await protectedFetch(`${BASE}/api/calendar/blocks/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? "The block could not be lifted");
  return body as SchedulingBlock;
}

export function fetchCalendarPreferences() {
  return getJson<CalendarPreferences>("/calendar/preferences");
}

/** A partial change: only the settings named move. */
export async function saveCalendarPreferences(
  patch: Partial<CalendarPreferences>,
): Promise<CalendarPreferences> {
  const res = await protectedFetch(`${BASE}/api/calendar/preferences`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? "Could not save your calendar settings");
  return body as CalendarPreferences;
}
