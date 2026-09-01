/**
 * Business-date helpers for the API server.
 *
 * `scheduledDate` is stored as a date-only string (YYYY-MM-DD).
 * Comparisons must use the same calendar-date convention to avoid UTC
 * off-by-one issues (e.g. 8 pm US/Eastern is already the next UTC day).
 *
 * America/Chicago is the authoritative business timezone. Date-only values are
 * opaque calendar values and must never be interpreted in the process timezone.
 *
 * An optional `now` argument makes every function deterministic in tests.
 */

/**
 * Returns the current business date as "YYYY-MM-DD" in the process timezone.
 */
export function businessDateStr(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/** Add calendar days to an opaque YYYY-MM-DD value without timezone conversion. */
export function addDaysToDateOnly(value: string, days: number): string {
  if (!isDateOnly(value) || !Number.isInteger(days)) throw new Error("Invalid date-only arithmetic");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

/** Strict calendar validation; Date parsing alone accepts rollover dates. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

/** 24-hour HH:mm or HH:mm:ss, stored exactly as supplied. */
export function isTimeOnly(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

/** Validate an API date-time and return its canonical UTC ISO instant. */
export function canonicalIsoInstant(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? null : instant.toISOString();
}

/**
 * Returns true when `scheduledDate` is strictly after `today`.
 * Both arguments must be "YYYY-MM-DD" strings (ISO-8601 date-only).
 * Lexicographic comparison is correct for this format.
 *
 * @param scheduledDate  The job's scheduled date string, or null/undefined.
 * @param today          Defaults to businessDateStr(). Pass a fixed string in tests.
 */
export function isScheduledInFuture(
  scheduledDate: string | null | undefined,
  today: string = businessDateStr(),
): boolean {
  if (!scheduledDate) return false;
  return scheduledDate > today;
}

export type JobStatusUpdate =
  | { kind: "future"; scheduledDate: string; today: string }
  | { kind: "updated"; status: string; completedAt: string | null };

/**
 * Builds the status/completion fields used by PATCH /jobs/:id.
 *
 * Keeping the date guard and completedAt transition here makes the lifecycle
 * rule reusable by the critical-path domain test without requiring a database.
 */
export function buildJobStatusUpdate(
  status: string,
  scheduledDate: string | null | undefined,
  now: Date = new Date(),
): JobStatusUpdate {
  const today = businessDateStr(now);
  if ((status === "completed" || status === "in_progress") && isScheduledInFuture(scheduledDate, today)) {
    return { kind: "future", scheduledDate: scheduledDate!, today };
  }

  return {
    kind: "updated",
    status,
    completedAt: status === "completed" ? now.toISOString() : null,
  };
}
