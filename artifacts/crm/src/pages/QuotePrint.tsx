import { useEffect } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { protectedFetch } from "@/lib/auth-scope";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface LineItem {
  id: number;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
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

  useEffect(() => {
    if (quote) {
      document.title = `Quote ${quote.quoteNumber}`;
      setTimeout(() => window.print(), 600);
    }
  }, [quote]);

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
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Superior Professional Window Cleaning</h1>
          <p className="text-sm text-slate-500">Window Cleaning Professionals</p>
        </div>
        <div className="text-right">
          <h2 className="text-3xl font-bold text-primary">QUOTE</h2>
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
              {contact.phone && <p className="text-sm text-slate-500">{contact.phone}</p>}
            </>
          ) : (
            <p className="text-slate-400 italic">No contact</p>
          )}
        </div>
        {propertyLines.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Service Location</p>
            {quote.property?.name && (
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
          <span className="text-amber-700">{quote.validUntil}</span>
        </div>
      )}

      {/* Line items */}
      <table className="w-full mb-6">
        <thead>
          <tr className="bg-slate-50">
            <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider py-2 px-3 rounded-l">Description</th>
            <th className="text-center text-xs font-bold text-slate-500 uppercase tracking-wider py-2 px-3 w-20">Qty</th>
            <th className="text-right text-xs font-bold text-slate-500 uppercase tracking-wider py-2 px-3 w-28">Unit Price</th>
            <th className="text-right text-xs font-bold text-slate-500 uppercase tracking-wider py-2 px-3 rounded-r w-28">Total</th>
          </tr>
        </thead>
        <tbody>
          {quote.lineItems.map((li, i) => (
            <tr key={li.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
              <td className="py-2.5 px-3 text-sm text-slate-800">{li.description}</td>
              <td className="py-2.5 px-3 text-sm text-center text-slate-600">{li.quantity}</td>
              <td className="py-2.5 px-3 text-sm text-right text-slate-600">{formatCurrency(li.unitPrice)}</td>
              <td className="py-2.5 px-3 text-sm text-right font-medium">{formatCurrency(li.totalPrice)}</td>
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
          {quote.taxTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Tax</span>
              <span>{formatCurrency(quote.taxTotal)}</span>
            </div>
          )}
          {quote.discountTotal > 0 && (
            <div className="flex justify-between text-sm text-emerald-600">
              <span>Discount</span>
              <span>−{formatCurrency(quote.discountTotal)}</span>
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
