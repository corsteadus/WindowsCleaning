import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, MapPin, XCircle } from "lucide-react";
import { useParams } from "wouter";
import { formatCurrency } from "@/lib/utils";

type Snapshot = {
  quote: { quoteNumber: string; totalAmount: number; notes?: string | null; terms?: string | null; validUntil?: string | null };
  lineItems: Array<{ id: number; description: string; quantity: number; unitPrice: number; totalPrice: number; isUpsell?: boolean; serviceNotes?: string | null }>;
  locations: Array<{ id: number; name?: string | null; address: string; city?: string | null; state?: string | null; zip?: string | null; notes?: string | null }>;
};
type Estimate = { quoteNumber: string; customerName?: string | null; snapshot: Snapshot; decision?: string | null; decisionAt?: string | null; expiresAt: string };

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export default function PublicEstimate() {
  const { token } = useParams<{ token: string }>();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    // Public estimate links intentionally work without an authenticated session.
    fetch(`${BASE}/api/public/estimates/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Estimate unavailable");
        return response.json();
      })
      .then((data) => { setEstimate(data); setDecision(data.decision ?? null); })
      .catch((e) => setError(e.message));
  }, [token]);
  const total = useMemo(() => estimate?.snapshot?.quote.totalAmount ?? 0, [estimate]);
  async function decide(next: "accepted" | "declined") {
    setSubmitting(true);
    try {
      const response = await fetch(`${BASE}/api/public/estimates/${encodeURIComponent(token)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: next, declineReason: reason, followUpRequested: followUp }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to record decision");
      setDecision(body.decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to record decision");
    } finally { setSubmitting(false); }
  }
  if (error) return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl bg-white border p-8 text-center"><XCircle className="mx-auto h-10 w-10 text-red-500 mb-3" /><h1 className="text-xl font-bold">Estimate unavailable</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></main>;
  if (!estimate) return <main className="min-h-screen grid place-items-center bg-slate-50"><div className="h-9 w-9 animate-spin rounded-full border-4 border-primary border-t-transparent" /></main>;
  const snapshot = estimate.snapshot;
  return (
    <main className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto max-w-3xl px-5 py-9">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-sky-300">Window Cleaning Estimate</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div><h1 className="text-3xl font-bold">{estimate.customerName || "Your estimate"}</h1><p className="mt-1 text-sm text-slate-400">{estimate.quoteNumber}</p></div>
            <p className="text-3xl font-bold">{formatCurrency(total)}</p>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-5 py-7 space-y-5">
        {decision && <section className={`rounded-2xl border p-5 ${decision === "accepted" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}><div className="flex items-center gap-3">{decision === "accepted" ? <CheckCircle2 className="text-emerald-600" /> : <XCircle className="text-rose-600" />}<div><h2 className="font-bold capitalize">Estimate {decision}</h2><p className="text-sm text-slate-600">Your response has been recorded. Our team will follow up.</p></div></div></section>}
        {snapshot.locations?.length > 0 && <section className="rounded-2xl border bg-white p-5"><h2 className="flex items-center gap-2 font-bold"><MapPin className="h-4 w-4 text-primary" /> Service locations</h2><div className="mt-3 space-y-3">{snapshot.locations.map((location) => <div key={location.id} className="rounded-xl bg-slate-50 p-3"><p className="font-semibold">{location.name || location.address}</p><p className="text-sm text-slate-500">{[location.address, location.city, location.state, location.zip].filter(Boolean).join(", ")}</p>{location.notes && <p className="mt-1 text-sm text-slate-600">{location.notes}</p>}</div>)}</div></section>}
        <section className="rounded-2xl border bg-white overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 font-bold"><FileText className="h-4 w-4 text-primary" /> Services</h2></div><div className="divide-y">{snapshot.lineItems.map((line) => <div key={line.id} className="flex items-start justify-between gap-5 px-5 py-4"><div><div className="flex gap-2"><p className="font-semibold">{line.description}</p>{line.isUpsell && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">UPSELL</span>}</div><p className="mt-1 text-xs text-slate-500">{line.quantity} × {formatCurrency(line.unitPrice)}</p>{line.serviceNotes && <p className="mt-1 text-sm text-slate-600">{line.serviceNotes}</p>}</div><p className="font-bold">{formatCurrency(line.totalPrice)}</p></div>)}</div><div className="border-t bg-slate-50 px-5 py-4 flex justify-between text-lg font-bold"><span>Total</span><span>{formatCurrency(total)}</span></div></section>
        {(snapshot.quote.notes || snapshot.quote.terms) && <section className="rounded-2xl border bg-white p-5 space-y-4">{snapshot.quote.notes && <div><h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Estimate notes</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{snapshot.quote.notes}</p></div>}{snapshot.quote.terms && <div><h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Terms</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{snapshot.quote.terms}</p></div>}</section>}
        {!decision && <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Your decision</h2><p className="mt-1 text-sm text-slate-500">Accept the complete estimate or let us know why it is not the right fit.</p><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional decline reason or question" className="mt-4 min-h-24 w-full rounded-xl border p-3 text-sm" /><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} /> Please contact me to follow up</label><div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2"><button disabled={submitting} onClick={() => decide("declined")} className="h-12 rounded-xl border border-rose-200 font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Decline estimate</button><button disabled={submitting} onClick={() => decide("accepted")} className="h-12 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">Accept complete estimate</button></div></section>}
      </div>
    </main>
  );
}