import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, MapPin, Printer, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useParams } from "wouter";
import { formatCurrency } from "@/lib/utils";
import { DiscountRows } from "@/components/DiscountEditor";
import { applyDiscounts, type Discount } from "@/lib/discounts";
import { salesTax } from "@/lib/sales-tax";

type Line = {
  id: number; description: string; quantity: number; unitPrice: number | null; totalPrice: number;
  isUpsell?: boolean; serviceNotes?: string | null; taxable?: boolean;
};
type Snapshot = {
  quote: { quoteNumber: string; totalAmount: number; notes?: string | null; terms?: string | null; validUntil?: string | null };
  lineItems: Line[];
  /** Phase 5: the estimate's discounts. Absent on estimates finalized before them. */
  discounts?: Discount[];
  /** Phase 6: the sales tax the estimate charges; null or absent, none. */
  tax?: { rate: number; label: string | null } | null;
  locations: Array<{ id: number; name?: string | null; address: string; city?: string | null; state?: string | null; zip?: string | null; notes?: string | null }>;
};
type Estimate = {
  quoteNumber: string; customerName?: string | null; snapshot: Snapshot;
  decision?: string | null; decisionAt?: string | null; expiresAt: string;
  acceptedLineItemIds?: number[] | null;
  /** Videos 7 and 9: what the customer wrote, and the business's own thank-you. */
  customerNotes?: string | null;
  declineReason?: string | null;
  thankYouMessage?: string | null;
};

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export default function PublicEstimate() {
  const { token } = useParams<{ token: string }>();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState("");
  // A failed decision keeps the dialog, and what was typed in it, open.
  const [decisionError, setDecisionError] = useState("");
  const [decision, setDecision] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<number[] | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState(false);
  // Video 7: neither decision is one click — each is confirmed first.
  const [confirming, setConfirming] = useState<"accepted" | "declined" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Everything starts ticked, so taking the whole estimate is still one click.
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [branding, setBranding] = useState<{
    businessName: string; contactLines: string[]; logoUrl: string | null; showUnitPrices?: boolean; showServiceDescriptions?: boolean;
  } | null>(null);
  useEffect(() => {
    fetch(`${BASE}/api/public/branding`).then((r) => (r.ok ? r.json() : null)).then(setBranding).catch(() => setBranding(null));
  }, []);

  // A2: whose copy of the link this is (`?r=`), passed on so the open is counted against that address.
  const openKey = useMemo(() => new URLSearchParams(window.location.search).get("r"), []);
  const keyed = (path: string) => (openKey ? `${path}?r=${encodeURIComponent(openKey)}` : path);
  const load = useCallback((keepChoice = false) =>
    // Public estimate links intentionally work without an authenticated session.
    fetch(keyed(`${BASE}/api/public/estimates/${encodeURIComponent(token)}`))
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Estimate unavailable");
        return response.json();
      })
      .then((data: Estimate) => {
        setEstimate(data);
        setDecision(data.decision ?? null);
        setAccepted(data.acceptedLineItemIds ?? null);
        if (!keepChoice) setChosen(new Set((data.snapshot?.lineItems ?? []).map((line) => line.id)));
      })
      .catch((e) => setError(e.message)), [token]);
  useEffect(() => { void load(); }, [load]);

  const lines = estimate?.snapshot?.lineItems ?? [];
  // Phase 5: the discounts are worked out on what is chosen, by the server's
  // own rule — a percentage of less is less; a dollar discount stays.
  const discounts = estimate?.snapshot?.discounts ?? [];
  const sumOf = (some: Line[]) => some.reduce((sum, line) => sum + Math.round(Number(line.totalPrice) * 100), 0) / 100;
  // Phase 6: plus the sales tax on the taxable services chosen, after discounts.
  const taxRate = estimate?.snapshot?.tax?.rate ?? null;
  const priced = (some: Line[]) => {
    const money = applyDiscounts(sumOf(some), discounts);
    const tax = salesTax(some.map((line) => ({ totalPrice: Number(line.totalPrice), taxable: Boolean(line.taxable) })), money.discountTotal, taxRate).tax;
    return { ...money, tax, total: (Math.round(money.total * 100) + Math.round(tax * 100)) / 100 };
  };
  const offeredTotal = useMemo(() => priced(lines).total, [lines, discounts, taxRate]);
  // Once decided, the figure that matters is what was taken, not what was asked.
  const settled = accepted !== null;
  const shownIds = settled ? new Set(accepted) : chosen;
  const shownMoney = useMemo(
    () => priced(lines.filter((line) => shownIds.has(line.id))),
    [lines, shownIds, discounts, taxRate],
  );
  const shownTotal = shownMoney.total;
  const partial = shownIds.size > 0 && shownIds.size < lines.length;

  const toggle = (id: number) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function decide(next: "accepted" | "declined") {
    setSubmitting(true);
    setDecisionError("");
    try {
      const response = await fetch(`${BASE}/api/public/estimates/${encodeURIComponent(token)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next === "accepted"
          ? { decision: next, customerNotes: notes, acceptedLineItemIds: [...chosen] }
          : { decision: next, declineReason: reason, followUpRequested: followUp }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to record decision");
      setDecision(body.decision);
      setAccepted(body.acceptedLineItemIds ?? null);
      setConfirming(null);
      // The thank-you is the business's own wording, so it comes from the server.
      await load(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setDecisionError(e instanceof Error ? e.message : "Unable to record decision");
    } finally { setSubmitting(false); }
  }

  if (error) return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl bg-white border p-8 text-center"><XCircle className="mx-auto h-10 w-10 text-red-500 mb-3" /><h1 className="text-xl font-bold">Estimate unavailable</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></main>;
  if (!estimate) return <main className="min-h-screen grid place-items-center bg-slate-50"><div className="h-9 w-9 animate-spin rounded-full border-4 border-primary border-t-transparent" /></main>;
  const snapshot = estimate.snapshot;

  return (
    <main className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto max-w-3xl px-5 py-9">
          {/* Phase 8 (Kyle, Video 6): the business's own name and logo. */}
          <div className="flex flex-wrap items-center gap-3" data-testid="public-branding">
            {branding?.logoUrl && (
              <span className="flex h-12 items-center rounded-lg bg-white px-2"><img src={`${BASE}${branding.logoUrl}`} alt={branding.businessName} className="max-h-10 max-w-[180px] object-contain" /></span>
            )}
            <span>
              <span className="block text-sm font-semibold text-white">{branding?.businessName ?? ""}</span>
              {(branding?.contactLines ?? []).map((line) => <span key={line} className="block text-xs text-slate-400">{line}</span>)}
            </span>
          </div>
          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-sky-300">Window Cleaning Estimate</p>
            {/* Video 7: the customer can print it — the same PDF the business sends. */}
            <a href={keyed(`${BASE}/api/public/estimates/${encodeURIComponent(token)}/pdf`)} target="_blank" rel="noopener" data-testid="public-print"
              onClick={() => { void fetch(`${BASE}/api/public/estimates/${encodeURIComponent(token)}/activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityType: "printed" }) }).catch(() => {}); }}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/20 px-3 text-sm font-semibold text-white hover:bg-white/10">
              <Printer className="h-4 w-4" /> Print / PDF
            </a>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div><h1 className="text-3xl font-bold">{estimate.customerName || "Your estimate"}</h1><p className="mt-1 text-sm text-slate-400">{estimate.quoteNumber}</p></div>
            <div className="text-right">
              <p className="text-3xl font-bold">{formatCurrency(shownTotal)}</p>
              {partial && <p className="text-xs text-slate-400 line-through">{formatCurrency(offeredTotal)}</p>}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-7 space-y-5">
        {/* Videos 7 and 9: after accepting, a thank-you in the business's words and a recap. */}
        {decision === "accepted" && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6" data-testid="public-thank-you">
            <p className="text-xs font-bold uppercase tracking-[.16em] text-emerald-700">Estimate status – Accepted</p>
            <h2 className="mt-2 flex items-center gap-2 text-xl font-bold text-slate-900"><CheckCircle2 className="h-6 w-6 text-emerald-600" /> Thank you for confirming!</h2>
            {estimate.thankYouMessage && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700" data-testid="public-thank-you-message">{estimate.thankYouMessage}</p>}
            <div className="mt-4 rounded-xl bg-white p-4">
              <p className="text-sm font-semibold text-slate-700">Here is a recap of the service{(accepted?.length ?? 0) === 1 ? "" : "s"} to be performed:</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-800" data-testid="public-recap">
                {lines.filter((line) => shownIds.has(line.id)).map((line) => (
                  <li key={line.id} className="flex justify-between gap-3"><span>• {line.description}</span><span className="font-semibold">{formatCurrency(line.totalPrice)}</span></li>
                ))}
              </ul>
              <p className="mt-3 flex justify-between border-t pt-2 text-sm font-bold"><span>Total</span><span>{formatCurrency(shownTotal)}</span></p>
              {estimate.customerNotes && (
                <div className="mt-3 border-t pt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Your comments</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700" data-testid="public-customer-notes">{estimate.customerNotes}</p>
                </div>
              )}
            </div>
          </section>
        )}
        {decision === "declined" && (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5" data-testid="public-declined">
            <div className="flex items-center gap-3">
              <XCircle className="text-rose-600" />
              <div>
                <h2 className="font-bold">Estimate declined</h2>
                <p className="text-sm text-slate-600">Your response has been recorded. Thank you for letting us know.</p>
              </div>
            </div>
            {estimate.declineReason && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-white p-3 text-sm text-slate-700">{estimate.declineReason}</p>}
          </section>
        )}

        {snapshot.locations?.length > 0 && <section className="rounded-2xl border bg-white p-5"><h2 className="flex items-center gap-2 font-bold"><MapPin className="h-4 w-4 text-primary" /> Service locations</h2><div className="mt-3 space-y-3">{snapshot.locations.map((location) => <div key={location.id} className="rounded-xl bg-slate-50 p-3"><p className="font-semibold">{location.name?.trim() && !/^primary service property$/i.test(location.name.trim()) ? location.name : location.address}</p><p className="text-sm text-slate-500">{[location.address, location.city, location.state, location.zip].filter(Boolean).join(", ")}</p>{location.notes && <p className="mt-1 text-sm text-slate-600">{location.notes}</p>}</div>)}</div></section>}

        <section className="rounded-2xl border bg-white overflow-hidden">
          <div className="border-b px-5 py-4">
            <h2 className="flex items-center gap-2 font-bold"><FileText className="h-4 w-4 text-primary" /> Services</h2>
            {!decision && <p className="mt-1 text-sm text-slate-500">Tick the services you would like. You do not have to take them all.</p>}
          </div>
          <div className="divide-y">
            {lines.map((line) => {
              // A declined estimate took nothing, so no line may look chosen.
              const on = decision !== "declined" && shownIds.has(line.id);
              return (
                <label
                  key={line.id}
                  className={`flex items-start gap-4 px-5 py-4 transition-colors ${
                    on ? "bg-emerald-50/70 border-l-4 border-l-emerald-500" : "border-l-4 border-l-transparent"
                  } ${decision ? "" : "cursor-pointer hover:bg-slate-50"} ${settled && !on ? "opacity-55" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0 accent-emerald-600"
                    aria-label={`Accept ${line.description}`}
                    checked={on}
                    disabled={Boolean(decision) || submitting}
                    onChange={() => toggle(line.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2">
                      <p className="font-semibold">{line.description}</p>
                      {line.isUpsell && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">UPSELL</span>}
                      {settled && !on && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">NOT ACCEPTED</span>}
                    </div>
                    {/* Phase 8: as the business chose for its estimates, the same as the PDF. */}
                    {(branding?.showUnitPrices !== false || line.unitPrice == null) && (
                      <p className="mt-1 text-xs text-slate-500" data-testid="public-unit-price">{branding?.showUnitPrices === false ? "To be quoted" : <>{line.quantity} × {line.unitPrice == null ? "to be quoted" : formatCurrency(line.unitPrice)}</>}</p>
                    )}
                    {line.serviceNotes && branding?.showServiceDescriptions !== false && <p className="mt-1 text-sm text-slate-600">{line.serviceNotes}</p>}
                  </div>
                  <p className={`font-bold ${settled && !on ? "line-through text-slate-400" : ""}`}>{formatCurrency(line.totalPrice)}</p>
                </label>
              );
            })}
          </div>
          {(discounts.length > 0 || shownMoney.tax > 0) && (
            <div className="space-y-1.5 border-t px-5 pt-4" data-testid="public-discounts">
              <div className="flex justify-between text-sm text-slate-500">
                <span>Subtotal</span><span className="font-semibold text-slate-800">{formatCurrency(shownMoney.subtotal)}</span>
              </div>
              <DiscountRows discounts={shownMoney.discounts} />
              {shownMoney.tax > 0 && (
                <div className="flex justify-between text-sm text-slate-500" data-testid="public-tax">
                  <span>Sales tax{estimate?.snapshot?.tax?.label ? ` (${estimate.snapshot.tax.label})` : ""}</span>
                  <span className="font-semibold text-slate-800">{formatCurrency(shownMoney.tax)}</span>
                </div>
              )}
            </div>
          )}
          <div className="border-t bg-slate-50 px-5 py-4 flex items-baseline justify-between text-lg font-bold">
            <span>{settled ? "Accepted total" : partial ? "Selected total" : "Total"}</span>
            <span className="flex items-baseline gap-3">
              {partial && <span className="text-sm font-semibold text-slate-400 line-through">{formatCurrency(offeredTotal)}</span>}
              <span>{formatCurrency(shownTotal)}</span>
            </span>
          </div>
        </section>

        {(snapshot.quote.notes || snapshot.quote.terms) && <section className="rounded-2xl border bg-white p-5 space-y-4">{snapshot.quote.notes && <div><h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Estimate notes</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{snapshot.quote.notes}</p></div>}{snapshot.quote.terms && <div><h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Terms</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{snapshot.quote.terms}</p></div>}</section>}

        {!decision && (
          <section className="rounded-2xl border bg-white p-5">
            <h2 className="font-bold">Your decision</h2>
            <p className="mt-1 text-sm text-slate-500">Accept the services you have ticked, or let us know if none of them is the right fit.</p>
            {chosen.size === 0 && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">Tick at least one service to accept, or decline the estimate.</p>}
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button disabled={submitting} onClick={() => setConfirming("declined")} data-testid="public-decline" className="h-12 rounded-xl border border-rose-200 font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Decline estimate</button>
              <button disabled={submitting || chosen.size === 0} onClick={() => setConfirming("accepted")} data-testid="public-accept" className="h-12 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {chosen.size === lines.length ? "Accept complete estimate" : `Accept ${chosen.size} of ${lines.length} services`}
              </button>
            </div>
          </section>
        )}

        <Dialog open={confirming === "accepted"} onOpenChange={(open) => { if (!open && !submitting) setConfirming(null); }}>
          <DialogContent className="max-w-md rounded-2xl" data-testid="accept-dialog">
            <DialogHeader>
              <DialogTitle>Almost done!</DialogTitle>
              <DialogDescription>You are accepting {chosen.size === lines.length ? "the complete estimate" : `${chosen.size} of ${lines.length} services`}, {formatCurrency(shownTotal)} in total.</DialogDescription>
            </DialogHeader>
            <label className="block space-y-1.5">
              <span className="text-sm text-slate-600">(Optional) Type in any information you would like to share with us and/or anything we need to know.</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={4} aria-label="Comments for the business" data-testid="accept-notes"
                placeholder="For example: please call before arriving; the side gate will be unlocked." className="w-full rounded-xl border p-3 text-sm" />
            </label>
            {decisionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{decisionError}</p>}
            <DialogFooter className="gap-2 sm:gap-2">
              <button type="button" disabled={submitting} onClick={() => setConfirming(null)} className="h-11 rounded-xl border px-4 font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={submitting} onClick={() => decide("accepted")} data-testid="accept-confirm" className="h-11 rounded-xl bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{submitting ? "Confirming…" : "Confirm"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirming === "declined"} onOpenChange={(open) => { if (!open && !submitting) setConfirming(null); }}>
          <DialogContent className="max-w-md rounded-2xl" data-testid="decline-dialog">
            <DialogHeader>
              <DialogTitle>Decline this estimate?</DialogTitle>
              <DialogDescription>We will let the team know. You can tell us why, if you like.</DialogDescription>
            </DialogHeader>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} rows={3} aria-label="Reason for declining" data-testid="decline-reason"
              placeholder="(Optional) Your reason, or a question" className="w-full rounded-xl border p-3 text-sm" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} /> Please contact me to follow up</label>
            {decisionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{decisionError}</p>}
            <DialogFooter className="gap-2 sm:gap-2">
              <button type="button" disabled={submitting} onClick={() => setConfirming(null)} className="h-11 rounded-xl border px-4 font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={submitting} onClick={() => decide("declined")} data-testid="decline-confirm" className="h-11 rounded-xl bg-rose-600 px-5 font-bold text-white hover:bg-rose-700 disabled:opacity-50">{submitting ? "Declining…" : "Decline estimate"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
