/**
 * Custom field types, and where a dropdown's choices live.
 *
 * Kyle (2026-09-23, #6): "Offer text, number, date, dropdown and checkbox. The
 * user should be able to create and name the field directly from the profile.
 * For dropdowns, let the user create and manage the available choices."
 *
 * `checkbox` is stored as the existing `boolean`, and `multiline` stays because
 * fields already use it. A dropdown's choices are kept in
 * `profile_catalog_items` — the table that already holds the options behind
 * every other profile dropdown — under a catalogue of its own per field. That
 * reuses the add / remove / re-add behaviour and needs no new table.
 */

export const CUSTOM_FIELD_TYPES = ["text", "multiline", "number", "date", "boolean", "dropdown"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** What Kyle asked to be offered when creating a field, in his order. */
export const OFFERED_CUSTOM_FIELD_TYPES: ReadonlyArray<{ value: CustomFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "dropdown", label: "Dropdown" },
  { value: "boolean", label: "Checkbox" },
];

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return typeof value === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

/** The `catalog_type` holding one dropdown field's choices. */
export function customFieldChoiceCatalog(definitionId: number): string {
  return `custom_field_${definitionId}`;
}

/** The URL slug for that catalogue, so the existing /catalogs/:type routes serve it. */
export function customFieldChoiceSlug(definitionId: number): string {
  return `custom-field-${definitionId}`;
}

/** The definition id a choice-catalogue slug refers to, or null if it is not one. */
export function customFieldChoiceSlugId(slug: string): number | null {
  const match = /^custom-field-(\d+)$/.exec(slug);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}
