import { protectedFetch } from "./auth-scope.ts";

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

export interface CalendarDayTotal {
  date: string;
  jobCount: number;
  completedCount: number;
  scheduledValueCents: number | null;
  durationMinutes: number;
}

export interface CalendarTotalsResponse {
  range: { start: string; end: string };
  days: CalendarDayTotal[];
  period: {
    jobCount: number;
    completedCount: number;
    scheduledValueCents: number | null;
    durationMinutes: number;
  };
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

/** Day totals keyed by date, so a cell reads its own without scanning. */
export function totalsByDate(
  totals: CalendarTotalsResponse | undefined,
): Map<string, CalendarDayTotal> {
  const map = new Map<string, CalendarDayTotal>();
  for (const day of totals?.days ?? []) map.set(day.date, day);
  return map;
}
