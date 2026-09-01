import { useEffect, useMemo } from "react";
import { MapPin } from "lucide-react";
import { useListProperties, getListPropertiesQueryKey } from "@/lib/property-client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { activePropertyChoices, effectivePropertyId, propertyAddress, propertyLabel, propertyRelationshipLabel, type PropertyLike } from "@/lib/property";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey } from "@/lib/auth-scope";

const NONE = "none";

type PropertyPickerProps = {
  customerId?: number | null;
  value: number | "" | null | undefined;
  onChange: (value: number | "") => void;
  defaultPropertyId?: number | null;
  label?: string;
  allowNone?: boolean;
  preserveEmpty?: boolean;
  disabled?: boolean;
  onOptionsChange?: (properties: PropertyLike[]) => void;
};

export function PropertyPicker({
  customerId,
  value,
  onChange,
  defaultPropertyId,
  label = "Property / location",
  allowNone = true,
  preserveEmpty = false,
  disabled = false,
  onOptionsChange,
}: PropertyPickerProps) {
  const { user } = useAuth();
  const params = { customerId: customerId ?? undefined };
  const { data, isLoading, isError } = useListProperties(params, {
    query: { enabled: !!customerId, queryKey: authScopedQueryKey(user, getListPropertiesQueryKey(params)) },
  });
  const properties = useMemo(
    () => activePropertyChoices((Array.isArray(data) ? data : (data as { data?: PropertyLike[] } | undefined)?.data ?? []) as PropertyLike[]),
    [data],
  );

  useEffect(() => {
    onOptionsChange?.(properties);
  }, [onOptionsChange, properties]);

  useEffect(() => {
    if (!customerId || (preserveEmpty ? value !== undefined : Boolean(value))) return;
    const selectedDefault = effectivePropertyId(properties, defaultPropertyId);
    if (selectedDefault == null) return;
    onChange(selectedDefault);
  }, [customerId, defaultPropertyId, onChange, preserveEmpty, properties, value]);

  const selected = properties.find((property) => property.id === Number(value));

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{label}</Label>
      <Select
        value={value ? String(value) : NONE}
        onValueChange={(next) => onChange(next === NONE ? "" : Number(next))}
        disabled={disabled || !customerId || isLoading || isError}
      >
        <SelectTrigger className="rounded-xl" data-testid="select-property">
          <SelectValue placeholder={customerId ? "Select a service location" : "Select customer first"}>
            {selected ? propertyLabel(selected) : allowNone ? "No specific property" : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE}>No specific property</SelectItem>}
          {properties.map((property) => (
            <SelectItem key={property.id} value={String(property.id)}>
              <span className="flex flex-col py-0.5">
                <span className="font-medium">{propertyLabel(property)}</span>
                <span className="text-[11px] text-slate-400">
                  {propertyRelationshipLabel(property)} · {propertyAddress(property)}
                </span>
              </span>
            </SelectItem>
          ))}
          {!isLoading && !isError && properties.length === 0 && (
            <SelectItem value="no-properties" disabled>No active properties on file</SelectItem>
          )}
        </SelectContent>
      </Select>
      {isError && <p className="text-xs text-red-600">Could not load active properties.</p>}
    </div>
  );
}