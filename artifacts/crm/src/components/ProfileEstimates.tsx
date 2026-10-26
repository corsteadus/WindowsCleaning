/**
 * The profile's estimates — Kyle, Videos 4 and 5 — and converting from one of
 * them. "Suppose we have given Luke three different estimates over the last
 * couple of years, and he decides to move forward with one of those three … I
 * can choose the one he wants, use the view option to check the information,
 * and then bring it into the fields so I can make him a customer."
 *
 * The scheduling itself is the estimate page's own EstimateConversionDialog;
 * this chooses the estimate, shows what is in it, and finalizes it first when
 * it never has been.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarCheck2, ChevronRight, FileText, MapPin, Plus, Trash2, User } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { estimateStatusLabel, estimateStatusOf } from "@/lib/estimate-status";
import { formatDateOnly } from "@/lib/quote-settings-form";
import { estimateCall, finalizeEstimate } from "@/lib/estimate-actions";
import { convertBlocker, estimatePriceLabel, type ProfileEstimate } from "@/lib/profile-estimates";

// The business's own time, as the estimate page books it (lib/chicago-time.ts) —
// not whatever zone the viewer's computer is in.
const when = (iso: string) => new Date(iso).toLocaleString("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
});
/** A created date the way the rest of the card reads one — "Oct 24, 2026". */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

export function EstimatesView({ quotes, customerId, canCreate, canConvert, isProspect, onConvert, onDelete }: {
  quotes: ProfileEstimate[];
  customerId: number;
  canCreate: boolean;
  canConvert: boolean;
  isProspect: boolean;
  onConvert: (quoteId?: number) => void;
  onDelete?: (kind: "jobs" | "quotes", recordId: number, label: string) => void;
}) {
  const convertible = quotes.some((quote) => (quote.summary?.jobCount ?? 0) === 0);
  return (
    <div className="space-y-3" data-testid="profile-estimates">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{quotes.length} estimate{quotes.length !== 1 ? "s" : ""}</p>
        <div className="flex items-center gap-2">
          {canConvert && convertible && (
            <button type="button" onClick={() => onConvert()} data-testid="convert-from-estimate"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-emerald-300 bg-white text-emerald-700 text-xs font-semibold hover:bg-emerald-50">
              <CalendarCheck2 className="w-3.5 h-3.5" /> {isProspect ? "Convert to Customer" : "Schedule from an estimate"}
            </button>
          )}
          {canCreate && (
            <Link href={`/quotes/new?customerId=${customerId}`}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90">
              <Plus className="w-3.5 h-3.5" /> New Estimate
            </Link>
          )}
        </div>
      </div>
      {quotes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">No estimates yet</p>
        </div>
      ) : quotes.map((quote) => {
        const summary = quote.summary;
        const status = estimateStatusOf(quote);
        const scheduled = (summary?.jobCount ?? 0) > 0;
        return (
          <div key={quote.id} data-testid="estimate-card" className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/quotes/${quote.id}`} className="font-bold text-slate-900 text-sm hover:text-primary hover:underline">{quote.quoteNumber}</Link>
                  <StatusBadge status={status} label={estimateStatusLabel(status)} />
                  {scheduled && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{summary!.jobCount} job{summary!.jobCount === 1 ? "" : "s"} scheduled</span>}
                </div>
                {/* Kyle, Video 5: when, who, and where — the history at a glance. */}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                    {summary?.appointmentAt ? when(summary.appointmentAt) : "Not booked"}</span>
                  <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5 text-slate-400" />
                    {summary?.estimator ?? "No estimator"}</span>
                  {(summary?.locations.length ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-slate-400" />
                      {summary!.locations.map((location) => location.label).join(" · ")}</span>
                  )}
                  <span>Created {day(quote.createdAt)}{quote.validUntil ? ` · valid until ${formatDateOnly(quote.validUntil)}` : ""}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-slate-900 text-sm">{estimatePriceLabel(quote)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Link href={`/quotes/${quote.id}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Open <ChevronRight className="h-3.5 w-3.5" />
              </Link>
              {canConvert && !scheduled && (
                <button type="button" onClick={() => onConvert(quote.id)} aria-label={`Convert ${quote.quoteNumber}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                  <CalendarCheck2 className="h-3.5 w-3.5" /> {isProspect ? "Convert" : "Schedule"}
                </button>
              )}
              {onDelete && (
                <button type="button" aria-label={`Delete estimate ${quote.quoteNumber}`}
                  onClick={() => onDelete("quotes", quote.id, `estimate ${quote.quoteNumber}`)}
                  className="ml-auto rounded-md p-1.5 text-red-500 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface QuoteDetailLine {
  id: number; description: string; quantity: number; unitPrice: number | null; totalPrice: number;
  serviceNotes?: string | null; propertyId?: number | null;
}

/** Choose the estimate they are going ahead with, check it, then schedule it. */
export function ConvertFromEstimateDialog({ quotes, open, initialQuoteId, isProspect, onOpenChange, onReady }: {
  quotes: ProfileEstimate[];
  open: boolean;
  initialQuoteId?: number;
  isProspect: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chosen estimate is finalized and ready for the scheduling dialog. */
  onReady: (quoteId: number) => void;
}) {
  const choices = quotes.filter((quote) => (quote.summary?.jobCount ?? 0) === 0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setChosen(initialQuoteId ?? (choices.length === 1 ? choices[0].id : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuoteId]);

  const quote = choices.find((item) => item.id === chosen) ?? null;
  // Kyle: "use the view option to check the information" — what is in it.
  const detail = useQuery({
    queryKey: ["convert-estimate-detail", chosen],
    queryFn: () => estimateCall<{ lineItems?: QuoteDetailLine[] }>(`/quotes/${chosen}`),
    enabled: open && chosen != null,
    staleTime: 0,
  });
  const blocker = quote ? convertBlocker(quote) : null;
  const locationLabel = (id?: number | null) => quote?.summary?.locations.find((location) => location.id === id)?.label ?? "";

  const proceed = async () => {
    if (!quote || blocker) return;
    setWorking(true);
    setError(null);
    try {
      // Scheduling copies a finalized snapshot; one never finalized is finalized now.
      if (quote.summary?.revisionNumber == null) await finalizeEstimate(quote.id);
      onReady(quote.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The estimate could not be finalized");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl" data-testid="convert-picker">
        <DialogHeader>
          <DialogTitle>{isProspect ? "Convert to customer" : "Schedule from an estimate"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500">Choose the estimate they are going ahead with. Its services and prices are copied into the job unchanged.</p>
        {choices.length === 0 ? (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Every estimate on this profile has already been scheduled.</p>
        ) : (
          <div className="space-y-2" role="radiogroup" aria-label="Estimates">
            {choices.map((item) => {
              const status = estimateStatusOf(item);
              const selected = item.id === chosen;
              return (
                <button key={item.id} type="button" role="radio" aria-checked={selected} onClick={() => setChosen(item.id)}
                  data-testid="convert-choice"
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-slate-200 hover:border-slate-300"}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{item.quoteNumber}</span>
                    <StatusBadge status={status} label={estimateStatusLabel(status)} />
                    <span className="ml-auto text-sm font-bold text-slate-900">{estimatePriceLabel(item)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {[
                      item.summary?.appointmentAt ? when(item.summary.appointmentAt) : `Created ${day(item.createdAt)}`,
                      item.summary?.estimator,
                      item.summary?.locations.map((location) => location.label).join(" · "),
                    ].filter(Boolean).join(" · ")}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {quote && (
          <div className="rounded-xl border border-slate-200" data-testid="convert-preview">
            <p className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">What is in {quote.quoteNumber}</p>
            {detail.isFetching && <p className="px-4 py-3 text-xs text-slate-400">Loading…</p>}
            {!detail.isFetching && (detail.data?.lineItems ?? []).map((line) => (
              <div key={line.id} className="flex items-start justify-between gap-3 px-4 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-slate-800">{line.quantity} × {line.description}</p>
                  <p className="text-xs text-slate-400">{[locationLabel(line.propertyId), line.serviceNotes].filter(Boolean).join(" · ")}</p>
                </div>
                <span className={line.unitPrice == null ? "text-xs font-semibold text-amber-700" : "font-semibold text-slate-800"}>
                  {line.unitPrice == null ? "To be quoted" : `$${Number(line.totalPrice).toFixed(2)}`}
                </span>
              </div>
            ))}
          </div>
        )}

        {quote && blocker && (
          <div role="alert" data-testid="convert-blocker" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {blocker} <Link href={`/quotes/${quote.id}`} className="font-semibold underline">Open the estimate</Link>
          </div>
        )}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="button" data-testid="convert-continue" disabled={!quote || !!blocker || working} onClick={proceed}
            className="h-9 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {working ? "Getting it ready…" : quote?.summary?.revisionNumber == null ? "Finalize & continue" : "Continue"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
