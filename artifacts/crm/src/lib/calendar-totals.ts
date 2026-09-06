/**
 * The arithmetic behind the calendar's footers and summary.
 *
 * Kept apart from `calendar-api.ts` because that module reads
 * `import.meta.env` and performs fetches, neither of which exists outside a
 * browser build. Everything here is a pure function over a response the caller
 * already holds, so it can be tested without a server or a DOM.
 */

export interface CalendarDayTotal {
  date: string;
  jobCount: number;
  completedCount: number;
  scheduledValueCents: number | null;
  durationMinutes: number;
}

export interface CalendarPeriodTotal {
  jobCount: number;
  completedCount: number;
  scheduledValueCents: number | null;
  durationMinutes: number;
}

export interface CalendarTotalsResponse {
  range: { start: string; end: string };
  days: CalendarDayTotal[];
  period: CalendarPeriodTotal;
}

/** Day totals keyed by date, so a cell reads its own without scanning. */
export function totalsByDate(
  totals: CalendarTotalsResponse | undefined,
): Map<string, CalendarDayTotal> {
  const map = new Map<string, CalendarDayTotal>();
  for (const day of totals?.days ?? []) map.set(day.date, day);
  return map;
}

/**
 * Roll up only the days asked for.
 *
 * The response's own `period` covers the whole requested window. A month grid
 * asks for the whole grid, spilled neighbouring days included, so using
 * `period` for a monthly figure counts work belonging to the month either
 * side — and counts it twice over, since a spilled day appears in both
 * months' grids. Passing the in-month dates gives the month its own total.
 *
 * The arithmetic deliberately mirrors the server's roll-up in
 * `routes/calendar.ts`, which is itself a plain sum over the same day rows, so
 * a narrower window is the only difference. A null `scheduledValueCents` means
 * the viewer may not see amounts, and stays null rather than summing to zero.
 *
 * Returns undefined before the first response, so a figure nobody knows yet
 * reads as "—" rather than a confident zero.
 */
export function sumDayTotals(
  totals: CalendarTotalsResponse | undefined,
  includes: (date: string) => boolean,
): CalendarPeriodTotal | undefined {
  if (!totals) return undefined;
  const amountsHidden = totals.period.scheduledValueCents === null;
  const summed: CalendarPeriodTotal = {
    jobCount: 0,
    completedCount: 0,
    scheduledValueCents: amountsHidden ? null : 0,
    durationMinutes: 0,
  };
  for (const day of totals.days) {
    if (!includes(day.date)) continue;
    summed.jobCount += day.jobCount;
    summed.completedCount += day.completedCount;
    summed.durationMinutes += day.durationMinutes;
    if (day.scheduledValueCents !== null && !amountsHidden) {
      summed.scheduledValueCents = (summed.scheduledValueCents ?? 0) + day.scheduledValueCents;
    }
  }
  return summed;
}
