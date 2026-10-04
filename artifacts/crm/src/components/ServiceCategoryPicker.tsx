import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { protectedFetch } from "@/lib/auth-scope";

/**
 * The service categories a business has defined, with the ability to add and
 * remove them in place.
 *
 * Kyle (Testing Edits, 2026-10-01, #8): *"In the Category area, let the user add
 * new categories and delete categories directly without leaving the Add Service
 * workflow."* The six Corstead used to hard-code are now ordinary catalogue rows,
 * so a business that cleans something other than windows can say so.
 */

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
/** The slug the catalogue routes know this list by. */
export const SERVICE_CATEGORY_CATALOG = "service-categories";
export const serviceCategoriesQueryKey = ["catalog", SERVICE_CATEGORY_CATALOG];

export interface CategoryItem { id: number; code?: string | null; name?: string | null; value?: string | null }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(`${BASE}/api${path}`, {
    ...init, credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string })?.error ?? "Request failed");
  return body as T;
}

export const categoryCode = (item: CategoryItem) => item.code ?? item.value ?? String(item.id);
export const categoryLabel = (item: CategoryItem) => item.name ?? item.code ?? String(item.id);

export function useServiceCategories() {
  return useQuery<CategoryItem[]>({
    queryKey: serviceCategoriesQueryKey,
    queryFn: () => api<CategoryItem[]>(`/catalogs/${SERVICE_CATEGORY_CATALOG}`),
  });
}

export function ServiceCategoryPicker({
  value, onChange, disabled = false, onError,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const categories = useServiceCategories();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const items = categories.data ?? [];
  const chosen = value || (items[0] ? categoryCode(items[0]) : "");
  const selected = items.find((item) => categoryCode(item) === chosen);

  const add = useMutation({
    mutationFn: () => api<CategoryItem>(`/catalogs/${SERVICE_CATEGORY_CATALOG}`, {
      method: "POST", body: JSON.stringify({ name: name.trim() }),
    }),
    onSuccess: (created) => {
      setName("");
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: serviceCategoriesQueryKey });
      onChange(categoryCode(created));
    },
    onError: (cause: unknown) => onError?.(cause instanceof Error ? cause.message : "Could not add the category."),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/catalogs/${SERVICE_CATEGORY_CATALOG}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      onChange("");
      void queryClient.invalidateQueries({ queryKey: serviceCategoriesQueryKey });
    },
    onError: (cause: unknown) => onError?.(cause instanceof Error ? cause.message : "Could not remove the category."),
  });

  return (
    <div className="space-y-2">
      <select
        aria-label="Service category"
        className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        value={chosen}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || categories.isLoading}
      >
        {!items.length && <option value="">No categories yet — add one below</option>}
        {items.map((item) => (
          <option key={item.id} value={categoryCode(item)}>{categoryLabel(item)}</option>
        ))}
      </select>

      <div className="flex flex-wrap items-center gap-2">
        {adding ? (
          <>
            <Input
              aria-label="New category name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Roof cleaning"
              className="h-8 w-48"
              disabled={add.isPending}
              autoFocus
            />
            <Button type="button" size="sm" variant="secondary"
              onClick={() => add.mutate()} disabled={!name.trim() || add.isPending}>
              {add.isPending ? "Adding…" : "Add category"}
            </Button>
            <button type="button" className="text-[11px] text-slate-500 hover:underline"
              onClick={() => { setAdding(false); setName(""); }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="text-[11px] font-semibold text-primary hover:underline"
              onClick={() => setAdding(true)}>
              + New category
            </button>
            {selected && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600"
                aria-label={`Remove the ${categoryLabel(selected)} category`}
                onClick={() => remove.mutate(selected.id)}
                disabled={remove.isPending}
              >
                <Trash2 className="h-3 w-3" /> Remove “{categoryLabel(selected)}”
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
