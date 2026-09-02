import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/**
 * The shape of a month grid.
 *
 * A month view is not "the days of the month" — it is whole weeks, so it opens
 * on the weekday the week starts and closes on the weekday it ends, spilling
 * into the months on either side. Those spilled days are real drop targets:
 * moving a job from the 1st to the previous month's 30th should not require
 * navigating away first.
 *
 * Every date here is a date-only string. That is the type the API takes, the
 * type the `scheduled_date` column stores, and the only representation that
 * survives a timezone without shifting by a day.
 */

/** 0 = Sunday, 1 = Monday. The two starts the calendar offers. */
export type WeekStart = 0 | 1;

/**
 * Weeks begin on Monday unless a user says otherwise.
 *
 * Named rather than inlined so the eventual per-user preference has one place
 * to override, and so no calendar maths hard-codes a literal.
 */
export const DEFAULT_WEEK_START: WeekStart = 1;

export type GridDay = {
  /** "YYYY-MM-DD" — the key totals and occurrences are matched on. */
  date: string;
  dayOfMonth: number;
  /** False for the days spilled in from the neighbouring months. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
};

export type GridWeek = {
  /** Date of the week's first day, usable as a stable React key. */
  key: string;
  days: GridDay[];
};

export type MonthGrid = {
  year: number;
  /** 0-indexed, matching Date#getMonth. */
  month: number;
  weeks: GridWeek[];
  /** Inclusive bounds of every day drawn — exactly what to ask the API for. */
  range: { start: string; end: string };
};

export function toDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Builds the grid for a month.
 *
 * `today` is injected rather than read from the clock so the caller controls
 * it and tests are not time-dependent.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  options: { weekStartsOn?: WeekStart; today?: Date } = {},
): MonthGrid {
  const weekStartsOn = options.weekStartsOn ?? DEFAULT_WEEK_START;
  const todayKey = toDateKey(options.today ?? new Date());

  const firstOfMonth = startOfMonth(new Date(year, month, 1));
  const gridStart = startOfWeek(firstOfMonth, { weekStartsOn });
  const gridEnd = endOfWeek(endOfMonth(firstOfMonth), { weekStartsOn });

  const weeks: GridWeek[] = [];
  let cursor = gridStart;

  while (cursor <= gridEnd) {
    const days: GridDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(cursor, i);
      const weekday = day.getDay();
      days.push({
        date: toDateKey(day),
        dayOfMonth: day.getDate(),
        inMonth: day.getMonth() === month && day.getFullYear() === year,
        isToday: toDateKey(day) === todayKey,
        isWeekend: weekday === 0 || weekday === 6,
      });
    }
    weeks.push({ key: days[0].date, days });
    cursor = addDays(cursor, 7);
  }

  return {
    year,
    month,
    weeks,
    range: { start: weeks[0].days[0].date, end: weeks[weeks.length - 1].days[6].date },
  };
}

/** Weekday headings in the order the grid draws them. */
export function weekdayLabels(weekStartsOn: WeekStart = DEFAULT_WEEK_START): string[] {
  const base = startOfWeek(new Date(2026, 0, 4), { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => format(addDays(base, i), "EEE"));
}

/** Steps a year/month pair without letting the month index escape 0–11. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const absolute = year * 12 + month + delta;
  return { year: Math.floor(absolute / 12), month: ((absolute % 12) + 12) % 12 };
}

/**
 * Groups occurrences by day.
 *
 * Built once per fetch rather than filtered per cell: a six-week grid is 42
 * cells, and filtering the whole list in each of them turns one pass into 42.
 */
export function bucketByDate<T extends { scheduledDate?: string | null }>(
  items: readonly T[],
): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = item.scheduledDate;
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return buckets;
}

/** Money arrives as integer cents and is only ever divided for display. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

/** Minutes to a compact "6h", "6h 30m", "45m" reading. */
export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
