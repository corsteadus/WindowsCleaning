/**
 * An estimate's discounts, being edited — phase 5, Kyle's Video 5: "dollar
 * discounts or percentage discounts … name the discounts … a little button to add
 * more discounts if I want to stack them." The profile's saved discounts (senior,
 * military) are one tap away.
 */
import { Plus, Tag, X } from "lucide-react";
import { discountLabel, type Discount, type DiscountDraft } from "@/lib/discounts";
import { formatCurrency } from "@/lib/utils";

const FIELD = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm";

export function DiscountEditor({ drafts, onChange, saved = [] }: {
  drafts: DiscountDraft[];
  onChange: (drafts: DiscountDraft[]) => void;
  /** The profile's own discounts, to add with one tap. */
  saved?: Discount[];
}) {
  const update = (key: string, patch: Partial<DiscountDraft>) => onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const add = (discount?: Discount) => onChange([...drafts, {
    key: crypto.randomUUID(), name: discount?.name ?? "", kind: discount?.kind ?? "percent", value: discount ? String(discount.value) : "",
  }]);
  const unused = saved.filter((s) => !drafts.some((d) => d.name.trim().toLowerCase() === s.name.toLowerCase()));

  return (
    <div className="space-y-2" data-testid="discount-editor">
      {drafts.length === 0 && <p className="text-xs text-slate-400">No discounts on this estimate.</p>}
      {drafts.map((draft) => (
        <div key={draft.key} data-testid="discount-row" className="flex flex-wrap items-center gap-2">
          <input aria-label="Discount name" placeholder="Name, e.g. Senior" className={`${FIELD} min-w-0 basis-full sm:basis-0 sm:flex-1`}
            value={draft.name} onChange={(e) => update(draft.key, { name: e.target.value })} />
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="radiogroup" aria-label="Dollar or percent">
            {(["percent", "amount"] as const).map((kind) => (
              <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} data-testid={`discount-kind-${kind}`}
                onClick={() => update(draft.key, { kind })}
                className={`h-8 w-9 rounded-md text-sm font-semibold ${draft.kind === kind ? "bg-primary text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                {kind === "percent" ? "%" : "$"}
              </button>
            ))}
          </div>
          <input aria-label="Discount amount" inputMode="decimal" placeholder={draft.kind === "percent" ? "10" : "25.00"} className={`${FIELD} min-w-0 flex-1 sm:w-24 sm:flex-none`}
            value={draft.value} onChange={(e) => update(draft.key, { value: e.target.value.replace(/[^\d.]/g, "") })} />
          <button type="button" aria-label={`Remove ${draft.name || "discount"}`} data-testid="discount-remove"
            onClick={() => onChange(drafts.filter((d) => d.key !== draft.key))}
            className="h-9 w-9 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600"><X className="mx-auto h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" data-testid="discount-add" onClick={() => add()}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          <Plus className="h-3.5 w-3.5" /> Add a discount
        </button>
        {unused.map((discount) => (
          <button key={discount.name} type="button" data-testid="discount-add-saved" onClick={() => add(discount)}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
            <Tag className="h-3.5 w-3.5" /> {discountLabel(discount)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The discount rows of a totals block: "Senior (10%)  −$50.00". */
export function DiscountRows({ discounts, className = "" }: { discounts: ReadonlyArray<Discount & { amount: number }>; className?: string }) {
  return (
    <>
      {discounts.map((discount, i) => (
        <div key={`${discount.name}-${i}`} data-testid="discount-total-row" className={`flex justify-between gap-4 text-sm text-emerald-700 ${className}`}>
          <span>{discountLabel(discount)}</span>
          <span className="font-semibold tabular-nums">−{formatCurrency(discount.amount)}</span>
        </div>
      ))}
    </>
  );
}
