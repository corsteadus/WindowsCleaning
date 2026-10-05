/**
 * Find profiles by what is in one of their custom fields.
 *
 * Kyle (Testing Edits, 2026-10-01, #3): *"These custom fields should … be
 * searchable/filterable so a company can categorize and find prospects or
 * customers based on the values entered."*
 *
 * The search box already looks inside custom field values. This is the other
 * half: one field, one value, so a company can ask "which of these have casement
 * windows" rather than reading every profile.
 *
 * The control follows the field's type, and the line underneath says what a
 * match means — "12 found nothing" is confusing until you know the number was
 * compared exactly.
 */
import { useQuery } from "@tanstack/react-query";
import { Filter, X } from "lucide-react";
import { protectedFetch } from "@/lib/auth-scope";
import {
  type CustomFieldFilterState,
  NO_CUSTOM_FIELD_FILTER,
  filterControlFor,
  isCustomFieldFilterActive,
  matchHintFor,
  withField,
} from "@/lib/custom-field-filter";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Definition {
  id: number;
  label: string;
  fieldType: string | null;
  active?: boolean;
  isActive?: boolean;
}

const CONTROL_CLS = "h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 "
  + "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";

export function CustomFieldFilter({
  state, onChange,
}: { state: CustomFieldFilterState; onChange: (next: CustomFieldFilterState) => void }) {
  const definitions = useQuery<Definition[]>({
    queryKey: ["custom-field-definitions", "filter"],
    queryFn: async () => {
      const response = await protectedFetch(`${BASE}/api/custom-fields/definitions`);
      if (!response.ok) throw new Error("Unable to load the custom fields");
      return response.json();
    },
  });

  const fields = (definitions.data ?? []).filter((field) => field.active ?? field.isActive ?? true);
  const selected = fields.find((field) => String(field.id) === state.fieldId) ?? null;
  const control = filterControlFor(selected?.fieldType);

  // A dropdown's choices live in a catalogue of its own, fetched only once one
  // is the field being filtered on.
  const choices = useQuery<Array<{ id: number; label?: string; name?: string; value?: string }>>({
    queryKey: ["catalog", `custom-field-${selected?.id}`],
    enabled: control === "choice" && Boolean(selected),
    queryFn: async () => {
      const response = await protectedFetch(`${BASE}/api/catalogs/custom-field-${selected!.id}`);
      if (!response.ok) throw new Error("Unable to load the choices");
      return response.json();
    },
  });

  if (fields.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <Filter className="h-3.5 w-3.5" />
        Custom field
      </span>

      <select
        aria-label="Filter by a custom field"
        value={state.fieldId}
        onChange={(event) => onChange(withField(state, event.target.value))}
        className={CONTROL_CLS}
      >
        <option value="">Any</option>
        {fields.map((field) => (
          <option key={field.id} value={String(field.id)}>{field.label}</option>
        ))}
      </select>

      {selected && (
        <>
          {control === "choice" && (
            <select
              aria-label={`${selected.label} value`}
              value={state.value}
              onChange={(event) => onChange({ ...state, value: event.target.value })}
              className={CONTROL_CLS}
            >
              <option value="">Any value</option>
              {(choices.data ?? []).map((choice) => {
                const value = choice.value ?? choice.name ?? choice.label ?? "";
                return <option key={choice.id} value={value}>{value}</option>;
              })}
            </select>
          )}

          {control === "yesno" && (
            <select
              aria-label={`${selected.label} value`}
              value={state.value}
              onChange={(event) => onChange({ ...state, value: event.target.value })}
              className={CONTROL_CLS}
            >
              <option value="">Any value</option>
              <option value="true">Ticked</option>
              <option value="false">Not ticked</option>
            </select>
          )}

          {(control === "text" || control === "number" || control === "date") && (
            <input
              aria-label={`${selected.label} value`}
              type={control === "text" ? "text" : control}
              value={state.value}
              placeholder={control === "text" ? "Any value" : undefined}
              onChange={(event) => onChange({ ...state, value: event.target.value })}
              className={`${CONTROL_CLS} w-40`}
            />
          )}

          <span className="text-[10px] text-slate-400">{matchHintFor(selected.fieldType)}</span>
        </>
      )}

      {isCustomFieldFilterActive(state) && (
        <button
          type="button"
          onClick={() => onChange(NO_CUSTOM_FIELD_FILTER)}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px]
                     font-semibold text-slate-500 hover:bg-slate-50"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}
