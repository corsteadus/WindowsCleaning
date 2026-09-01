import { useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import {
  FileText, Plus, Search, ArrowRightCircle, Trash2,
  CheckCircle2, XCircle, Send, Clock,
} from "lucide-react";
import {
  useListQuotes,
  useDeleteQuote,
  convertQuote,
  getListQuotesQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";

// ─── Status filter setup ──────────────────────────────────────────────────────

const FILTERS = ["all", "draft", "sent", "approved", "rejected"] as const;
type Filter = typeof FILTERS[number];
const FILTER_LABELS: Record<Filter, string> = {
  all: "All", draft: "Draft", sent: "Sent", approved: "Approved", rejected: "Rejected",
};

function fmtDate(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}

// ─── QuoteCard ────────────────────────────────────────────────────────────────

function QuoteCard({
  quote,
  onView,
  onConvert,
  onDelete,
  convertLoading,
  deleteLoading,
}: {
  quote: {
    id: number; quoteNumber: string; status: string;
    totalAmount: number; validUntil?: string | null; createdAt: string;
    customerId: number; propertyId?: number | null;
    customerName?: string | null; propertyName?: string | null; propertyAddress?: string | null;
  };
  onView: () => void;
  onConvert: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  convertLoading: boolean;
  deleteLoading: boolean;
}) {
  const isApproved = quote.status === "approved";
  const isRejected = quote.status === "rejected";
  const canConvert = !isApproved && !isRejected;

  const property = quote.propertyName || quote.propertyAddress;
  const customer = quote.customerName ?? `Customer #${quote.customerId}`;

  const borderAccent =
    isApproved ? "border-l-emerald-400 border-emerald-100" :
    isRejected ? "border-l-red-400 border-red-100" :
    quote.status === "sent" ? "border-l-blue-400 border-blue-100" :
    "border-l-slate-300 border-slate-200";

  return (
    <button
      onClick={onView}
      className={`w-full text-left bg-white rounded-2xl border border-l-4 transition-all
        hover:shadow-md active:scale-[.995] group ${borderAccent}`}
    >
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <p className="font-bold text-slate-900 text-sm truncate">{customer}</p>
              {property && (
                <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md truncate max-w-[160px]">
                  {property}
                </span>
              )}
            </div>
            <p className="font-mono text-xs text-slate-400">{quote.quoteNumber}</p>

            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {quote.validUntil && (
                <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                  <Clock className="w-3 h-3" />
                  Valid until {fmtDate(quote.validUntil)}
                </span>
              )}
              <span className="text-xs text-slate-400">
                Created {fmtDate(quote.createdAt)}
              </span>
            </div>
          </div>

          {/* Right */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <StatusBadge status={quote.status} />
            <span className="text-xl font-bold text-slate-900 tabular-nums">
              {formatCurrency(quote.totalAmount)}
            </span>

            {/* Action buttons */}
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {canConvert && (
                <button
                  onClick={onConvert}
                  disabled={convertLoading}
                  title="Approve & Convert to Job"
                  className="h-8 w-8 flex items-center justify-center rounded-xl text-emerald-600
                             hover:bg-emerald-50 hover:text-emerald-700 active:scale-95
                             transition-all disabled:opacity-60"
                >
                  <ArrowRightCircle className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onDelete}
                disabled={deleteLoading}
                title="Delete quote"
                className="h-8 w-8 flex items-center justify-center rounded-xl text-slate-300
                           hover:bg-red-50 hover:text-red-500 active:scale-95
                           transition-all disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Quotes() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const { data: quotes, isLoading } = useListQuotes();

  const deleteMutation = useDeleteQuote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey() });
        toast({ title: "Quote deleted" });
      },
      onError: () => toast({ title: "Failed to delete quote", variant: "destructive" }),
    },
  });

  const convertMutation = useMutation({
    mutationFn: ({ id, key }: { id: number; key: string }) =>
      convertQuote(id, idempotencyRequest(key)),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey() });
      toast({ title: `Approved! Job ${(job as { jobNumber?: string }).jobNumber ?? ""} created.` });
    },
    onError: () => toast({ title: "Failed to convert quote", variant: "destructive" }),
  });

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this quote? This cannot be undone.")) return;
    deleteMutation.mutate({ id });
  };

  const handleConvert = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Approve and convert this quote to a job?")) return;
    convertMutation.mutate({ id, key: createIdempotencyKey() });
  };

  const counts = {
    all:      quotes?.length ?? 0,
    draft:    quotes?.filter((q) => q.status === "draft").length    ?? 0,
    sent:     quotes?.filter((q) => q.status === "sent").length     ?? 0,
    approved: quotes?.filter((q) => q.status === "approved").length ?? 0,
    rejected: quotes?.filter((q) => q.status === "rejected").length ?? 0,
  };

  const filtered = (quotes ?? []).filter((q) => {
    const matchStatus = filter === "all" || q.status === filter;
    const ql = search.toLowerCase();
    const matchSearch = !ql
      || q.quoteNumber.toLowerCase().includes(ql)
      || ((q as { customerName?: string }).customerName ?? "").toLowerCase().includes(ql)
      || ((q as { propertyAddress?: string }).propertyAddress ?? "").toLowerCase().includes(ql);
    return matchStatus && matchSearch;
  });

  return (
    <Layout>

      {/* ─── Page header ─────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quotes & Estimates</h1>
          <p className="text-sm text-slate-400 mt-0.5">Build and send professional proposals to clients</p>
        </div>
        <button
          onClick={() => navigate("/quotes/new")}
          className="flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-white text-sm font-bold
                     shadow-sm shadow-primary/20 hover:bg-primary/90 active:scale-[.98] transition-all"
        >
          <Plus className="w-4 h-4" /> New Quote
        </button>
      </div>

      {/* ─── Summary chips ────────────────────────────── */}
      {(quotes?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { key: "approved" as Filter, label: "Approved", icon: CheckCircle2, bg: "bg-emerald-50", text: "text-emerald-700" },
            { key: "sent"     as Filter, label: "Sent",     icon: Send,          bg: "bg-blue-50",    text: "text-blue-700"    },
            { key: "draft"    as Filter, label: "Draft",    icon: FileText,      bg: "bg-slate-50",   text: "text-slate-600"   },
            { key: "rejected" as Filter, label: "Rejected", icon: XCircle,       bg: "bg-red-50",     text: "text-red-700"     },
          ].map(({ key, label, icon: Icon, bg, text }) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? "all" : key)}
              className={`${bg} rounded-2xl px-4 py-3 text-center transition-all hover:scale-[1.02] active:scale-[.98]
                ${filter === key ? "ring-2 ring-offset-1 ring-primary/40" : ""}`}
            >
              <p className={`text-2xl font-bold ${text}`}>{counts[key]}</p>
              <div className={`flex items-center justify-center gap-1 text-xs font-semibold ${text} opacity-80 mt-0.5`}>
                <Icon className="w-3 h-3" />
                {label}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ─── Search + filter bar ──────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            placeholder="Search quote, customer, property…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 text-sm rounded-xl border border-slate-200 bg-white text-slate-900
                       placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 h-10 px-3.5 rounded-xl text-xs font-bold transition-all
                ${filter === f
                  ? "bg-primary text-white shadow-sm shadow-primary/20"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
            >
              {FILTER_LABELS[f]}
              {counts[f] > 0 && (
                <span className={`ml-1.5 px-1 rounded-full text-[10px] ${filter === f ? "bg-white/20" : "bg-slate-100"}`}>
                  {counts[f]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Quote list ───────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-2xl border border-slate-200" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-2xl border border-dashed border-slate-200">
          <FileText className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-600 font-bold mb-1">
            {search || filter !== "all" ? "No quotes match this filter" : "No quotes yet"}
          </p>
          <p className="text-slate-400 text-sm">
            {search || filter !== "all"
              ? "Try clearing your search or choosing a different filter."
              : "Create your first quote to start winning business."}
          </p>
          {search || filter !== "all" ? (
            <button
              onClick={() => { setSearch(""); setFilter("all"); }}
              className="mt-4 px-4 py-2 text-sm font-semibold text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
            >
              Clear filters
            </button>
          ) : (
            <button
              onClick={() => navigate("/quotes/new")}
              className="mt-4 flex items-center gap-2 mx-auto px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Create Quote
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote as Parameters<typeof QuoteCard>[0]["quote"]}
              onView={() => navigate(`/quotes/${quote.id}`)}
              onConvert={(e) => handleConvert(quote.id, e)}
              onDelete={(e) => handleDelete(quote.id, e)}
              convertLoading={convertMutation.isPending}
              deleteLoading={deleteMutation.isPending}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}
