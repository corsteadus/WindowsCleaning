/**
 * Showing part of the calendar.
 *
 * Spec Step 3: filters, remembered per user (§11.6). The audit of 2026-09-04
 * recorded what their absence costs — *"Every filter and display setting resets
 * on reload"* — so what a person picks here is saved through
 * `/calendar/preferences` and comes back tomorrow.
 *
 * **An empty selection means everything.** A filter nobody has touched must
 * never hide work; that is the difference between a calendar with a filter and
 * a calendar that lies about what is booked.
 *
 * The totals are recomputed from the filtered cards rather than taken from the
 * server's figures for the whole month, because a footer that counts eleven
 * jobs above a cell showing three is the kind of disagreement nobody trusts
 * again. The server's figures are still used when nothing is filtered — they
 * are aggregated in the database and cost the same whatever the month holds.
 */
import type { CalendarOccurrence } from "@/lib/calendar-api";
import type { CalendarDayTotal, CalendarTotalsResponse } from "@/lib/calendar-totals";

export const UNASSIGNED = "unassigned";

export interface CalendarFilterState {
  /** `crew-<id>` and `unassigned`. Empty means every assignment. */
  selectedAssignments: string[];
  /** Spec §11.6 keeps this as its own setting, not as part of the list. */
  showCompletedJobs: boolean;
}

export const NO_CALENDAR_FILTERS: CalendarFilterState = {
  selectedAssignments: [],
  showCompletedJobs: true,
};

/** Which assignment a card belongs to, for grouping and for filtering. */
export function assignmentKey(occurrence: Pick<CalendarOccurrence, "crewId">): string {
  return occurrence.crewId === null || occurrence.crewId === undefined
    ? UNASSIGNED
    : `crew-${occurrence.crewId}`;
}

export interface AssignmentOption {
  key: string;
  label: string;
  /** How many cards in the window belong to it, before any filtering. */
  count: number;
}

/**
 * The assignments worth offering: the ones actually on this month's cards.
 * Offering every crew that ever existed would make the list long and most of it
 * useless; a crew with nothing booked is not a filter anybody needs.
 */
export function assignmentOptions(
  occurrences: ReadonlyArray<CalendarOccurrence>,
): AssignmentOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const occurrence of occurrences) {
    const key = assignmentKey(occurrence);
    const label = key === UNASSIGNED ? "Unassigned" : (occurrence.crewName ?? `Crew #${occurrence.crewId}`);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: value.label, count: value.count }))
    // Named crews first, alphabetically; Unassigned last, where it reads as the
    // leftovers it is.
    .sort((a, b) => {
      if (a.key === UNASSIGNED) return 1;
      if (b.key === UNASSIGNED) return -1;
      return a.label.localeCompare(b.label);
    });
}

export function matchesCalendarFilters(
  occurrence: CalendarOccurrence,
  state: CalendarFilterState,
): boolean {
  if (!state.showCompletedJobs && occurrence.status === "completed") return false;
  if (state.selectedAssignments.length === 0) return true;
  return state.selectedAssignments.includes(assignmentKey(occurrence));
}

export function filterOccurrences(
  occurrences: ReadonlyArray<CalendarOccurrence>,
  state: CalendarFilterState,
): CalendarOccurrence[] {
  return occurrences.filter((occurrence) => matchesCalendarFilters(occurrence, state));
}

export function isFiltering(state: CalendarFilterState): boolean {
  return state.selectedAssignments.length > 0 || !state.showCompletedJobs;
}

/** Ticking an assignment on or off, without mutating what was passed in. */
export function toggleAssignment(state: CalendarFilterState, key: string): CalendarFilterState {
  const selected = state.selectedAssignments.includes(key)
    ? state.selectedAssignments.filter((item) => item !== key)
    : [...state.selectedAssignments, key];
  return { ...state, selectedAssignments: selected };
}

/** Minutes between two `HH:mm` times, or 0 when either is missing. */
function minutesBetween(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  return minutes > 0 ? minutes : 0;
}

/**
 * Day totals built from the cards on screen.
 *
 * `amountsHidden` carries through what the server already decided: a field
 * technician is not shown money, and a null must stay null rather than summing
 * to a confident zero.
 */
export function totalsFromOccurrences(
  occurrences: ReadonlyArray<CalendarOccurrence>,
  options: { amountsHidden: boolean },
): Map<string, CalendarDayTotal> {
  const byDate = new Map<string, CalendarDayTotal>();
  for (const occurrence of occurrences) {
    const date = occurrence.scheduledDate;
    if (!date) continue;
    const day = byDate.get(date) ?? {
      date,
      jobCount: 0,
      completedCount: 0,
      scheduledValueCents: options.amountsHidden ? null : 0,
      durationMinutes: 0,
    };
    day.jobCount += 1;
    if (occurrence.status === "completed") day.completedCount += 1;
    if (!options.amountsHidden && occurrence.amountCents !== null && occurrence.amountCents !== undefined) {
      day.scheduledValueCents = (day.scheduledValueCents ?? 0) + occurrence.amountCents;
    }
    day.durationMinutes += minutesBetween(occurrence.startTime, occurrence.endTime);
    byDate.set(date, day);
  }
  return byDate;
}

/** Whether the server's own totals may be used, or the cards must be counted. */
export function amountsAreHidden(totals: CalendarTotalsResponse | undefined): boolean {
  return totals?.period.scheduledValueCents === null;
}
