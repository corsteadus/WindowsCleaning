/**
 * A time of day, the way Corstead asks for it and the way it reads it back.
 *
 * Kyle (Testing Edits, 2026-10-01, #14): *"Anywhere Corstead asks the user to
 * select a time, use 15-minute increments rather than arbitrary minute-by-minute
 * selection. Each hour should offer :00, :15, :30, and :45. Use standard AM / PM
 * formatting. Apply this consistently to estimate appointment start/end times
 * and other scheduling screens throughout the platform."*
 *
 * The stored value does not change: the API takes `HH:mm` on a 24-hour clock,
 * and that is what every one of these functions reads and writes. What changes
 * is that a person now picks from a list and reads "8:15 AM".
 *
 * Three screens had grown their own `fmtTime`, each producing "8:15am". This is
 * the one that replaces them.
 */

/** The four minutes past each hour that Kyle named. */
export const QUARTER_HOUR_MINUTES: readonly number[] = [0, 15, 30, 45];
export const MINUTES_PER_STEP = 15;

const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

export interface TimeOption {
  /** `HH:mm`, as stored. */
  value: string;
  /** "8:15 AM", as read. */
  label: string;
  /**
   * True for a time already on a record that is not on the quarter-hour grid,
   * so editing something booked at 8:20 does not silently move it.
   */
  offGrid?: boolean;
}

/** `HH:mm` and the minutes since midnight, or null if it is not a time. */
export function parseTimeOfDay(value: string | null | undefined): { hours: number; minutes: number } | null {
  if (!value) return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/** The canonical `HH:mm` for a value the server may have sent as `HH:mm:ss`. */
export function toTimeValue(value: string | null | undefined): string {
  const parsed = parseTimeOfDay(value);
  if (!parsed) return "";
  return `${String(parsed.hours).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")}`;
}

/** "8:15 AM". Empty string for anything that is not a time. */
export function formatTimeOfDay(value: string | null | undefined): string {
  const parsed = parseTimeOfDay(value);
  if (!parsed) return "";
  const suffix = parsed.hours >= 12 ? "PM" : "AM";
  const hour = parsed.hours % 12 || 12;
  return `${hour}:${String(parsed.minutes).padStart(2, "0")} ${suffix}`;
}

/** "8:15 AM – 10:00 AM", or just the one end that is known. */
export function formatTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const from = formatTimeOfDay(start);
  const to = formatTimeOfDay(end);
  if (from && to) return `${from} – ${to}`;
  return from || to;
}

export function isQuarterHour(value: string | null | undefined): boolean {
  const parsed = parseTimeOfDay(value);
  return parsed !== null && QUARTER_HOUR_MINUTES.includes(parsed.minutes);
}

/**
 * The nearest quarter hour. Half past the step rounds up, and a time in the
 * last eight minutes of the day stays inside it rather than becoming tomorrow.
 */
export function snapToQuarterHour(value: string | null | undefined): string {
  const parsed = parseTimeOfDay(value);
  if (!parsed) return "";
  const total = parsed.hours * 60 + parsed.minutes;
  const snapped = Math.min(Math.round(total / MINUTES_PER_STEP) * MINUTES_PER_STEP, 23 * 60 + 45);
  return `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`;
}

/** Every quarter hour of the day: 00:00 through 23:45, ninety-six of them. */
export function quarterHourTimes(): string[] {
  const times: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of QUARTER_HOUR_MINUTES) {
      times.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }
  return times;
}

/**
 * What a time selector offers. The grid, plus the record's own time when that
 * was booked off-grid before this existed — losing somebody's 8:20 appointment
 * by opening a form would be worse than offering one odd choice.
 */
export function timeSelectOptions(current?: string | null): TimeOption[] {
  const options: TimeOption[] = quarterHourTimes().map((value) => ({
    value, label: formatTimeOfDay(value),
  }));
  const existing = toTimeValue(current);
  if (existing && !isQuarterHour(existing)) {
    const minutes = parseTimeOfDay(existing)!;
    const total = minutes.hours * 60 + minutes.minutes;
    const at = options.findIndex((option) => {
      const parsed = parseTimeOfDay(option.value)!;
      return parsed.hours * 60 + parsed.minutes > total;
    });
    const odd: TimeOption = { value: existing, label: `${formatTimeOfDay(existing)} (as booked)`, offGrid: true };
    options.splice(at === -1 ? options.length : at, 0, odd);
  }
  return options;
}
