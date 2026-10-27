import { useEffect } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { protectedFetch } from "@/lib/auth-scope";
import { formatDateOnly } from "@/lib/quote-settings-form";
import { formatCurrency } from "@/lib/utils";
import { discountLabel } from "@/lib/discounts";
import { formatPhoneAsTyped } from "@/lib/phone-format";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface LineItem {
  id: number;
  description: string;
  quantity: number;
  /** null while still to be quoted. */
  unitPrice: number | null;
  totalPrice: number;
  /** The customer-visible description for this service on this estimate. */
  serviceNotes?: string | null;
}

interface QuoteContact {
  displayName: string;
  email?: string | null;
  phone?: string | null;
}

interface Quote {
  id: number;
  quoteNumber: string;
  status: string;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  /** Phase 5: each discount by name. */
  discounts?: Array<{ name: string; kind: "amount" | "percent"; value: number; amount: number }>;
  /** Phase 6: how the estimate's sales tax reads, e.g. "Missouri 4.225% + Jackson County 1.25%". */
  taxLabel?: string | null;
  totalAmount: number;
  notes?: string | null;
  terms?: string | null;
  validUntil?: string | null;
  createdAt: string;
  lineItems: LineItem[];
  customer?: QuoteContact | null;
  lead?: QuoteContact | null;
  property?: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
}

export default function QuotePrint() {
  const { id } = useParams<{ id: string }>();

  const { data: quote, isLoading } = useQuery<Quote>({
    queryKey: [`/api/quotes/${id}`],
    queryFn: async () => {
      const response = await protectedFetch(`${BASE}/api/quotes/${id}`);
      if (!response.ok) throw new Error(`Failed to load quote (${response.status})`);
      return response.json();
    },
  });

  // Phase 8 (Kyle, Video 6): the business's own name, details and logo.
  const { data: brand, isFetched: brandLoaded } = useQuery<{
    businessName: string; contactLines: string[]; logoUrl: string | null;
    showUnitPrices?: boolean; showServiceDescriptions?: boolean; estimateFooter?: string | null;
  }>({
    queryKey: ["public-branding"],
    queryFn: async () => (await protectedFetch(`${BASE}/api/public/branding`)).json(),
  });

  useEffect(() => {
    if (quote && brandLoaded) {
      document.title = `Quote ${quote.quoteNumber}`;
      setTimeout(() => window.print(), 600);
    }
  }, [quote, brandLoaded]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-400">
        Loading quote…
      </div>
    );
  }

  if (!quote) {
    return <div className="p-8 text-red-600">Quote not found.</div>;
  }

  const contact = quote.customer ?? quote.lead;
  // Phase 8: as the business chose for its estimates, the same as the PDF.
  const showUnitPrices = brand?.showUnitPrices !== false;
  const showDescriptions = brand?.showServiceDescriptions !== false;
  const propertyLines: string[] = [];
  if (quote.property) {
    if (quote.property.address) propertyLines.push(quote.property.address);
    const cityLine = [quote.property.city, quote.property.state, quote.property.zip].filter(Boolean).join(" ");
    if (cityLine) propertyLines.push(cityLine);
  }

  return (
    <div className="print-page font-sans p-10 max-w-3xl mx-auto text-slate-800">
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
          .print-page { padding: 0.5in; }
        }
        body { background: white; }
      `}</style>

      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div data-testid="print-branding">
          {brand?.logoUrl && <img src={`${BASE}${brand.logoUrl}`} alt={brand.businessName} className="mb-2 max-h-14 max-w-[220px] object-contain" />}
          <h1 className="text-2xl font-bold text-slate-900">{brand?.businessName ?? ""}</h1>
          {(brand?.contactLines ?? []).map((line) => <p key={line} className="text-sm text-slate-500">{line}</p>)}
        </div>
        <div className="text-right">
          <h2 className="text-3xl font-bold text-primary">ESTIMATE</h2>
          <p className="text-sm text-slate-500 font-mono">{quote.quoteNumber}</p>
          <p className="text-xs text-slate-400 mt-1">
            {format(new Date(quote.createdAt), "MMMM d, yyyy")}
          </p>
        </div>
      </div>

      <hr className="border-slate-200 mb-6" />

      {/* Bill To / Service Location */}
      <div className="grid grid-cols-2 gap-8 mb-8">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Bill To</p>
          {contact ? (
            <>
              <p className="font-semibold text-slate-800">{contact.displayName}</p>
              {contact.email && <p className="text-sm text-slate-500">{contact.email}</p>}
              {contact.phone && <p className="text-sm text-slate-500">{formatPhoneAsTyped(contact.phone)}</p>}
            </>
          ) : (
            <p className="text-slate-400 italic">No contact</p>
          )}
        </div>
        {propertyLines.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Service Location</p>
            {quote.property?.name && !/^primary service property$/i.test(quote.property.name.trim()) && (
              <p className="font-semibold text-slate-700">{quote.property.name}</p>
            )}
            {propertyLines.map((line, i) => (
              <p key={i} className="text-sm text-slate-600">{line}</p>
            ))}
          </div>
        )}
      </div>

      {/* Quote meta */}
      {quote.validUntil && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-6 text-sm">
          <span className="font-medium text-amber-800">Valid until: </span>
          <span className="text-amber-700">{formatDateOnly(quote.validUntil)}</span>
        </div>
      )}

      {/* Line items */}
      <table className="w-full mb-6">
        <thead>
          <tr className="bg-slate-50">
            <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider py-2 px-3 rounded-l">Description</th>
            {showUnitPrices && <th className="text-center text-xs font-bold text-slate-500 uppercase tracking-wider py-2 px-3 w-20">Qty</th>}
            {showUnitPrices && <th className="text-right text-xs font-bold text-slate-500 uppercase tracking-wider py-2 px-3 w-28">Unit Price</th>}
            <th className="text-right text-xs font-bold text-slate-500 uppercase tracking-wider py-2 px-3 rounded-r w-28">Total</th>
          </tr>
        </thead>
        <tbody>
          {quote.lineItems.map((li, i) => (
            <tr key={li.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
              <td className="py-2.5 px-3 text-sm text-slate-800">
                {li.description}
                {showDescriptions && li.serviceNotes && <span className="mt-0.5 block text-xs text-slate-500">{li.serviceNotes}</span>}
              </td>
              {showUnitPrices && <td className="py-2.5 px-3 text-sm text-center text-slate-600">{li.quantity}</td>}
              {showUnitPrices && <td className="py-2.5 px-3 text-sm text-right text-slate-600">{li.unitPrice == null ? "To be quoted" : formatCurrency(li.unitPrice)}</td>}
              <td className="py-2.5 px-3 text-sm text-right font-medium">{li.unitPrice == null ? (showUnitPrices ? "—" : "To be quoted") : formatCurrency(li.totalPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end mb-8">
        <div className="w-64 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Subtotal</span>
            <span>{formatCurrency(quote.subtotal)}</span>
          </div>
          {/* Discounts come off before any tax (phase 5; tax is phase 6). */}
          {quote.discounts?.length ? (
            quote.discounts.map((discount, i) => (
              <div key={i} className="flex justify-between text-sm text-emerald-600">
                <span>{discountLabel(discount)}</span>
                <span>−{formatCurrency(discount.amount)}</span>
              </div>
            ))
          ) : quote.discountTotal > 0 && (
            <div className="flex justify-between text-sm text-emerald-600">
              <span>Discount</span>
              <span>−{formatCurrency(quote.discountTotal)}</span>
            </div>
          )}
          {quote.taxTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Sales tax{quote.taxLabel ? ` (${quote.taxLabel})` : ""}</span>
              <span>{formatCurrency(quote.taxTotal)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base border-t border-slate-200 pt-2 mt-2">
            <span>Total</span>
            <span>{formatCurrency(quote.totalAmount)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      {quote.notes && (
        <div className="mb-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Notes</p>
          <p className="text-sm text-slate-600 whitespace-pre-line">{quote.notes}</p>
        </div>
      )}

      {/* Terms */}
      {quote.terms && (
        <div className="mt-6 pt-4 border-t border-slate-200">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Terms & Conditions</p>
          <p className="text-xs text-slate-500 whitespace-pre-line">{quote.terms}</p>
        </div>
      )}

      {/* Signature */}
      <div className="mt-10 pt-6 border-t border-slate-200 grid grid-cols-2 gap-8">
        <div>
          <div className="border-b border-slate-300 mb-1 pb-8" />
          <p className="text-xs text-slate-400">Customer Signature</p>
        </div>
        <div>
          <div className="border-b border-slate-300 mb-1 pb-8" />
          <p className="text-xs text-slate-400">Date</p>
        </div>
      </div>

      {/* Phase 8: the business's own footer (licence, insurance …), as on the PDF. */}
      {brand?.estimateFooter && (
        <p className="mt-8 text-center text-[11px] text-slate-400 whitespace-pre-line" data-testid="print-footer">{brand.estimateFooter}</p>
      )}

      <div className="no-print mt-8 text-center">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          Print / Save as PDF
        </button>
        <button
          onClick={() => window.close()}
          className="ml-3 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200"
        >
          Close
        </button>
      </div>
    </div>
  );
}
