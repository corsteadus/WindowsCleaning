/**
 * One custom field's input, whatever its type.
 *
 * It lived inside ProfileDetailsTab until Kyle's #3 put the same fields on
 * the Overview tab as well. Two copies of this would drift — a dropdown that
 * accepts a free-typed value on one screen and not the other is exactly the
 * sort of difference nobody notices until a value goes missing.
 */

export type CustomFieldValue = {
  id?: number;
  fieldId?: number;
  label?: string;
  name?: string;
  value: string;
  position?: number;
  fieldType?: string;
  choices?: string[];
};

export function customFieldId(field: CustomFieldValue): number | undefined {
  return field.fieldId ?? field.id;
}

export function customFieldLabel(field: CustomFieldValue, index: number): string {
  return field.label ?? field.name ?? `Field ${index + 1}`;
}

export function CustomFieldInput(
  { field, onChange }: { field: CustomFieldValue; onChange: (value: string) => void },
) {
  const value = field.value ?? "";
  switch (field.fieldType) {
    case "boolean":
      return <input type="checkbox" aria-label={field.label ?? "Field"} checked={value === "true"} onChange={e => onChange(e.target.checked ? "true" : "false")} className="h-4 w-4 accent-primary" />;
    case "number":
      return <input type="number" aria-label={field.label ?? "Field"} value={value} onChange={e => onChange(e.target.value)} className="input-lite" />;
    case "date":
      return <input type="date" aria-label={field.label ?? "Field"} value={value} onChange={e => onChange(e.target.value)} className="input-lite" />;
    case "multiline":
      return <textarea aria-label={field.label ?? "Field"} value={value} onChange={e => onChange(e.target.value)} rows={2} className="input-lite" />;
    case "dropdown":
      // A value already stored but no longer on the list stays selectable, so
      // editing something else cannot silently clear it.
      return <select aria-label={field.label ?? "Field"} value={value} onChange={e => onChange(e.target.value)} className="input-lite">
        <option value="">Not set</option>
        {value && !(field.choices ?? []).includes(value) && <option value={value}>{value}</option>}
        {(field.choices ?? []).map(choice => <option key={choice} value={choice}>{choice}</option>)}
      </select>;
    default:
      return <input aria-label={field.label ?? "Field"} value={value} onChange={e => onChange(e.target.value)} className="input-lite" />;
  }
}
