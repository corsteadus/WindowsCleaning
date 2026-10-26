/**
 * The business's sales tax rates — phase 6, Kyle's answer #2: "the business sets
 * up state and county rates … base = state, county added when it applies; either
 * rate alone or both added together." An estimate freezes the rate it charges,
 * so changing a rate here never changes an estimate already made.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, Plus } from "lucide-react";
import { estimateCall } from "@/lib/estimate-actions";
import { type TaxRate } from "@/lib/sales-tax";

const FIELD = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm";
const EMPTY = { name: "", kind: "state" as "state" | "county", state: "", county: "", rate: "" };

export function SalesTaxCard({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const rates = useQuery({ queryKey: ["tax-rates"], queryFn: () => estimateCall<TaxRate[]>("/tax-rates") });
  const [draft, setDraft] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tax-rates"] });

  const add = useMutation({
    mutationFn: () => estimateCall("/tax-rates", { method: "POST", body: JSON.stringify({ ...draft, rate: draft.rate }) }),
    onSuccess: async () => { setDraft(EMPTY); setAdding(false); setError(null); await refresh(); },
    onError: (cause: Error) => setError(cause.message),
  });
  const toggle = useMutation({
    mutationFn: (rate: TaxRate) => estimateCall(`/tax-rates/${rate.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !rate.isActive }) }),
    onSuccess: refresh,
  });

  if (!canManage) return null;
  const list = rates.data ?? [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="sales-tax-card">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Percent className="w-4 h-4" /></div>
        <div>
          <h2 className="text-base font-bold text-slate-900">Sales tax</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Your state and county rates. Tax is never on by default: an estimate charges it only when you choose,
            on its taxable services, after discounts. Tax Exempt customers are never taxed.
          </p>
        </div>
      </div>
      <div className="p-5 space-y-3">
        {rates.isLoading && <p className="text-sm text-slate-400">Loading rates…</p>}
        {list.length === 0 && !rates.isLoading && <p className="text-sm text-slate-400">No rates yet. Add your state's rate, then any county rates.</p>}
        {list.map((rate) => (
          <div key={rate.id} data-testid="tax-rate-row" className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 ${rate.isActive ? "border-slate-200" : "border-dashed border-slate-200 opacity-60"}`}>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${rate.kind === "state" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"}`}>{rate.kind}</span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-semibold text-slate-900">{rate.name}</span>
              <span className="text-slate-500"> · {rate.state}{rate.county ? ` · ${rate.county}` : ""}</span>
            </span>
            <span className="text-sm font-bold tabular-nums text-slate-900">{Number(rate.rate)}%</span>
            <button type="button" data-testid="tax-rate-toggle" disabled={toggle.isPending} onClick={() => toggle.mutate(rate)}
              className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              {rate.isActive ? "Turn off" : "Turn on"}
            </button>
          </div>
        ))}

        {adding ? (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="tax-rate-form">
            <div className="grid gap-2 sm:grid-cols-[110px_1fr_70px_1fr_90px]">
              <select aria-label="Rate kind" className={FIELD} value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as "state" | "county" }))}>
                <option value="state">State</option><option value="county">County</option>
              </select>
              <input aria-label="Rate name" className={FIELD} placeholder={draft.kind === "state" ? "e.g. Missouri" : "e.g. Jackson County"}
                value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              <input aria-label="State" className={`${FIELD} uppercase`} placeholder="MO" maxLength={2}
                value={draft.state} onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value.replace(/[^a-z]/gi, "") }))} />
              <input aria-label="County" className={FIELD} placeholder={draft.kind === "county" ? "County, e.g. Jackson" : "—"} disabled={draft.kind !== "county"}
                value={draft.kind === "county" ? draft.county : ""} onChange={(e) => setDraft((d) => ({ ...d, county: e.target.value }))} />
              <input aria-label="Rate percent" inputMode="decimal" className={FIELD} placeholder="4.225"
                value={draft.rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value.replace(/[^\d.]/g, "") }))} />
            </div>
            {error && <p className="text-xs text-red-600" data-testid="tax-rate-error">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setAdding(false); setError(null); }} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="button" data-testid="tax-rate-save" disabled={add.isPending} onClick={() => add.mutate()}
                className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50">Save rate</button>
            </div>
          </div>
        ) : (
          <button type="button" data-testid="tax-rate-add" onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Add a rate
          </button>
        )}
      </div>
    </section>
  );
}
