/**
 * Discounts that follow a profile — phase 5, Kyle's Video 5: "if you had a senior
 * citizen discount, obviously that person is always going to be a senior citizen
 * going forward." Each is added to the profile's new estimates, where it can be
 * removed; removing it here leaves estimates already made as they are.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag, X } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { estimateCall } from "@/lib/estimate-actions";
import { discountLabel, draftsToDiscounts, type Discount, type DiscountKind } from "@/lib/discounts";

const FIELD = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm";
type Saved = Discount & { id: number };

export function ProfileDiscounts({ profilePath, canManage }: { profilePath: string; canManage: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = authScopedQueryKey(user, ["profile-discounts", profilePath]);
  const list = useQuery({ queryKey: key, queryFn: () => estimateCall<Saved[]>(`${profilePath}/discounts`) });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ name: string; kind: DiscountKind; value: string }>({ name: "", kind: "percent", value: "" });
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => {
      const checked = draftsToDiscounts([{ key: "new", ...draft }]);
      if ("error" in checked) throw new Error(checked.error);
      if (!checked.discounts.length) throw new Error("Give the discount a name and an amount");
      return estimateCall(`${profilePath}/discounts`, { method: "POST", body: JSON.stringify(checked.discounts[0]) });
    },
    onSuccess: async () => {
      setAdding(false); setError(null); setDraft({ name: "", kind: "percent", value: "" });
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => estimateCall(`${profilePath}/discounts/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const saved = list.data ?? [];
  if (!canManage && saved.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3" data-testid="profile-discounts">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Discounts that follow this profile</span>
        {saved.map((discount) => (
          <span key={discount.id} data-testid="profile-discount" className="inline-flex h-7 items-center gap-1 rounded-full bg-emerald-50 pl-2.5 pr-1 text-xs font-semibold text-emerald-700">
            <Tag className="h-3 w-3" /> {discountLabel(discount)}
            {canManage && (
              <button type="button" aria-label={`Remove ${discount.name}`} data-testid="profile-discount-remove"
                onClick={() => { if (window.confirm(`Stop adding ${discount.name} to new estimates? Estimates already made keep it.`)) remove.mutate(discount.id); }}
                className="ml-0.5 rounded-full p-0.5 text-emerald-600 hover:bg-emerald-100 hover:text-red-600"><X className="h-3 w-3" /></button>
            )}
          </span>
        ))}
        {saved.length === 0 && !adding && <span className="text-xs text-slate-400">None — e.g. a senior or military discount.</span>}
        {canManage && !adding && (
          <button type="button" data-testid="profile-discount-add" onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Plus className="h-3 w-3" /> Add
          </button>
        )}
      </div>
      {adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="profile-discount-form">
          <input aria-label="Profile discount name" placeholder="Name, e.g. Senior" className={`${FIELD} min-w-0 flex-1`}
            value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="Dollar or percent">
            {(["percent", "amount"] as const).map((kind) => (
              <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} onClick={() => setDraft((d) => ({ ...d, kind }))}
                className={`h-8 w-9 rounded-md text-sm font-semibold ${draft.kind === kind ? "bg-primary text-white" : "text-slate-500"}`}>
                {kind === "percent" ? "%" : "$"}
              </button>
            ))}
          </div>
          <input aria-label="Profile discount amount" inputMode="decimal" placeholder={draft.kind === "percent" ? "10" : "25.00"} className={`${FIELD} w-24`}
            value={draft.value} onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value.replace(/[^\d.]/g, "") }))} />
          <button type="button" data-testid="profile-discount-save" disabled={add.isPending} onClick={() => add.mutate()}
            className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50">Save</button>
          <button type="button" onClick={() => { setAdding(false); setError(null); }} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600">Cancel</button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600" data-testid="profile-discount-error">{error}</p>}
      {saved.length > 0 && <p className="mt-1.5 text-[11px] text-slate-400">Added to each new estimate for this profile; it can be removed there.</p>}
    </div>
  );
}
