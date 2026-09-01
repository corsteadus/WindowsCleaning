import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import {
  Receipt, Search, AlertTriangle, CheckCircle2, Clock, Send,
  FileText, ChevronRight, ChevronLeft, Plus, X, Briefcase, Calculator, MapPin,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { createInvoice, type CreateInvoiceBody } from "@workspace/api-client-react";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { PropertyPicker } from "@/components/PropertyPicker";
import { protectedFetch } from "@/lib/auth-scope";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface InvoiceSummary {
  id: number;
  invoiceNumber: string;
  customerId: number;
  customerName?: string | null;
  jobId?: number | null;
  jobNumber?: string | null;
  status: string;
  totalAmount: number;
  balanceDue: number;
  dueDate?: string | null;
  paidAt?: string | null;
  propertyName?: string | null;
  propertyAddress?: string | null;
}

interface InvoiceStats {
  draft: number; sent: number; paid: number; overdue: number; pending: number;
  partial: number; partially_credited: number; credited: number; voided: number; bad_debt: number;
}

function useInvoiceStats() {
  const [stats, setStats] = useState<InvoiceStats>({
    draft: 0, sent: 0, paid: 0, overdue: 0, pending: 0, partial: 0,
    partially_credited: 0, credited: 0, voided: 0, bad_debt: 0,
  });
  useEffect(() => {
    protectedFetch(`${BASE}/api/invoices/stats`)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load invoice stats (${r.status})`);
        return r.json();
      }).then(setStats).catch(() => {});
  }, []);
  return stats;
}

function useInvoiceList(params: { page: number; status: string; search: string }) {
  const [data, setData] = useState<InvoiceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(() => {
    setIsLoading(true);
    const q = new URLSearchParams({ page: String(params.page), limit: "50" });
    if (params.status && params.status !== "all") q.set("status", params.status);
    if (params.search.trim()) q.set("search", params.search.trim());
    protectedFetch(`${BASE}/api/invoices?${q}`)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load invoices (${r.status})`);
        return r.json();
      })
      .then(res => {
        setData(Array.isArray(res) ? res : (res.data ?? []));
        setHasMore(res.hasMore ?? false);
      })
      .catch(() => setData([]))
      .finally(() => setIsLoading(false));
  }, [params.page, params.status, params.search]);

  useEffect(() => { load(); }, [load]);
  return { data, isLoading, hasMore, reload: load };
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, {
  label: string; bg: string; text: string; dot: string;
  cardBorder: string; cardBg: string;
}> = {
  draft:    { label: "Draft",    bg: "bg-slate-100",  text: "text-slate-600",    dot: "bg-slate-400",   cardBorder: "border-slate-200",    cardBg: ""                 },
  sent:     { label: "Sent",     bg: "bg-blue-50",    text: "text-blue-700",     dot: "bg-blue-400",    cardBorder: "border-blue-100",     cardBg: ""                 },
  paid:     { label: "Paid",     bg: "bg-emerald-50", text: "text-emerald-700",  dot: "bg-emerald-500", cardBorder: "border-emerald-100",  cardBg: "bg-emerald-50/30" },
  overdue:  { label: "Overdue",  bg: "bg-red-50",     text: "text-red-700",      dot: "bg-red-500",     cardBorder: "border-red-200",      cardBg: "bg-red-50/30"     },
  pending:  { label: "Pending",  bg: "bg-amber-50",   text: "text-amber-700",    dot: "bg-amber-400",   cardBorder: "border-amber-100",    cardBg: ""                 },
  partial:  { label: "Partially Paid", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", cardBorder: "border-amber-100", cardBg: "" },
  partially_credited: { label: "Partially Credited", bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500", cardBorder: "border-violet-100", cardBg: "" },
  credited: { label: "Credited", bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500", cardBorder: "border-violet-100", cardBg: "bg-violet-50/20" },
  voided: { label: "Voided", bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400", cardBorder: "border-slate-200", cardBg: "bg-slate-50/50" },
  bad_debt: { label: "Bad Debt", bg: "bg-rose-50",    text: "text-rose-700",     dot: "bg-rose-500",    cardBorder: "border-rose-200",     cardBg: "bg-rose-50/20"    },
};

function fmtDate(d?: string | null) {
  if (!d) return null;
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Status filter tabs ───────────────────────────────────────────────────────

const FILTERS = ["all", "draft", "sent", "overdue", "paid", "pending", "partial", "partially_credited", "credited", "voided", "bad_debt"] as const;
type Filter = typeof FILTERS[number];

const FILTER_LABELS: Record<Filter, string> = {
  all: "All", draft: "Draft", sent: "Sent", overdue: "Overdue", paid: "Paid",
  pending: "Pending", partial: "Partially Paid", partially_credited: "Partially Credited",
  credited: "Credited", voided: "Voided", bad_debt: "Bad Debt",
};

const UNKNOWN_STATUS_CFG = {
  bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400",
  cardBorder: "border-slate-200", cardBg: "",
};

function invoiceStatusConfig(status: string) {
  return STATUS_CFG[status] ?? {
    ...UNKNOWN_STATUS_CFG,
    label: status.trim()
      ? status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      : "Unknown",
  };
}

// ─── InvoiceCard ──────────────────────────────────────────────────────────────

function InvoiceCard({
  inv,
  onClick,
}: {
  inv: {
    id: number;
    invoiceNumber: string;
    customerId: number;
    customerName?: string | null;
    jobId?: number | null;
    jobNumber?: string | null;
    status: string;
    totalAmount: number;
    balanceDue: number;
    dueDate?: string | null;
    paidAt?: string | null;
    propertyName?: string | null;
    propertyAddress?: string | null;
  };
  onClick: () => void;
}) {
  const cfg = invoiceStatusConfig(inv.status);
  const isOverdue = inv.status === "overdue";
  const isPaid    = inv.status === "paid";
  const isClosed  = ["paid", "voided", "credited"].includes(inv.status);
  const customer  = inv.customerName ?? `Customer #${inv.customerId}`;
  const due       = fmtDate(inv.dueDate);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-2xl border border-l-4 transition-all
        hover:shadow-md hover:border-l-[5px] active:scale-[.995] group
        ${isOverdue ? "border-red-200 border-l-red-400"    : ""}
        ${isPaid    ? "border-emerald-100 border-l-emerald-400" : ""}
        ${!isOverdue && !isPaid ? "border-slate-200 border-l-slate-300 hover:border-l-primary/60" : ""}
        ${cfg.cardBg}
      `}
    >
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left */}
          <div className="flex-1 min-w-0">
            {/* Customer + invoice number */}
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <p className="font-bold text-slate-900 text-sm truncate">{customer}</p>
              {inv.jobNumber && (
                <span className="font-mono text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md">
                  {inv.jobNumber}
                </span>
              )}
            </div>
            <p className="font-mono text-xs text-slate-400">{inv.invoiceNumber}</p>
            {(inv.propertyName || inv.propertyAddress) && (
              <p className="flex items-center gap-1 mt-1 text-xs text-slate-500 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                {inv.propertyName || inv.propertyAddress}
              </p>
            )}

            {/* Due / paid date */}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {due && (
                <span className={`flex items-center gap-1 text-xs font-medium ${isOverdue ? "text-red-600" : "text-slate-500"}`}>
                  {isOverdue
                    ? <AlertTriangle className="w-3 h-3" />
                    : <Clock className="w-3 h-3" />}
                  Due {due}
                </span>
              )}
              {isPaid && inv.paidAt && (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <CheckCircle2 className="w-3 h-3" />
                  Paid {fmtDate(inv.paidAt)}
                </span>
              )}
              {!due && !isClosed && (
                <span className="text-xs text-slate-400">Due upon receipt</span>
              )}
            </div>
          </div>

          {/* Right: status + total */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-lg ${cfg.bg} ${cfg.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
            <span className="text-xl font-bold text-slate-900 tabular-nums">
              {formatCurrency(inv.totalAmount)}
            </span>
            {inv.balanceDue > 0 && !isClosed && (
              <span className={`text-xs font-bold ${isOverdue ? "text-red-600" : "text-slate-500"}`}>
                {formatCurrency(inv.balanceDue)} due
              </span>
            )}
            {isPaid && (
              <span className="text-xs font-semibold text-emerald-600">Paid in full</span>
            )}
            {inv.status === "voided" && (
              <span className="text-xs font-semibold text-slate-500">No balance due</span>
            )}
            {inv.status === "credited" && (
              <span className="text-xs font-semibold text-violet-600">Fully credited</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

type CustomerOption = {
  id: number;
  firstName: string;
  lastName: string;
  effectiveDefaultPropertyId?: number | null;
};
type JobOption = {
  id: number;
  jobNumber: string;
  status: string;
  totalAmount?: number;
  scheduledDate?: string | null;
  propertyId?: number | null;
  propertyName?: string | null;
  propertyAddress?: string | null;
};
type DraftLine = {
  id: string;
  jobId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
};

function cents(value: string): bigint {
  const raw = value.trim() || "0";
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return 0n;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}
function quantityScale(value: string): bigint {
  const raw = value.trim() || "0";
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) return 0n;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 10_000n + BigInt((fraction + "0000").slice(0, 4));
}
function previewLineTotal(line: DraftLine): bigint {
  const gross = (quantityScale(line.quantity) * cents(line.unitPrice) + 5_000n) / 10_000n;
  return gross - cents(line.discountAmount) + cents(line.taxAmount);
}

function InvoiceCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState<number | "" | undefined>(undefined);
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submitKey = useRef<string | null>(null);
  const submitInFlight = useRef(false);

  useEffect(() => {
    protectedFetch(`${BASE}/api/customers`)
      .then((response) => response.json())
      .then((data) => setCustomers(Array.isArray(data) ? data : (data.data ?? [])))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    setSelectedJobIds([]);
    setLines([]);
    setPropertyId(undefined);
    if (!customerId) {
      setJobs([]);
      return;
    }
    protectedFetch(`${BASE}/api/jobs?customerId=${customerId}`)
      .then((response) => response.json())
      .then((data) => {
        const rows = Array.isArray(data) ? data : (data.data ?? []);
        setJobs(rows.filter((job: JobOption) => job.status === "completed"));
      })
      .catch(() => setJobs([]));
  }, [customerId]);

  const selectedJobs = jobs.filter((job) => selectedJobIds.includes(job.id));
  const selectedCustomer = customers.find((customer) => customer.id === Number(customerId));
  const subtotal = lines.reduce((sum, line) => sum + previewLineTotal(line) - cents(line.taxAmount), 0n);
  const tax = lines.reduce((sum, line) => sum + cents(line.taxAmount), 0n);
  const total = subtotal + tax;
  const displayCents = (amount: bigint) => formatCurrency(Number(amount) / 100);

  const addJob = (job: JobOption) => {
    if (selectedJobIds.includes(job.id)) return;
    setSelectedJobIds((current) => [...current, job.id]);
    setLines((current) => [...current, {
      id: `job-${job.id}`,
      jobId: job.id,
      description: `Window cleaning · ${job.jobNumber}`,
      quantity: "1",
      unitPrice: String(job.totalAmount ?? 0),
      discountAmount: "",
      taxAmount: "",
    }]);
  };
  const addGeneralLine = () => setLines((current) => [...current, {
    id: `general-${Date.now()}-${current.length}`,
    jobId: null,
    description: "Additional service",
    quantity: "1",
    unitPrice: "0.00",
    discountAmount: "",
    taxAmount: "",
  }]);
  const removeLine = (line: DraftLine) => {
    setLines((current) => current.filter((candidate) => candidate.id !== line.id));
    if (line.jobId != null) setSelectedJobIds((current) => current.filter((id) => id !== line.jobId));
  };
  const updateLine = (id: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));

  const submit = async () => {
    if (submitInFlight.current) return;
    setError("");
    if (!customerId) return setError("Choose a customer.");
    if (!lines.length) return setError("Add at least one job or general line.");
    if (lines.some((line) => !line.description.trim() || previewLineTotal(line) < 0n)) {
      return setError("Each line needs a description and a non-negative total.");
    }
    submitInFlight.current = true;
    setLoading(true);
    const body: CreateInvoiceBody = {
      customerId: Number(customerId),
      propertyId: propertyId === "" ? null : propertyId,
      jobIds: selectedJobIds,
      lines: lines.map(({ id: _id, ...line }) => ({
        ...line,
        discountAmount: line.discountAmount || null,
        taxAmount: line.taxAmount || null,
      })),
      dueDate: dueDate || null,
      notes: notes || null,
    };
    try {
      const invoice = await createInvoice(body, idempotencyRequest(submitKey.current ?? (submitKey.current = createIdempotencyKey())));
      submitKey.current = null;
      onCreated(invoice.id);
    } catch (err) {
      const apiError = err as { data?: { error?: string }; response?: { data?: { error?: string } } };
      setError(apiError.data?.error ?? apiError.response?.data?.error ?? "Could not create invoice.");
    } finally {
      submitInFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 p-4 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-100">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-primary">New invoice</p>
            <h2 className="text-xl font-bold text-slate-900 mt-1">Build a customer invoice</h2>
            <p className="text-sm text-slate-400 mt-1">Combine completed jobs and add general work without losing source context.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-50"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-5">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Customer</span>
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}
              className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">Select a customer…</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.firstName} {customer.lastName}</option>)}
            </select>
          </label>

          {customerId && (
            <PropertyPicker
              customerId={Number(customerId)}
              value={propertyId}
              defaultPropertyId={selectedCustomer?.effectiveDefaultPropertyId}
              preserveEmpty
              onChange={setPropertyId}
            />
          )}

          {customerId && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div><p className="font-bold text-slate-800 text-sm">Completed jobs</p><p className="text-xs text-slate-400">Select any job to add its service total as an editable line.</p></div>
                <Briefcase className="w-4 h-4 text-slate-400" />
              </div>
              <div className="space-y-2">
                {jobs.length === 0 && <p className="text-sm text-slate-400 py-2">No completed jobs are available for this customer.</p>}
                {jobs.map((job) => {
                  const selected = selectedJobIds.includes(job.id);
                  return <button key={job.id} type="button" onClick={() => selected ? removeLine(lines.find((line) => line.jobId === job.id)!) : addJob(job)}
                    className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border text-left transition-colors ${selected ? "border-primary/40 bg-primary/5" : "border-slate-200 bg-white hover:border-primary/30"}`}>
                    <span className="min-w-0"><span className="block font-mono text-xs text-slate-500">{job.jobNumber}</span><span className="text-sm font-semibold text-slate-800">{job.propertyName || job.propertyAddress || "Service location"}</span><span className="block text-xs text-slate-400 mt-0.5">{job.scheduledDate ? fmtDate(job.scheduledDate) : "Completed service"}</span></span>
                    <span className="flex items-center gap-2"><span className="font-bold text-sm text-slate-800">{formatCurrency(job.totalAmount ?? 0)}</span>{selected ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}</span>
                  </button>;
                })}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <div><p className="font-bold text-slate-800 text-sm">Invoice lines</p><p className="text-xs text-slate-400">Use General for work that is not tied to a job.</p></div>
              <button type="button" onClick={addGeneralLine} className="flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80"><Plus className="w-3.5 h-3.5" /> Add general line</button>
            </div>
            <div className="space-y-2">
              {lines.map((line) => <div key={line.id} className="grid grid-cols-12 gap-2 items-end rounded-xl border border-slate-100 p-3">
                <label className="col-span-12 sm:col-span-4"><span className="text-[10px] font-bold uppercase text-slate-400">Description · {line.jobId == null ? "General" : jobs.find((job) => job.id === line.jobId)?.jobNumber}</span><input value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm" /></label>
                <label className="col-span-4 sm:col-span-1"><span className="text-[10px] font-bold uppercase text-slate-400">Qty</span><input inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm" /></label>
                <label className="col-span-8 sm:col-span-2"><span className="text-[10px] font-bold uppercase text-slate-400">Unit price</span><input inputMode="decimal" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm" /></label>
                <label className="col-span-5 sm:col-span-2"><span className="text-[10px] font-bold uppercase text-slate-400">Discount</span><input inputMode="decimal" value={line.discountAmount} onChange={(event) => updateLine(line.id, { discountAmount: event.target.value })} className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm" /></label>
                <label className="col-span-5 sm:col-span-2"><span className="text-[10px] font-bold uppercase text-slate-400">Tax</span><input inputMode="decimal" value={line.taxAmount} onChange={(event) => updateLine(line.id, { taxAmount: event.target.value })} className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm" /></label>
                <button type="button" onClick={() => removeLine(line)} className="col-span-2 sm:col-span-1 h-9 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"><X className="w-4 h-4 mx-auto" /></button>
              </div>)}
              {!lines.length && <div className="py-7 rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-400">Choose a completed job or add a general line.</div>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label><span className="text-xs font-bold uppercase tracking-wide text-slate-500">Due date</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-2 w-full h-10 rounded-xl border border-slate-200 px-3 text-sm" /></label>
            <label><span className="text-xs font-bold uppercase tracking-wide text-slate-500">Notes</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional note" className="mt-2 w-full h-10 rounded-xl border border-slate-200 px-3 text-sm" /></label>
          </div>
          <div className="rounded-2xl bg-slate-900 text-white p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Calculator className="w-4 h-4 text-sky-300" /> Exact invoice preview</div>
            <div className="text-right"><p className="text-xs text-slate-400">Subtotal {displayCents(subtotal)} · Tax {displayCents(tax)}</p><p className="text-2xl font-bold tabular-nums">{displayCents(total)}</p></div>
          </div>
          {error && <p className="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="h-10 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={loading} className="h-10 px-5 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-60">{loading ? "Creating…" : "Create invoice"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Invoices() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  // Debounce search to avoid rapid API calls while typing
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [filter]);

  const stats = useInvoiceStats();
  const { data: invoices, isLoading, hasMore } = useInvoiceList({ page, status: filter, search: debouncedSearch });

  const counts: Record<string, number> = {
    all:      stats.draft + stats.sent + stats.overdue + stats.paid + stats.pending + stats.partial
      + (stats.partially_credited ?? 0) + (stats.credited ?? 0) + (stats.voided ?? 0) + stats.bad_debt,
    draft:    stats.draft,
    sent:     stats.sent,
    overdue:  stats.overdue,
    paid:     stats.paid,
    pending:  stats.pending,
    partial:  stats.partial,
    partially_credited: stats.partially_credited ?? 0,
    credited: stats.credited ?? 0,
    voided: stats.voided ?? 0,
    bad_debt: stats.bad_debt,
  };

  const overdueList = filter === "all" ? invoices.filter(i => i.status === "overdue") : (filter === "overdue" ? invoices : []);

  return (
    <Layout>

      {/* ─── Page header ──────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Invoices</h1>
          <p className="text-sm text-slate-400 mt-0.5">Track payments and outstanding balances</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 h-10 px-4 rounded-xl bg-primary text-white text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90">
          <Plus className="w-4 h-4" /> New invoice
        </button>
      </div>

      {/* ─── Summary chips ────────────────────────────── */}
      {(invoices?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Overdue", value: counts.overdue, bg: "bg-red-50",     text: "text-red-700",     icon: AlertTriangle },
            { label: "Sent",    value: counts.sent,    bg: "bg-blue-50",    text: "text-blue-700",    icon: Send },
            { label: "Paid",    value: counts.paid,    bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle2 },
            { label: "Draft",   value: counts.draft,   bg: "bg-slate-50",   text: "text-slate-600",   icon: FileText },
          ].map(({ label, value, bg, text, icon: Icon }) => (
            <button
              key={label}
              onClick={() => setFilter(filter === label.toLowerCase() as Filter ? "all" : label.toLowerCase() as Filter)}
              className={`${bg} rounded-2xl px-4 py-3 text-center transition-all hover:scale-[1.02] active:scale-[.98]
                ${filter === label.toLowerCase() ? "ring-2 ring-offset-1 ring-primary/40" : ""}`}
            >
              <p className={`text-2xl font-bold ${text}`}>{value}</p>
              <div className={`flex items-center justify-center gap-1 text-xs font-semibold ${text} opacity-80 mt-0.5`}>
                <Icon className="w-3 h-3" />
                {label}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ─── Overdue alert ────────────────────────────── */}
      {overdueList.length > 0 && filter !== "overdue" && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-3.5 mb-5">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <div className="flex-1">
            <p className="font-bold text-red-800 text-sm">
              {overdueList.length} overdue invoice{overdueList.length !== 1 ? "s" : ""}
            </p>
            <p className="text-red-600 text-xs mt-0.5">
              {formatCurrency(overdueList.reduce((s, i) => s + i.balanceDue, 0))} outstanding
            </p>
          </div>
          <button
            onClick={() => setFilter("overdue")}
            className="flex items-center gap-1 text-xs font-bold text-red-700 hover:text-red-800 transition-colors"
          >
            Review <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ─── Search + filter bar ──────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            placeholder="Search invoice, customer, job…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 text-sm rounded-xl border border-slate-200 bg-white text-slate-900
                       placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          />
        </div>

        {/* Status filter chips */}
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

      {/* ─── Invoice list ─────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-2xl border border-slate-200" />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-2xl border border-dashed border-slate-200">
          <Receipt className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-600 font-bold mb-1">
            {search || filter !== "all" ? "No invoices match this filter" : "No invoices yet"}
          </p>
          <p className="text-slate-400 text-sm">
            {search || filter !== "all"
              ? "Try clearing your search or filter."
              : "Complete a job and click \"Generate Invoice\" to get started."}
          </p>
          {(search || filter !== "all") && (
            <button
              onClick={() => { setSearch(""); setFilter("all"); setPage(1); }}
              className="mt-4 px-4 py-2 text-sm font-semibold text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {invoices.map((inv) => (
            <InvoiceCard
              key={inv.id}
              inv={inv}
              onClick={() => navigate(`/invoices/${inv.id}`)}
            />
          ))}
        </div>
      )}

      {/* ─── Pagination ───────────────────────────────── */}
      {!isLoading && (page > 1 || hasMore) && (
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <span className="text-sm text-slate-500 font-medium">Page {page}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!hasMore}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
      {showCreate && <InvoiceCreateDialog onClose={() => setShowCreate(false)} onCreated={(id) => { setShowCreate(false); navigate(`/invoices/${id}`); }} />}
     </Layout>
  );
}
