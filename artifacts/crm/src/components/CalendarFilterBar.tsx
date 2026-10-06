/**
 * Showing part of the calendar, and remembering it.
 *
 * Spec Step 3 (filters) and §11.6 (eighteen settings persisted per user). The
 * audit of 2026-09-04 recorded the cost of the latter: *"Every filter and
 * display setting resets on reload."*
 *
 * Two filters to begin with, because they are the two the month grid can
 * answer honestly today: which assignment, and whether finished work is still
 * on screen. Each one saves as it is clicked — there is no Save button to
 * forget, and a filter that does not survive a reload is barely a filter.
 */
import { Filter, Loader2, X } from "lucide-react";
import {
  type AssignmentOption,
  type CalendarFilterState,
  NO_CALENDAR_FILTERS,
  isFiltering,
  toggleAssignment,
} from "@/lib/calendar-filters";

export function CalendarFilterBar({
  options, state, onChange, hiddenCount, saving, disabled,
}: {
  options: AssignmentOption[];
  state: CalendarFilterState;
  onChange: (next: CalendarFilterState) => void;
  /** How many cards this month the filters are keeping off screen. */
  hiddenCount: number;
  saving?: boolean;
  disabled?: boolean;
}) {
  const filtering = isFiltering(state);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="calendar-filters">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <Filter className="h-3.5 w-3.5" />
        Show
      </span>

      {/* ── assignment ──────────────────────────────────────────────── */}
      {options.length === 0 ? (
        <span className="text-xs text-slate-400">Nothing booked this month</span>
      ) : (
        options.map((option) => {
          const on = state.selectedAssignments.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange(toggleAssignment(state, option.key))}
              className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:opacity-50
                ${on
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
            >
              {option.label}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${on ? "bg-white/20" : "bg-slate-100"}`}>
                {option.count}
              </span>
            </button>
          );
        })
      )}

      <span className="mx-1 h-5 w-px self-center bg-slate-200" />

      {/* ── finished work ───────────────────────────────────────────── */}
      <button
        type="button"
        disabled={disabled}
        aria-pressed={state.showCompletedJobs}
        onClick={() => onChange({ ...state, showCompletedJobs: !state.showCompletedJobs })}
        className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:opacity-50
          ${state.showCompletedJobs
            ? "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            : "border-slate-900 bg-slate-900 text-white"}`}
      >
        {state.showCompletedJobs ? "Completed shown" : "Completed hidden"}
      </button>

      {filtering && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(NO_CALENDAR_FILTERS)}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px]
                     font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          <X className="h-3 w-3" />
          Show everything
        </button>
      )}

      {/* What a filter is keeping off screen, said plainly rather than left to
          be noticed as an unexplained gap in the month. */}
      {hiddenCount > 0 && (
        <span className="text-[11px] text-amber-700" data-testid="calendar-hidden-count">
          {hiddenCount} {hiddenCount === 1 ? "job is" : "jobs are"} hidden by these filters
        </span>
      )}

      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-label="Saving your calendar settings" />}
    </div>
  );
}
