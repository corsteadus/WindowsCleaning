import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { ListChecks, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";
import {
  CustomFieldInput, customFieldId, customFieldLabel, type CustomFieldValue,
} from "@/components/CustomFieldInput";

/**
 * The custom fields, on the tab a profile actually opens on — Kyle's #3.
 *
 * His report was that "custom fields can be created in Settings, but the
 * fields are not appearing on Prospect or Customer profiles". Walking it
 * showed they *were* appearing, and saving, and coming back — on **Profile
 * Details**. A profile opens on **Overview**, which showed nothing of them,
 * so from where he was sitting they had not arrived.
 *
 * So this is the same fields on the first screen, with the same save. It
 * deliberately does not offer creating, deleting or editing a dropdown's
 * choices: that is managing the fields, which belongs in Settings and on
 * Profile Details. Here you only fill them in, which is what #3 asks for —
 * "available for users to enter or select a value directly on the profile".
 */

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const body = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) throw new Error(parsed.error);
    } catch (error) {
      if (error instanceof Error && error.message) throw error;
    }
    throw new Error(body || "Request failed");
  }
  return (body ? JSON.parse(body) : {}) as T;
}

type Settings = { customFields?: CustomFieldValue[] };

export function ProfileCustomFieldsCard({
  customerId,
  apiBase,
}: {
  customerId: number;
  /** "/api/customers" or "/api/prospects" — the same pair the server serves. */
  apiBase: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const key = authScopedQueryKey(user, ["profile-details", apiBase, customerId]);
  const { data } = useQuery<Settings>({
    queryKey: key,
    queryFn: () => apiFetch<Settings>(`${apiBase}/${customerId}/profile-details`),
  });

  const stored = [...(data?.customFields ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const [draft, setDraft] = useState<CustomFieldValue[] | null>(null);
  // Stay on whatever the server last said until somebody types, so a refetch
  // cannot wipe half-finished edits and an abandoned edit cannot persist.
  useEffect(() => { setDraft(null); }, [customerId, apiBase]);
  const fields = draft ?? stored;
  const dirty = draft !== null;

  const save = useMutation({
    mutationFn: (customFields: CustomFieldValue[]) =>
      apiFetch(`${apiBase}/${customerId}/custom-fields`, {
        method: "PUT",
        body: JSON.stringify({ customFields }),
      }),
    onSuccess: () => {
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: key });
      // Profile Details shows the same fields; it must not keep the old ones.
      queryClient.invalidateQueries({ queryKey: ["profile-details"] });
      toast({ title: "Custom fields saved" });
    },
    onError: (error: Error) =>
      toast({ title: "Could not save custom fields", description: error.message, variant: "destructive" }),
  });

  // A company with no custom fields should not be shown an empty box on the
  // front page of every profile.
  if (!stored.length) return null;

  return (
    <div data-testid="overview-custom-fields" className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 font-bold text-slate-900">
          <ListChecks className="h-4 w-4 text-slate-400" />
          Custom fields
        </h2>
        {dirty && (
          <button
            type="button"
            data-testid="overview-custom-fields-save"
            onClick={() => save.mutate(fields)}
            disabled={save.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" />
            {save.isPending ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {fields.map((field, index) => (
          <div
            key={customFieldId(field) ?? index}
            className="grid items-center gap-2 text-xs font-semibold text-slate-600 md:grid-cols-[190px_1fr]"
          >
            <span className="py-2">{customFieldLabel(field, index)}</span>
            <CustomFieldInput
              field={field}
              onChange={(value) => setDraft(fields.map((item, i) =>
                i === index ? { ...item, value, position: index } : { ...item, position: i }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
