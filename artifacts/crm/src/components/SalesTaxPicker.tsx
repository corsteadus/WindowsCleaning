/**
 * An estimate's sales tax — phase 6, Kyle's answer #2: never on by default; the
 * state rate, the county rate, or both added together; the location's county
 * suggests its county rate. A Tax Exempt customer cannot be charged tax.
 */
import { useQuery } from "@tanstack/react-query";
import { Ban, Sparkles } from "lucide-react";
import { estimateCall } from "@/lib/estimate-actions";
import { rateLabel, suggestedRates, type TaxRate } from "@/lib/sales-tax";

// Full width on a phone, side by side from sm up.
const FIELD = "h-9 min-w-0 w-full sm:w-auto sm:flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm";
export interface TaxChoice { stateRateId: string; countyRateId: string }

export function useTaxRates(enabled = true) {
  return useQuery({ queryKey: ["tax-rates"], queryFn: () => estimateCall<TaxRate[]>("/tax-rates"), enabled, staleTime: 60_000 });
}

export function SalesTaxPicker({ value, onChange, taxExempt, place }: {
  value: TaxChoice;
  onChange: (value: TaxChoice) => void;
  taxExempt: boolean;
  /** The estimate's location, for the suggested rates. */
  place: { state?: string | null; county?: string | null };
}) {
  const rates = useTaxRates();
  const list = rates.data ?? [];
  // A rate turned off since it was chosen stays visible on the estimate that chose it.
  const offered = (kind: "state" | "county", chosen: string) => list.filter((r) => r.kind === kind && (r.isActive || String(r.id) === chosen));
  const suggestion = suggestedRates(list, place);
  const on = Boolean(value.stateRateId || value.countyRateId);
  const canSuggest = (suggestion.stateRate || suggestion.countyRate)
    && (String(suggestion.stateRate?.id ?? "") !== value.stateRateId || String(suggestion.countyRate?.id ?? "") !== value.countyRateId);

  if (taxExempt) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600" data-testid="tax-exempt-note">
        <Ban className="h-4 w-4 shrink-0 text-slate-400" />
        <span>This customer is <strong>Tax Exempt</strong>, so this estimate charges no sales tax.</span>
      </p>
    );
  }
  if (!rates.isLoading && list.filter((r) => r.isActive).length === 0) {
    return <p className="text-sm text-slate-500" data-testid="tax-no-rates">No sales tax rates are set up yet. An administrator adds them in Settings → Sales tax.</p>;
  }

  return (
    <div className="space-y-2" data-testid="sales-tax-picker">
      <div className="flex flex-wrap gap-2">
        <select aria-label="State tax rate" data-testid="tax-state" className={FIELD} value={value.stateRateId}
          onChange={(e) => onChange({ ...value, stateRateId: e.target.value })}>
          <option value="">No state tax</option>
          {offered("state", value.stateRateId).map((r) => <option key={r.id} value={r.id}>{rateLabel(r)}{r.isActive ? "" : " (turned off)"}</option>)}
        </select>
        <select aria-label="County tax rate" data-testid="tax-county" className={FIELD} value={value.countyRateId}
          onChange={(e) => onChange({ ...value, countyRateId: e.target.value })}>
          <option value="">No county tax</option>
          {offered("county", value.countyRateId).map((r) => <option key={r.id} value={r.id}>{rateLabel(r)}{r.isActive ? "" : " (turned off)"}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {!on && <span>Off — this estimate charges no sales tax.</span>}
        {canSuggest && (
          <button type="button" data-testid="tax-suggested" onClick={() => onChange({
            stateRateId: suggestion.stateRate ? String(suggestion.stateRate.id) : "", countyRateId: suggestion.countyRate ? String(suggestion.countyRate.id) : "",
          })} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 hover:bg-emerald-100">
            <Sparkles className="h-3 w-3" /> Use this location's: {[suggestion.stateRate, suggestion.countyRate].filter(Boolean).map((r) => rateLabel(r!)).join(" + ")}
          </button>
        )}
        {on && <button type="button" data-testid="tax-off" onClick={() => onChange({ stateRateId: "", countyRateId: "" })} className="font-semibold text-slate-500 underline-offset-2 hover:underline">Turn tax off</button>}
      </div>
    </div>
  );
}

/** The combined percentage of a choice, from the rates as set up. */
export function chosenRate(rates: readonly TaxRate[], value: TaxChoice): number | null {
  const ids = [value.stateRateId, value.countyRateId].filter(Boolean).map(Number);
  if (!ids.length) return null;
  return Math.round(rates.filter((r) => ids.includes(r.id)).reduce((sum, r) => sum + Number(r.rate), 0) * 10000) / 10000;
}
