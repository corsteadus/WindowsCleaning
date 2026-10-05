/**
 * Finding a profile by what is in its custom fields.
 *
 * Kyle (Testing Edits, 2026-10-01, #3): *"These custom fields should later be
 * searchable/filterable so a company can categorize and find prospects or
 * customers based on the values entered."*
 *
 * Two different questions, so two behaviours:
 *
 * - the search box answers "is this text anywhere on the profile", custom
 *   fields included, and that is always a contains match;
 * - a filter answers "which profiles have *this* value in *this* field", and
 *   what that means depends on the field. A dropdown choice, a date, a tick and
 *   a number are **exact** — filtering a Windows field by 12 must not return 120
 *   — while free text is a contains match, because nobody types a note twice
 *   the same way.
 *
 * Every value is stored as text in `custom_field_values.value`, so the mode is
 * decided from the field's declared type rather than from the value.
 */
import { isCustomFieldType, type CustomFieldType } from "./custom-field-types.ts";

export type CustomFieldMatchMode = "exact" | "contains";

export function customFieldMatchMode(fieldType: unknown): CustomFieldMatchMode {
  const type: CustomFieldType | null = isCustomFieldType(fieldType) ? fieldType : null;
  switch (type) {
    case "dropdown":
    case "boolean":
    case "date":
    case "number":
      return "exact";
    default:
      // text, multiline, and anything a future migration adds.
      return "contains";
  }
}

export interface CustomFieldFilter {
  definitionId: number;
  /** Null asks for "this field has any value at all". */
  value: string | null;
  mode: CustomFieldMatchMode;
}

export type CustomFieldFilterResult =
  | { kind: "none" }
  | { kind: "filter"; filter: CustomFieldFilter }
  | { kind: "error"; message: string };

/** A tick is stored as the string "true" or "false"; accept how a form sends it. */
export function normaliseCustomFieldValue(
  value: unknown,
  fieldType: unknown,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (isCustomFieldType(fieldType) && fieldType === "boolean") {
    if (/^(true|yes|1|checked)$/i.test(trimmed)) return "true";
    if (/^(false|no|0|unchecked)$/i.test(trimmed)) return "false";
    return null;
  }
  return trimmed;
}

/**
 * What the request asked to filter by, checked against the fields the company
 * actually has. An id that is not one of them is an error rather than an empty
 * result, so a stale bookmark says so instead of looking like "no matches".
 */
export function parseCustomFieldFilter(
  query: { customFieldId?: unknown; customFieldValue?: unknown },
  definitions: ReadonlyArray<{ id: number; fieldType: string | null }>,
): CustomFieldFilterResult {
  const raw = query.customFieldId;
  if (raw === null || raw === undefined || raw === "") {
    // A value without a field has nothing to compare against.
    if (typeof query.customFieldValue === "string" && query.customFieldValue.trim() !== "") {
      return { kind: "error", message: "customFieldId is required to filter by a custom field value" };
    }
    return { kind: "none" };
  }
  const id = Number(typeof raw === "string" ? raw.trim() : raw);
  if (!Number.isInteger(id) || id <= 0) {
    return { kind: "error", message: "customFieldId must be a positive integer" };
  }
  const definition = definitions.find((candidate) => candidate.id === id);
  if (!definition) {
    return { kind: "error", message: "That custom field does not exist" };
  }
  const mode = customFieldMatchMode(definition.fieldType);
  const value = normaliseCustomFieldValue(query.customFieldValue, definition.fieldType);
  if (
    value === null
    && typeof query.customFieldValue === "string"
    && query.customFieldValue.trim() !== ""
  ) {
    // Only a tick can reject a non-empty value: it is yes or no, nothing else.
    return { kind: "error", message: "customFieldValue must be true or false for a checkbox field" };
  }
  return { kind: "filter", filter: { definitionId: id, value, mode } };
}

/** The LIKE pattern for a contains match, with the wildcards a value may contain escaped. */
export function containsPattern(value: string): string {
  return `%${value.replace(/([\\%_])/g, "\\$1")}%`;
}
