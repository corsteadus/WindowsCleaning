import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Users, Trash2, RefreshCw, CheckCircle, AlertTriangle,
  Download, Upload, Database, UserMinus, RotateCcw, FileText,
  ChevronDown, ChevronUp, Lock, ArrowLeft, Plus, Loader2, ChevronRight,
} from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { protectedFetch } from "@/lib/auth-scope";
import { hasClientCapability } from "@/lib/rbac";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await protectedFetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface AdminUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string;
  createdAt: string;
}

interface AdminStats {
  customers: number; leads: number; properties: number; quotes: number;
  jobs: number; invoices: number; crews: number; services: number;
  recurring_plans: number; tasks: number;
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({
  icon: Icon, title, badge, danger, children,
}: {
  icon: React.ElementType; title: string; badge?: string; danger?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`rounded-2xl border overflow-hidden ${danger ? "border-red-200" : "border-slate-200"} bg-white`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-5 py-4 text-left ${danger ? "bg-red-50" : "bg-slate-50"}`}
      >
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${danger ? "text-red-500" : "text-slate-500"}`} />
          <span className={`font-bold text-sm ${danger ? "text-red-800" : "text-slate-800"}`}>{title}</span>
          {badge && (
            <span className="bg-primary/10 text-primary text-[11px] font-bold px-2 py-0.5 rounded-full">{badge}</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <div className="p-5 space-y-4">{children}</div>}
    </div>
  );
}

// ─── Master Users ─────────────────────────────────────────────────────────────
function MasterUsers() {
  const qc = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch("/api/admin/users"),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => { setConfirmId(null); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });

  if (isLoading) return <p className="text-sm text-slate-400 animate-pulse">Loading users…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        All accounts that have signed in via Replit authentication. These survive a data purge.
        Removing a user revokes their access — they can re-login to restore access.
      </p>
      {users.length === 0 && (
        <p className="text-sm text-slate-400 italic">No users found.</p>
      )}
      {users.map((u) => (
        <div key={u.id} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
          {u.profileImageUrl ? (
            <img src={u.profileImageUrl} alt="" className="w-8 h-8 rounded-full ring-2 ring-white" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-primary font-bold text-xs">
                {(u.firstName?.[0] || u.email?.[0] || "U").toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {u.firstName ? `${u.firstName} ${u.lastName || ""}`.trim() : u.email || u.id}
              </p>
              <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                u.role === "super_admin"
                  ? "bg-violet-100 text-violet-700"
                  : "bg-slate-100 text-slate-500"
              }`}>
                {u.role === "super_admin" ? "Super Admin" : "Admin"}
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate">{u.email}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-slate-400">
              Joined {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
            {confirmId === u.id ? (
              <div className="flex gap-1 mt-1 justify-end">
                <button
                  onClick={() => removeMutation.mutate(u.id)}
                  disabled={removeMutation.isPending}
                  className="text-[11px] bg-red-600 hover:bg-red-700 text-white rounded-md px-2 py-0.5 font-semibold"
                >
                  {removeMutation.isPending ? "…" : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="text-[11px] text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md px-2 py-0.5"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmId(u.id)}
                className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-600 transition-colors"
              >
                <UserMinus className="w-3 h-3" /> Remove
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Import Panel ─────────────────────────────────────────────────────────────

const BATCH_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  uploading:    { label: "Uploading",    color: "bg-blue-100 text-blue-700" },
  staged:       { label: "Staged",       color: "bg-amber-100 text-amber-700" },
  review:       { label: "Needs Review", color: "bg-orange-100 text-orange-700" },
  applying:     { label: "Applying…",   color: "bg-blue-100 text-blue-700" },
  applied:      { label: "Applied",      color: "bg-emerald-100 text-emerald-700" },
  rolling_back: { label: "Rolling Back", color: "bg-rose-100 text-rose-700" },
  rolled_back:  { label: "Rolled Back",  color: "bg-slate-100 text-slate-500" },
  error:        { label: "Error",        color: "bg-red-100 text-red-700" },
};

function ImportPanel() {
  const [, navigate] = useLocation();

  const { data: batches = [], isLoading } = useQuery<any[]>({
    queryKey: ["import-batches"],
    queryFn: () => apiFetch("/api/admin/import/batches"),
  });

  const recent = batches.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Intro + primary action */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-slate-600">
            Safe, staged weekly import from Customer Factor exports. Each batch is analyzed,
            reviewed for conflicts, then applied — with full rollback support.
          </p>
          <p className="text-xs text-slate-400">
            Matching by exact email or phone only. CRM data always wins on conflicts.
          </p>
        </div>
        <button
          onClick={() => navigate("/admin/import")}
          className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Start New Import Batch
        </button>
      </div>

      {/* Batch list */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Recent Batches</p>
          {batches.length > 5 && (
            <Link href="/admin/import" className="text-xs text-primary hover:underline">
              View all {batches.length}
            </Link>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading batches…
          </div>
        )}

        {!isLoading && recent.length === 0 && (
          <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
            <Database className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500 font-medium">No import batches yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Click <strong>Start New Import Batch</strong> to begin your first import.
            </p>
          </div>
        )}

        {recent.map((b: any) => {
          const cfg = BATCH_STATUS_LABELS[b.status] ?? { label: b.status, color: "bg-slate-100 text-slate-500" };
          return (
            <button
              key={b.id}
              onClick={() => navigate("/admin/import")}
              className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-primary/20 rounded-xl text-left transition-all group"
            >
              <Database className="w-5 h-5 text-slate-400 group-hover:text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800 truncate">{b.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cfg.color}`}>
                    {cfg.label}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {new Date(b.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {" · "}{b.file_count ?? 0} file{b.file_count !== 1 ? "s" : ""}
                  {" · "}{(b.staged_rows ?? 0).toLocaleString()} rows staged
                  {(b.review_count ?? 0) > 0 && (
                    <span className="text-amber-600"> · {b.review_count} need review</span>
                  )}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-primary shrink-0" />
            </button>
          );
        })}
      </div>

      {/* File category reference */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
        {[
          { label: "Active Customers",   color: "bg-blue-50 border-blue-200 text-blue-700" },
          { label: "Master Customers",   color: "bg-indigo-50 border-indigo-200 text-indigo-700" },
          { label: "Active Prospects",   color: "bg-amber-50 border-amber-200 text-amber-700" },
          { label: "Master Prospects",   color: "bg-orange-50 border-orange-200 text-orange-700" },
          { label: "Invoices",           color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
          { label: "SQL Backup",         color: "bg-violet-50 border-violet-200 text-violet-700" },
        ].map(({ label, color }) => (
          <div key={label} className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium ${color}`}>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Export Customers ─────────────────────────────────────────────────────────
function ExportCustomers() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(type: "customers" | "leads") {
    setLoading(true);
    setError(null);
    try {
      const res = await protectedFetch(`${BASE}/api/admin/export/${type}`);
      if (!res.ok) throw new Error(await res.text());
      const rows: Record<string, unknown>[] = await res.json();
      if (!rows.length) { setError("No records found to export."); return; }
      const headers = Object.keys(rows[0]);
      const csv = [
        headers.join(","),
        ...rows.map(r => headers.map(h => {
          const v = String(r[h] ?? "").replace(/"/g, '""');
          return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v}"` : v;
        }).join(","))
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `winvue_${type}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Download a CSV snapshot of all customers or leads currently in the CRM.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => handleExport("customers")}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export Customers
        </button>
        <button
          onClick={() => handleExport("leads")}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-semibold hover:bg-slate-600 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export Leads
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ─── Purge Data ───────────────────────────────────────────────────────────────
function PurgeData() {
  const qc = useQueryClient();
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [purgeInput, setPurgeInput] = useState("");
  const [done, setDone] = useState(false);

  const { data: stats } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: () => apiFetch("/api/admin/stats"),
  });

  const total = stats ? Object.values(stats).reduce((s, n) => s + n, 0) : 0;

  const purgeMutation = useMutation({
    mutationFn: () => apiFetch("/api/admin/purge", { method: "POST" }),
    onSuccess: () => {
      setDone(true);
      setPurgeConfirm(false);
      setPurgeInput("");
      qc.invalidateQueries();
    },
  });

  if (done) {
    return (
      <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-emerald-800">All CRM data purged</p>
          <p className="text-xs text-emerald-600 mt-0.5">
            User accounts preserved. The database is now empty and ready for a fresh start.
            Run the seed script to reload demo data.
          </p>
        </div>
        <button onClick={() => setDone(false)} className="ml-auto text-emerald-400 hover:text-emerald-600">✕</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Permanently deletes every customer, lead, property, quote, job, invoice, crew, service, recurring plan, and task.
        <strong className="text-slate-800"> Authenticated user accounts are preserved.</strong>
      </p>
      {stats && (
        <div className="bg-slate-50 rounded-xl p-3 flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(stats).map(([k, v]) => (
            <span key={k} className="text-xs text-slate-500">
              <span className="font-bold text-slate-800">{v}</span> {k.replace(/_/g, " ")}
            </span>
          ))}
          <span className="text-xs font-bold text-slate-700 w-full mt-1">
            {total.toLocaleString()} total records will be deleted
          </span>
        </div>
      )}
      {!purgeConfirm ? (
        <button
          onClick={() => setPurgeConfirm(true)}
          className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
        >
          <Trash2 className="w-4 h-4" /> Purge all CRM data
        </button>
      ) : (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-red-800">
            This cannot be undone. Type <span className="font-mono bg-red-100 px-1 rounded">PURGE</span> to confirm.
          </p>
          <input
            type="text"
            value={purgeInput}
            onChange={(e) => setPurgeInput(e.target.value)}
            placeholder="Type PURGE to confirm"
            className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => purgeMutation.mutate()}
              disabled={purgeInput !== "PURGE" || purgeMutation.isPending}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {purgeMutation.isPending ? (
                <><RefreshCw className="w-3 h-3 animate-spin" /> Purging…</>
              ) : (
                <><Trash2 className="w-3 h-3" /> Confirm Purge</>
              )}
            </button>
            <button
              onClick={() => { setPurgeConfirm(false); setPurgeInput(""); }}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
        <p className="text-xs text-amber-800 font-medium">To reload demo data after purging, use the <strong>Load Demo Data</strong> section above.</p>
      </div>
    </div>
  );
}

// ─── Database Overview ────────────────────────────────────────────────────────
function DatabaseOverview() {
  const { data: stats, isLoading, refetch } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: () => apiFetch("/api/admin/stats"),
  });
  const total = stats ? Object.values(stats).reduce((s, n) => s + n, 0) : 0;
  const ICONS: Record<string, React.ElementType> = {
    customers: Users, leads: FileText, properties: FileText, quotes: FileText,
    jobs: FileText, invoices: FileText, crews: Users, services: FileText,
    recurring_plans: RefreshCw, tasks: CheckCircle,
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{isLoading ? "Loading…" : `${total.toLocaleString()} total records`}</p>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition-colors">
          <RotateCcw className="w-3 h-3" /> Refresh
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {stats && Object.entries(stats).map(([k, v]) => {
          const Icon = ICONS[k] || FileText;
          return (
            <div key={k} className="bg-slate-50 rounded-xl p-3 text-center">
              <Icon className="w-4 h-4 text-slate-400 mx-auto mb-1" />
              <div className="text-xl font-bold text-slate-900">{v}</div>
              <div className="text-[10px] text-slate-400 capitalize">{k.replace(/_/g, " ")}</div>
            </div>
          );
        })}
        {isLoading && Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="bg-slate-100 rounded-xl p-3 animate-pulse h-16" />
        ))}
      </div>
    </div>
  );
}

// ─── Admin Page ───────────────────────────────────────────────────────────────
export default function Admin() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  if (!hasClientCapability(user, "admin.settings")) {
    return (
      <div className="max-w-sm mx-auto mt-20 text-center space-y-4">
        <div className="flex justify-center">
          <div className="p-4 bg-slate-100 rounded-2xl">
            <Lock className="w-8 h-8 text-slate-400" />
          </div>
        </div>
        <h2 className="text-lg font-bold text-slate-800">Access Restricted</h2>
        <p className="text-sm text-slate-500">
          The Admin Panel is only accessible to Super Admins.
          Contact your system administrator if you need access.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-900 rounded-xl">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Admin Panel</h1>
            <p className="text-xs text-slate-400">System management — Super Admin access</p>
          </div>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white
                     text-sm font-semibold text-slate-600 hover:text-slate-900 hover:border-slate-300
                     hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </Link>
      </div>

      <Section icon={Database} title="Database Overview">
        <DatabaseOverview />
      </Section>

      <Section icon={Upload} title="Import from The Customer Factor" badge="CSV · XLS · SQL">
        <ImportPanel />
      </Section>

      <Section icon={Download} title="Export Customer Data">
        <ExportCustomers />
      </Section>

      <Section icon={AlertTriangle} title="Danger Zone — Purge All Data" danger>
        <PurgeData />
      </Section>
    </div>
  );
}
