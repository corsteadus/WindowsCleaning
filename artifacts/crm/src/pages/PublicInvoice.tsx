/**
 * The customer's invoice — A3 (Kyle, Video 7). Opened from the link in the email
 * with no sign-in: the business, what was done, what it came to, what is paid and
 * what is still owed, today. Print / PDF gives the same invoice as a PDF.
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, MapPin, Printer, XCircle } from "lucide-react";
import { useParams } from "wouter";
import { formatCurrency } from "@/lib/utils";

type Standing = "paid" | "voided" | "credited" | "overdue" | "due" | "draft";
type Invoice = {
  invoiceNumber: string; status: string; standing: Standing; issuedAt: string; dueDate: string | null; paidAt: string | null;
  customerName: string | null; serviceAddress: string | null;
  lines: Array<{ description: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number; lineTotal: number }>;
  subtotal: number; taxAmount: number; totalAmount: number; amountPaid: number; credited: number; balanceDue: number;
};

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const day = (value: string) => {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toLocaleDateString("en-CA");
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

const BANNER: Record<Standing, { text: (i: Invoice) => string; tone: string }> = {
  paid: { text: (i) => `Paid in full${i.paidAt ? ` on ${day(i.paidAt)}` : ""}. Thank you!`, tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  voided: { text: () => "This invoice has been cancelled. Nothing is owed on it.", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  credited: { text: () => "This invoice has been credited in full. Nothing is owed on it.", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  overdue: { text: (i) => `${formatCurrency(i.balanceDue)} is past due${i.dueDate ? ` (due ${day(i.dueDate)})` : ""}.`, tone: "bg-red-50 text-red-800 border-red-200" },
  due: { text: (i) => `${formatCurrency(i.balanceDue)} due ${i.dueDate ? `by ${day(i.dueDate)}` : "upon receipt"}.`, tone: "bg-sky-50 text-sky-800 border-sky-200" },
  draft: { text: (i) => `${formatCurrency(i.balanceDue)} due ${i.dueDate ? `by ${day(i.dueDate)}` : "upon receipt"}.`, tone: "bg-sky-50 text-sky-800 border-sky-200" },
};

export default function PublicInvoice() {
  const { token } = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState("");
  const [branding, setBranding] = useState<{ businessName: string; contactLines: string[]; logoUrl: string | null } | null>(null);
  useEffect(() => {
    fetch(`${BASE}/api/public/branding`).then((r) => (r.ok ? r.json() : null)).then(setBranding).catch(() => setBranding(null));
  }, []);
  // Whose copy of the link this is (`?r=`), passed on so the open is counted against that address.
  const openKey = useMemo(() => new URLSearchParams(window.location.search).get("r"), []);
  const keyed = (path: string) => (openKey ? `${path}?r=${encodeURIComponent(openKey)}` : path);
  useEffect(() => {
    // Public invoice links intentionally work without an authenticated session.
    fetch(keyed(`${BASE}/api/public/invoices/${encodeURIComponent(token)}`))
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Invoice unavailable");
        return response.json();
      })
      .then(setInvoice)
      .catch((e: Error) => setError(e.message));
  }, [token]);

  if (error) return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl bg-white border p-8 text-center"><XCircle className="mx-auto h-10 w-10 text-red-500 mb-3" /><h1 className="text-xl font-bold">Invoice unavailable</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></main>;
  if (!invoice) return <main className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-400">Loading invoice…</main>;

  const banner = BANNER[invoice.standing] ?? BANNER.due;
  const closed = invoice.standing === "voided" || invoice.standing === "credited";
  return (
    <main className="min-h-screen bg-slate-50 pb-12">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto max-w-3xl px-5 py-9">
          <div className="flex flex-wrap items-center gap-3" data-testid="public-invoice-branding">
            {branding?.logoUrl && (
              <span className="flex h-12 items-center rounded-lg bg-white px-2"><img src={`${BASE}${branding.logoUrl}`} alt={branding.businessName} className="max-h-10 max-w-[180px] object-contain" /></span>
            )}
            <span>
              <span className="block text-sm font-semibold text-white">{branding?.businessName ?? ""}</span>
              {(branding?.contactLines ?? []).map((line) => <span key={line} className="block text-xs text-slate-400">{line}</span>)}
            </span>
          </div>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Invoice</p>
              <h1 className="mt-1 text-3xl font-bold" data-testid="public-invoice-number">{invoice.invoiceNumber}</h1>
              <p className="mt-1 text-sm text-slate-400">Issued {day(invoice.issuedAt)}{invoice.customerName ? ` · for ${invoice.customerName}` : ""}</p>
            </div>
            <a href={keyed(`${BASE}/api/public/invoices/${encodeURIComponent(token)}/pdf`)} target="_blank" rel="noreferrer" data-testid="public-invoice-pdf"
              onClick={() => { void fetch(`${BASE}/api/public/invoices/${encodeURIComponent(token)}/activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityType: "printed" }) }).catch(() => {}); }}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/20">
              <Printer className="h-4 w-4" /> Print / PDF
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-7 space-y-5">
        <div className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold ${banner.tone}`} data-testid="public-invoice-standing">
          {invoice.standing === "paid" ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <FileText className="h-5 w-5 shrink-0" />}
          {banner.text(invoice)}
        </div>

        {invoice.serviceAddress && (
          <p className="flex items-center gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 text-slate-400" /> {invoice.serviceAddress}</p>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white" data-testid="public-invoice-lines">
          {invoice.lines.map((line, i) => (
            <div key={i} className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-0">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{line.description}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {line.quantity} × {formatCurrency(line.unitPrice)}
                  {line.discountAmount > 0 ? ` · discount −${formatCurrency(line.discountAmount)}` : ""}
                  {line.taxAmount > 0 ? ` · tax ${formatCurrency(line.taxAmount)}` : ""}
                </p>
              </div>
              <p className="shrink-0 font-semibold tabular-nums text-slate-900">{formatCurrency(line.lineTotal)}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm" data-testid="public-invoice-totals">
          <Row label="Subtotal" value={formatCurrency(invoice.subtotal)} />
          {invoice.taxAmount > 0 && <Row label="Sales tax" value={formatCurrency(invoice.taxAmount)} />}
          <Row label="Total" value={formatCurrency(invoice.totalAmount)} strong />
          {invoice.amountPaid > 0 && <Row label="Paid" value={`−${formatCurrency(invoice.amountPaid)}`} tone="text-emerald-700" />}
          {invoice.credited > 0 && <Row label="Credited" value={`−${formatCurrency(invoice.credited)}`} tone="text-emerald-700" />}
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="text-base font-bold text-slate-900">Balance due</span>
            <span className={`text-2xl font-bold tabular-nums ${invoice.standing === "overdue" ? "text-red-600" : "text-slate-900"}`} data-testid="public-invoice-balance">
              {formatCurrency(closed ? 0 : Math.max(0, invoice.balanceDue))}
            </span>
          </div>
        </section>

        <p className="text-center text-xs text-slate-400">Questions about this invoice? Reply to the email it came with{branding?.contactLines?.length ? ", or contact us using the details above" : ""}.</p>
      </div>
    </main>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={strong ? "font-semibold text-slate-800" : "text-slate-500"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold text-slate-900" : tone ?? "text-slate-700"}`}>{value}</span>
    </div>
  );
}
