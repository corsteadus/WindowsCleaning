import { isDateOnly } from "./date.ts";

/**
 * Calendar reads are always bounded.
 *
 * The office calendar never asks for "all jobs" — it asks for exactly the
 * window it is about to paint. A month grid is at most six weeks (42 days),
 * and we allow a little headroom so a caller can prefetch an adjacent edge
 * without a second round trip. Anything larger is a caller bug, not a
 * legitimate view, and is rejected rather than silently served.
 */
export const MAX_CALENDAR_RANGE_DAYS = 62;

/**
 * Row ceiling for a single occurrences read.
 *
 * A bounded range still has an unbounded number of jobs inside it, so the
 * range cap alone does not bound memory. This ceiling keeps one response
 * predictable in size; when it is hit the response says so instead of
 * quietly dropping work off the end of the calendar.
 */
export const MAX_CALENDAR_OCCURRENCES = 2000;

export type CalendarRange = {
  start: string;
  end: string;
  days: number;
};

export type CalendarRangeError =
  | "missing"
  | "malformed"
  | "reversed"
  | "too_wide";

export type CalendarRangeResult =
  | { ok: true; range: CalendarRange }
  | { ok: false; error: CalendarRangeError; message: string };

/** Inclusive day count between two date-only strings. */
export function inclusiveDayCount(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

/**
 * Validates a caller-supplied calendar window.
 *
 * Returns a discriminated result rather than throwing so the route can map
 * each failure to its own message without a try/catch around request parsing.
 */
export function parseCalendarRange(
  start: unknown,
  end: unknown,
  maxDays: number = MAX_CALENDAR_RANGE_DAYS,
): CalendarRangeResult {
  if (start === undefined || end === undefined || start === "" || end === "") {
    return {
      ok: false,
      error: "missing",
      message: "start and end are required (YYYY-MM-DD)",
    };
  }

  if (!isDateOnly(start) || !isDateOnly(end)) {
    return {
      ok: false,
      error: "malformed",
      message: "start and end must be calendar dates in YYYY-MM-DD form",
    };
  }

  if (start > end) {
    return {
      ok: false,
      error: "reversed",
      message: "start must not be after end",
    };
  }

  const days = inclusiveDayCount(start, end);
  if (days > maxDays) {
    return {
      ok: false,
      error: "too_wide",
      message: `range must not exceed ${maxDays} days (received ${days})`,
    };
  }

  return { ok: true, range: { start, end, days } };
}
