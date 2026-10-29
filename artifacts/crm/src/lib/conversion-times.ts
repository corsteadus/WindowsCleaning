/**
 * A4 (Video 7): scheduling an accepted estimate by how long the work takes, with
 * the customer told an exact time or an arrival window ("between 9 and 11").
 * The server checks the same limits and works out the end itself.
 */
import { formatTimeOfDay } from "./time-of-day.ts";

export type ArrivalMode = "exact" | "window";

export const DURATION_OPTIONS: readonly number[] = [30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720];
export const WINDOW_OPTIONS: readonly number[] = [60, 120, 180, 240];
export const DEFAULT_DURATION = 120;
export const DEFAULT_WINDOW = 120;

/** "2 hours", "1 hour 30 min", "45 min". */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} ${h === 1 ? "hour" : "hours"}` : "";
  return [hours, m ? `${m} min` : ""].filter(Boolean).join(" ") || "0 min";
}

/** `HH:mm` plus some minutes, or null when it would run past midnight. */
export function addMinutes(time: string, minutes: number): string | null {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
  if (total > 24 * 60 - 1) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** What the office will tell the customer, in one line. */
export function arrivalSummary(start: string, mode: ArrivalMode, windowMinutes: number, durationMinutes: number): string {
  const work = minutesLabel(durationMinutes);
  if (mode === "window") {
    const close = addMinutes(start, windowMinutes);
    return close
      ? `Arrive between ${formatTimeOfDay(start)} and ${formatTimeOfDay(close)} · about ${work} of work`
      : "The arrival window runs past midnight";
  }
  const end = addMinutes(start, durationMinutes);
  return end ? `Arrive at ${formatTimeOfDay(start)} · done about ${formatTimeOfDay(end)}` : "The work runs past midnight";
}
