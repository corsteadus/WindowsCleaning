/**
 * Crew double-booking detection.
 *
 * The spec asks for a warning here, not a refusal: an office sometimes
 * genuinely wants two jobs on one crew — a quick add-on, a job that will run
 * short — and only the scheduler knows. So this reports the clash and lets
 * the person decide, rather than deciding for them.
 *
 * The check runs against the day the job is being dropped on, which the grid
 * already holds in memory. No extra read, and none needed: you can only drop
 * on a day that is currently painted.
 */

export type OverlapCandidate = {
  id: number;
  crewId: number | null;
  startTime: string | null;
  endTime: string | null;
  customerLabel: string;
};

/** "HH:mm" or "HH:mm:ss" to minutes past midnight; null when unusable. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The span a job occupies.
 *
 * A job with a start but no end is treated as a moment rather than a
 * guessed duration: two jobs starting at nine clash, but a nine o'clock job
 * of unknown length is not assumed to run into the eleven o'clock one.
 */
function span(job: OverlapCandidate): { from: number; to: number } | null {
  const from = timeToMinutes(job.startTime);
  if (from === null) return null;
  const to = timeToMinutes(job.endTime);
  return { from, to: to === null || to < from ? from : to };
}

/**
 * Half-open comparison: a job ending at 11:00 and one starting at 11:00 are
 * back-to-back, not overlapping. Two zero-length jobs at the same minute do
 * clash, which the equality case covers.
 */
function spansOverlap(
  a: { from: number; to: number },
  b: { from: number; to: number },
): boolean {
  if (a.from === a.to && b.from === b.to) return a.from === b.from;
  return a.from < b.to && b.from < a.to;
}

/**
 * Jobs already on the target day that would double-book the moving job's crew.
 *
 * Unassigned work never clashes: there is no crew to be in two places at once,
 * and warning about it would train the office to dismiss the warning.
 */
export function findCrewOverlaps<T extends OverlapCandidate>(
  moving: OverlapCandidate,
  dayOccurrences: readonly T[],
): T[] {
  if (moving.crewId === null || moving.crewId === undefined) return [];
  const movingSpan = span(moving);
  // A job with no time at all is not placed in the day, so it cannot clash
  // by time. Capacity limits are a separate rule.
  if (!movingSpan) return [];

  return dayOccurrences.filter((other) => {
    if (other.id === moving.id) return false;
    if (other.crewId !== moving.crewId) return false;
    const otherSpan = span(other);
    if (!otherSpan) return false;
    return spansOverlap(movingSpan, otherSpan);
  });
}

/** "9:00 am – 11:00 am", or "No time" when the job carries none. */
export function describeSpan(job: OverlapCandidate): string {
  const from = timeToMinutes(job.startTime);
  if (from === null) return "No time";
  const to = timeToMinutes(job.endTime);
  const label = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const ampm = h >= 12 ? "pm" : "am";
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
  };
  return to === null || to === from ? label(from) : `${label(from)} – ${label(to)}`;
}
