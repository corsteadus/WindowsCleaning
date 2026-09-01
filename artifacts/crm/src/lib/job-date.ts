import { format } from "date-fns";

/**
 * Client-side business-date helpers for job scheduling UI.
 *
 * Mirrors the logic in the API server's lib/date.ts so the UI and API
 * agree on what "today" means.  Uses toLocaleDateString("en-CA") which
 * produces YYYY-MM-DD in the *browser's* local timezone — matching what
 * the user sees in their calendar.
 *
 * An optional `today` argument makes both functions testable without mocking.
 */

/**
 * Returns the current local date as "YYYY-MM-DD" (browser timezone).
 */
export function todayDateStr(): string {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Returns true when `scheduledDate` is strictly after `today`.
 * Both must be "YYYY-MM-DD" — lexicographic comparison is correct for
 * ISO-8601 date-only strings.
 *
 * @param scheduledDate  The job's scheduledDate field (string | null | undefined).
 * @param today          Defaults to todayDateStr(). Pass a fixed string in tests.
 */
export function isJobScheduledInFuture(
  scheduledDate: string | null | undefined,
  today: string = todayDateStr(),
): boolean {
  if (!scheduledDate) return false;
  return scheduledDate > today;
}

function parseLocalDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    ? date
    : null;
}

export function formatJobDateOnly(
  value: string | null | undefined,
  pattern: string,
  fallback = "Not scheduled",
): string {
  if (!value) return fallback;
  const date = parseLocalDateOnly(value);
  return date ? format(date, pattern) : value;
}
