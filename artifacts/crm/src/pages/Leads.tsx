import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { protectedFetch } from "@/lib/auth-scope";
import { useCreateLead, type CreateLeadBody } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Layout } from "@/components/Layout";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Target, Phone, Mail, Search, ChevronRight, DollarSign, ChevronLeft } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const PAGE_SIZE = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  lifecycleStatus?: string | null;
  clientType?: string;
  accountType?: string | null;
  estimatedValue?: number | null;
  source?: string | null;
  notes?: string | null;
}

interface LeadPage {
  data: Lead[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

function useLeadList(params: { page: number; search: string; status: string; clientType: string }) {
  const [result, setResult] = useState<{ data: Lead[]; hasMore: boolean; total: number }>({
    data: [], hasMore: false, total: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetch_ = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    const qs = new URLSearchParams({
      page: String(params.page),
      limit: String(PAGE_SIZE),
      ...(params.search    ? { search:     params.search }    : {}),
      ...(params.status    ? { status:     params.status }    : {}),
      ...(params.clientType ? { clientType: params.clientType } : {}),
    });

    protectedFetch(`${BASE}/api/leads?${qs}`, {
      credentials: "include",
      signal: abortRef.current.signal,
    })
      .then(r => r.json())
      .then((res: LeadPage | Lead[]) => {
        if (Array.isArray(res)) {
          setResult({ data: res as Lead[], hasMore: false, total: res.length });
        } else {
          setResult({ data: res.data, hasMore: res.hasMore, total: res.data.length });
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [params.page, params.search, params.status, params.clientType]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { ...result, isLoading, refetch: fetch_ };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const leadSchema = z.object({
  firstName:      z.string().min(1, "First name is required"),
  lastName:       z.string().min(1, "Last name is required"),
  email:          z.string().email().optional().or(z.literal("")),
  phone:          z.string().optional(),
  status:         z.string().default("new"),
  clientType:     z.string().default("residential"),
  estimatedValue: z.coerce.number().optional(),
  source:         z.string().optional(),
  notes:          z.string().optional(),
});

// ─── Status colors ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new:        "bg-blue-100 text-blue-700",
  contacted:  "bg-yellow-100 text-yellow-700",
  qualified:  "bg-violet-100 text-violet-700",
  proposal:   "bg-indigo-100 text-indigo-700",
  won:        "bg-emerald-100 text-emerald-700",
  lost:       "bg-red-100 text-red-700",
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`text-[10px] font-bold rounded-full px-2.5 py-0.5 capitalize ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function LifecyclePill({ lifecycleStatus }: { lifecycleStatus: string }) {
  return (
    <span className="text-[10px] font-bold rounded-full px-2.5 py-0.5 capitalize bg-violet-100 text-violet-700">
      {lifecycleStatus}
    </span>
  );
}

const INP = "w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all";
const LBL = "block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1";

function F({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LBL}>{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Leads() {
  const [, navigate] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [search, setSearch]               = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [clientTypeFilter, setClientTypeFilter] = useState("");
  const [statusFilter, setStatusFilter]   = useState("");
  const [page, setPage]                   = useState(1);
  const { toast } = useToast();

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, clientTypeFilter]);

  const { data: leads, isLoading, hasMore, refetch } = useLeadList({
    page,
    search: debouncedSearch,
    status: statusFilter,
    clientType: clientTypeFilter,
  });

  const createMutation = useCreateLead({
    mutation: {
      onSuccess: () => {
        setIsCreateOpen(false);
        toast({ title: "Lead created successfully" });
        form.reset();
        setPage(1);
        refetch();
      },
      onError: () => toast({ title: "Failed to create lead", variant: "destructive" }),
    }
  });

  const { register, handleSubmit, formState: { errors }, reset: formReset } = useForm<z.infer<typeof leadSchema>>({
    resolver: zodResolver(leadSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", status: "new", clientType: "residential", estimatedValue: undefined },
  });
  const form = { reset: formReset };

  function onSubmit(values: z.infer<typeof leadSchema>) {
    createMutation.mutate({ data: values as CreateLeadBody });
  }

  const statuses = ["new", "contacted", "qualified", "proposal", "won", "lost"];
  const hasFilters = search || statusFilter || clientTypeFilter;

  return (
    <Layout>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sales Pipeline</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {isLoading
              ? "Loading…"
              : leads.length === 0
                ? "Track and convert prospective clients"
                : `Showing ${leads.length} lead${leads.length !== 1 ? "s" : ""}${hasMore ? "+" : ""} on page ${page}`}
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-white text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 active:scale-[.98] transition-all"
        >
          <Plus className="w-4 h-4" /> Add Lead
        </button>
      </div>

      {/* ── Search ──────────────────────────────────────────────────── */}
      <div className="relative mb-3">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
        <input
          placeholder="Search by name, email, or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full h-10 pl-10 pr-4 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        />
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { label: "All Types",   value: "" },
          { label: "Residential", value: "residential" },
          { label: "Commercial",  value: "commercial" },
        ].map(opt => (
          <button
            key={opt.value}
            onClick={() => setClientTypeFilter(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              clientTypeFilter === opt.value
                ? "bg-primary text-white border-primary"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="w-px bg-slate-200 mx-1 self-stretch" />
        <button
          onClick={() => setStatusFilter("")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            !statusFilter ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          All Status
        </button>
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s === statusFilter ? "" : s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize ${
              statusFilter === s
                ? `${STATUS_COLORS[s]} border-current`
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* ── Lead list ───────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-2.5">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 px-5 py-4 animate-pulse h-20" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-2xl border border-dashed border-slate-200">
          <Target className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-600 font-bold mb-1">
            {hasFilters ? "No leads match your filters" : "No leads yet"}
          </p>
          <p className="text-slate-400 text-sm mb-4">
            {hasFilters
              ? "Try adjusting your search or filters."
              : "Add your first lead to start tracking your pipeline."}
          </p>
          {hasFilters ? (
            <button
              onClick={() => { setSearch(""); setStatusFilter(""); setClientTypeFilter(""); }}
              className="px-4 py-2 text-sm font-semibold text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
            >
              Clear filters
            </button>
          ) : (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Lead
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map(lead => (
            <button
              key={lead.id}
              onClick={() => navigate(`/leads/${lead.id}`)}
              className="w-full text-left bg-white rounded-2xl border border-slate-200 px-5 py-4 hover:shadow-md hover:border-slate-300 active:scale-[.998] transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-violet-700">
                    {[lead.firstName?.[0], lead.lastName?.[0]].filter(Boolean).join("").toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 text-sm">
                    {lead.firstName} {lead.lastName}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {lead.email && (
                      <span className="flex items-center gap-1 text-xs text-slate-400 truncate max-w-[200px]">
                        <Mail className="w-3 h-3 shrink-0" />{lead.email}
                      </span>
                    )}
                    {lead.phone && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Phone className="w-3 h-3 shrink-0" />{lead.phone}
                      </span>
                    )}
                    {lead.estimatedValue != null && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <DollarSign className="w-3 h-3 shrink-0" />{lead.estimatedValue.toLocaleString()}
                      </span>
                    )}
                     {lead.lifecycleStatus && <LifecyclePill lifecycleStatus={lead.lifecycleStatus} />}
                     {(lead.accountType ?? lead.clientType) && (
                      <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 capitalize">
                         {lead.accountType ?? lead.clientType}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill status={lead.status} />
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── Pagination ───────────────────────────────────────────────── */}
      {(page > 1 || hasMore) && !isLoading && (
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <span className="text-sm text-slate-400 font-medium">Page {page}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!hasMore}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Create Lead Dialog ──────────────────────────────────────── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[520px] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">New Lead</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <F label="First Name" error={errors.firstName?.message}>
                <input {...register("firstName")} placeholder="John" className={INP} />
              </F>
              <F label="Last Name" error={errors.lastName?.message}>
                <input {...register("lastName")} placeholder="Doe" className={INP} />
              </F>
            </div>
            <F label="Email">
              <input type="email" {...register("email")} placeholder="john@example.com" className={INP} />
            </F>
            <div className="grid grid-cols-2 gap-3">
              <F label="Phone">
                <input {...register("phone")} placeholder="(555) 000-0000" className={INP} />
              </F>
              <F label="Client Type">
                <select {...register("clientType")} className={INP}>
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                </select>
              </F>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Status">
                <select {...register("status")} className={INP}>
                  {statuses.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </F>
              <F label="Est. Value ($)">
                <input type="number" {...register("estimatedValue")} placeholder="500" className={INP} />
              </F>
            </div>
            <F label="Source">
              <input {...register("source")} placeholder="Referral, Google, Door Hanger…" className={INP} />
            </F>
            <F label="Notes">
              <textarea {...register("notes")} rows={2} placeholder="Any notes…" className={INP + " resize-none"} />
            </F>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="w-full h-11 rounded-xl bg-primary text-white text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 active:scale-[.98] transition-all disabled:opacity-60"
            >
              {createMutation.isPending ? "Saving…" : "Create Lead"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
