/**
 * What each person left the calendar looking like.
 *
 * Spec §11.6 lists eighteen settings to remember per user, and the audit of
 * 2026-09-04 recorded the cost of not having them: *"Every filter and display
 * setting resets on reload."* The table has existed since Step 1 (`a8a245e`);
 * nothing read or wrote it until now.
 *
 * Thirteen settings are single values with a column each. The other five are
 * lists — which appointment types are ticked, which assignments are selected,
 * which card fields are shown, which sidebar sections are open, and the sidebar
 * order — and live together in `list_settings`.
 *
 * Every rule here mirrors a check constraint on the table. That is deliberate:
 * a value the database would refuse comes back as a 400 saying which setting is
 * wrong, rather than a 500 from a constraint nobody sees.
 */

export const CALENDAR_VIEWS = ["month", "week", "day"] as const;
export const ASSIGNMENT_DISPLAYS = ["grouped", "separate"] as const;
export const COLOR_MODES = ["assignment", "event_type", "customer_type", "service_type"] as const;

export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export type AssignmentDisplay = (typeof ASSIGNMENT_DISPLAYS)[number];
export type ColorMode = (typeof COLOR_MODES)[number];

/** The five list-shaped settings, kept together in `list_settings`. */
export const LIST_SETTINGS = [
  "selectedAppointmentTypes",
  "selectedAssignments",
  "cardFields",
  "expandedSections",
  "sidebarOrder",
] as const;
export type ListSetting = (typeof LIST_SETTINGS)[number];

export interface CalendarPreferences {
  defaultView: CalendarView;
  lastViewedDate: string | null;
  weekStartsOn: 0 | 1;
  showSunday: boolean;
  assignmentDisplay: AssignmentDisplay;
  showCompletedJobs: boolean;
  showInvoiceStatus: boolean;
  showHolidays: boolean;
  showEmployeeBirthdays: boolean;
  showJobCounts: boolean;
  showScheduledValue: boolean;
  showDurationTotals: boolean;
  colorMode: ColorMode;
  sidebarOpen: boolean;
  selectedAppointmentTypes: string[];
  selectedAssignments: string[];
  cardFields: string[];
  expandedSections: string[];
  sidebarOrder: string[];
}

/**
 * What somebody who has never changed anything sees.
 *
 * An **empty** `selectedAssignments` means "everything", not "nothing" — a
 * filter nobody has touched must never hide work. The same goes for the
 * appointment types.
 */
export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  defaultView: "month",
  lastViewedDate: null,
  weekStartsOn: 1,
  showSunday: true,
  assignmentDisplay: "grouped",
  showCompletedJobs: true,
  showInvoiceStatus: true,
  showHolidays: true,
  showEmployeeBirthdays: false,
  showJobCounts: true,
  showScheduledValue: true,
  showDurationTotals: false,
  colorMode: "assignment",
  sidebarOpen: true,
  selectedAppointmentTypes: [],
  selectedAssignments: [],
  cardFields: [],
  expandedSections: [],
  sidebarOrder: [],
};

const BOOLEANS = [
  "showSunday", "showCompletedJobs", "showInvoiceStatus", "showHolidays",
  "showEmployeeBirthdays", "showJobCounts", "showScheduledValue",
  "showDurationTotals", "sidebarOpen",
] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type MergeResult =
  | { ok: true; values: CalendarPreferences }
  | { ok: false; error: string };

/** A list of short, non-empty strings, de-duplicated and kept in the order given. */
function normaliseList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed === "" || trimmed.length > 64) return null;
    if (!seen.includes(trimmed)) seen.push(trimmed);
  }
  return seen.length > 200 ? null : seen;
}

/**
 * Applies a partial change to what is stored. Only the settings named in the
 * patch move; anything else keeps its value, so a screen that knows about one
 * setting cannot reset the seventeen it has never heard of.
 */
export function mergeCalendarPreferences(
  current: CalendarPreferences,
  patch: Record<string, unknown>,
): MergeResult {
  const next: CalendarPreferences = { ...current };

  if ("defaultView" in patch) {
    if (!CALENDAR_VIEWS.includes(patch.defaultView as CalendarView)) {
      return { ok: false, error: `defaultView must be one of ${CALENDAR_VIEWS.join(", ")}` };
    }
    next.defaultView = patch.defaultView as CalendarView;
  }
  if ("lastViewedDate" in patch) {
    const value = patch.lastViewedDate;
    if (value === null) next.lastViewedDate = null;
    else if (typeof value === "string" && DATE_ONLY.test(value)) next.lastViewedDate = value;
    else return { ok: false, error: "lastViewedDate must be a YYYY-MM-DD date or null" };
  }
  if ("weekStartsOn" in patch) {
    if (patch.weekStartsOn !== 0 && patch.weekStartsOn !== 1) {
      return { ok: false, error: "weekStartsOn must be 0 (Sunday) or 1 (Monday)" };
    }
    next.weekStartsOn = patch.weekStartsOn;
  }
  if ("assignmentDisplay" in patch) {
    if (!ASSIGNMENT_DISPLAYS.includes(patch.assignmentDisplay as AssignmentDisplay)) {
      return { ok: false, error: `assignmentDisplay must be one of ${ASSIGNMENT_DISPLAYS.join(", ")}` };
    }
    next.assignmentDisplay = patch.assignmentDisplay as AssignmentDisplay;
  }
  if ("colorMode" in patch) {
    if (!COLOR_MODES.includes(patch.colorMode as ColorMode)) {
      return { ok: false, error: `colorMode must be one of ${COLOR_MODES.join(", ")}` };
    }
    next.colorMode = patch.colorMode as ColorMode;
  }
  for (const key of BOOLEANS) {
    if (key in patch) {
      if (typeof patch[key] !== "boolean") return { ok: false, error: `${key} must be true or false` };
      next[key] = patch[key] as boolean;
    }
  }
  for (const key of LIST_SETTINGS) {
    if (key in patch) {
      const list = normaliseList(patch[key]);
      if (list === null) return { ok: false, error: `${key} must be a list of short text values` };
      next[key] = list;
    }
  }
  return { ok: true, values: next };
}

/** The shape the table holds: thirteen columns plus one jsonb object. */
export function toStoredRow(values: CalendarPreferences): {
  columns: Omit<CalendarPreferences, ListSetting>;
  listSettings: Record<ListSetting, string[]>;
} {
  const { selectedAppointmentTypes, selectedAssignments, cardFields, expandedSections, sidebarOrder, ...columns } = values;
  return {
    columns,
    listSettings: { selectedAppointmentTypes, selectedAssignments, cardFields, expandedSections, sidebarOrder },
  };
}

/** What a stored row means, with anything missing or damaged falling back. */
export function fromStoredRow(row: Record<string, unknown> | null | undefined): CalendarPreferences {
  if (!row) return { ...DEFAULT_CALENDAR_PREFERENCES };
  const stored = (row.listSettings ?? {}) as Record<string, unknown>;
  const lists = {} as Record<ListSetting, string[]>;
  for (const key of LIST_SETTINGS) {
    lists[key] = normaliseList(stored[key]) ?? [...DEFAULT_CALENDAR_PREFERENCES[key]];
  }
  const merged = mergeCalendarPreferences({ ...DEFAULT_CALENDAR_PREFERENCES, ...lists }, {
    defaultView: row.defaultView,
    lastViewedDate: row.lastViewedDate ?? null,
    weekStartsOn: row.weekStartsOn,
    assignmentDisplay: row.assignmentDisplay,
    colorMode: row.colorMode,
    ...Object.fromEntries(BOOLEANS.map((key) => [key, row[key]])),
  });
  // A row the database accepted cannot fail these rules, but a hand-edited one
  // could; falling back beats refusing to show somebody their calendar.
  return merged.ok ? merged.values : { ...DEFAULT_CALENDAR_PREFERENCES, ...lists };
}
