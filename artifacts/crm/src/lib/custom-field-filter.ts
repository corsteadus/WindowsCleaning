/**
 * Filtering profiles by a custom field, as a form.
 *
 * Kyle (Testing Edits, 2026-10-01, #3): *"These custom fields should … be
 * searchable/filterable so a company can categorize and find prospects or
 * customers based on the values entered."*
 *
 * The control a value gets depends on the field's type, and so does what a
 * match means: a choice, a date, a tick and a number are exact, free text is a
 * contains match. The screen says which, because "12 found nothing" is
 * confusing until you know the number was compared exactly.
 *
 * The twin of `api-server/src/lib/custom-field-search.ts`, which is the one
 * that decides; `custom-field-filter.test.ts` keeps the two honest.
 */

export type FilterControl = "text" | "number" | "date" | "choice" | "yesno";

export function filterControlFor(fieldType: string | null | undefined): FilterControl {
  switch (fieldType) {
    case "number": return "number";
    case "date": return "date";
    case "dropdown": return "choice";
    case "boolean": return "yesno";
    default: return "text";
  }
}

/** What a match means for this field, in words the office can read. */
export function matchHintFor(fieldType: string | null | undefined): string {
  switch (fieldType) {
    case "number":
    case "date":
      return "Matches exactly";
    case "dropdown":
      return "Matches the chosen option";
    case "boolean":
      return "Matches ticked or unticked";
    default:
      return "Matches anywhere in the text";
  }
}

export interface CustomFieldFilterState {
  /** The definition id as a string, or "" for no filter. */
  fieldId: string;
  /** Empty means "has any value in this field". */
  value: string;
}

export const NO_CUSTOM_FIELD_FILTER: CustomFieldFilterState = { fieldId: "", value: "" };

export function isCustomFieldFilterActive(state: CustomFieldFilterState): boolean {
  return state.fieldId.trim() !== "";
}

/** What goes on the query string. A value without a field is not a filter. */
export function customFieldFilterParams(state: CustomFieldFilterState): Record<string, string> {
  if (!isCustomFieldFilterActive(state)) return {};
  const params: Record<string, string> = { customFieldId: state.fieldId.trim() };
  const value = state.value.trim();
  if (value !== "") params.customFieldValue = value;
  return params;
}

/** How the filter reads once it is on: "Window type is Casement". */
export function describeCustomFieldFilter(
  state: CustomFieldFilterState,
  label: string | null | undefined,
): string {
  if (!isCustomFieldFilterActive(state)) return "";
  const field = label?.trim() || "That field";
  const value = state.value.trim();
  if (value === "") return `${field} has any value`;
  if (value === "true") return `${field} is ticked`;
  if (value === "false") return `${field} is not ticked`;
  return `${field} is ${value}`;
}

/** Changing the field clears the value: last field's value rarely fits the next. */
export function withField(state: CustomFieldFilterState, fieldId: string): CustomFieldFilterState {
  if (fieldId === state.fieldId) return state;
  return { fieldId, value: "" };
}
