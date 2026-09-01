import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { protectedFetch } from "@/lib/auth-scope";
import {
  Database,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Users,
  FileText,
  Briefcase,
  Receipt,
  Building2,
  Wrench,
  Target,
  RotateCcw,
  ArrowLeft,
  ShieldCheck,
  Clock3,
  ListChecks,
  ChevronUp,
  ChevronDown,
  Plus,
  X,
} from "lucide-react";
import { useGetFinancialCapabilities } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { hasClientCapability } from "@/lib/rbac";

interface AdminStats {
  customers: number;
  leads: number;
  properties: number;
  quotes: number;
  jobs: number;
  invoices: number;
  crews: number;
  services: number;
  recurring_plans: number;
  tasks: number;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await protectedFetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

const STAT_CARDS = [
  { key: "customers", label: "Customers", icon: Users },
  { key: "leads", label: "Prospects", icon: Target },
  { key: "properties", label: "Properties", icon: Building2 },
  { key: "quotes", label: "Quotes", icon: FileText },
  { key: "jobs", label: "Jobs", icon: Briefcase },
  { key: "invoices", label: "Invoices", icon: Receipt },
  { key: "crews", label: "Crews", icon: Users },
  { key: "services", label: "Services", icon: Wrench },
  { key: "recurring_plans", label: "Recurring Plans", icon: RefreshCw },
  { key: "tasks", label: "Tasks", icon: CheckCircle },
] as const;

export default function Settings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const capabilitiesQuery = useGetFinancialCapabilities();
  const canManageCommunicationSettings =
    capabilitiesQuery.data?.capabilities.includes("communication.settings") ??
    false;
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [purgeInput, setPurgeInput] = useState("");
  const [lastAction, setLastAction] = useState<string | null>(null);
  const canManageCatalogs =
    hasClientCapability(user, "catalogs.manage") &&
    hasClientCapability(user, "custom_fields.manage");

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: () => apiFetch("/api/admin/stats"),
  });

  const purgeMutation = useMutation({
    mutationFn: () => apiFetch("/api/admin/purge", { method: "POST" }),
    onSuccess: () => {
      setLastAction("purge");
      setPurgeConfirm(false);
      setPurgeInput("");
      refetchStats();
      qc.invalidateQueries();
    },
  });

  const totalRecords = stats
    ? Object.values(stats).reduce((s, n) => s + n, 0)
    : 0;

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-8">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-500" />
            Settings
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Database overview and system management
          </p>
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

      {/* ── Success banner ─────────────────────────────────────────── */}
      {lastAction === "purge" && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              All CRM data has been purged
            </p>
            <p className="text-xs text-emerald-600 mt-0.5">
              User accounts were preserved. The database is now empty and ready
              for a fresh start.
            </p>
          </div>
          <button
            onClick={() => setLastAction(null)}
            className="ml-auto text-emerald-400 hover:text-emerald-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Database status ────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-500" />
              Database Overview
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {statsLoading
                ? "Loading…"
                : `${totalRecords.toLocaleString()} total records across all tables`}
            </p>
          </div>
          <button
            onClick={() => refetchStats()}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {STAT_CARDS.map(({ key, label, icon: Icon }) => (
            <div
              key={key}
              className="bg-white border border-slate-200 rounded-xl p-3 text-center"
            >
              <Icon className="w-4 h-4 text-slate-400 mx-auto mb-1" />
              <div className="text-xl font-bold text-slate-900">
                {statsLoading ? "—" : (stats?.[key] ?? 0)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <CommunicationSafetySettings
        canManage={canManageCommunicationSettings}
        capabilitiesLoading={capabilitiesQuery.isLoading}
      />

      <CatalogManagement canManage={canManageCatalogs} />

      {/* ── Danger Zone ────────────────────────────────────────────── */}
      <section>
        <div className="border-2 border-red-200 rounded-xl overflow-hidden">
          <div className="bg-red-50 px-5 py-3 flex items-center gap-2 border-b border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h2 className="text-sm font-bold text-red-800">Danger Zone</h2>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Purge all CRM data
              </p>
              <p className="text-sm text-slate-500 mt-0.5">
                Permanently deletes every customer, lead, property, quote, job,
                invoice, crew, service, recurring plan, and task.
                <strong className="text-slate-700">
                  {" "}
                  User accounts that have logged in are preserved.
                </strong>
              </p>
            </div>

            {!purgeConfirm ? (
              <button
                onClick={() => setPurgeConfirm(true)}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Purge all data
              </button>
            ) : (
              <div className="space-y-3 bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-800">
                  This cannot be undone. Type{" "}
                  <span className="font-mono bg-red-100 px-1 rounded">
                    PURGE
                  </span>{" "}
                  to confirm.
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
                    className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                  >
                    {purgeMutation.isPending ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" /> Purging…
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3 h-3" /> Confirm Purge
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setPurgeConfirm(false);
                      setPurgeInput("");
                    }}
                    className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {purgeMutation.isError && (
                  <p className="text-xs text-red-600">
                    Error: {(purgeMutation.error as Error).message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

type CatalogEntry = {
  id: number | string;
  label?: string;
  name?: string;
  active?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  order?: number;
};

type CustomFieldDefinition = CatalogEntry & {
  fieldKey?: string;
  fieldType?: string;
  entityType?: string;
  required?: boolean;
};

const CATALOGS = [
  { type: "profile-types", title: "Profile types", description: "Classifications available on customer profiles." },
  { type: "profile-groups", title: "Profile groups", description: "Groups used to organize customer profiles." },
  { type: "counties", title: "Counties", description: "Service-area counties for location addresses." },
  { type: "payment-terms", title: "Payment terms", description: "Terms offered on estimates and invoices." },
  { type: "marketing-sources", title: "Marketing sources", description: "Attribution choices for incoming business." },
  { type: "service-types", title: "Service types", description: "Service classifications used by operations." },
  { type: "job-types", title: "Job types", description: "Job classifications used for scheduling and reporting." },
] as const;

function catalogRows(value: unknown): CatalogEntry[] {
  if (Array.isArray(value)) return value as CatalogEntry[];
  const result = value as { data?: CatalogEntry[]; items?: CatalogEntry[] } | null;
  return result?.data ?? result?.items ?? [];
}

function CatalogManagement({ canManage }: { canManage: boolean }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
            <ListChecks className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Catalog & field manager</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Manage reusable choices and profile fields. Changes here do not delete CRM records.
            </p>
          </div>
        </div>
        {!canManage && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            You have read-only access. An administrator with Settings access can edit these catalogs.
          </p>
        )}
      </div>
      <div className="divide-y divide-slate-100">
        {CATALOGS.map((catalog) => (
          <CatalogList key={catalog.type} {...catalog} canManage={canManage} />
        ))}
        <CustomFieldManager canManage={canManage} />
      </div>
    </section>
  );
}

function CatalogList({
  type, title, description, canManage,
}: { type: string; title: string; description: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const queryKey = ["catalog", type];
  const query = useQuery({
    queryKey,
    queryFn: () => apiFetch(`/api/catalogs/${type}?includeInactive=true`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey });
  const mutation = useMutation({
    mutationFn: ({ method, id, body }: { method: "POST" | "PATCH" | "DELETE"; id?: string | number; body?: object }) =>
      apiFetch(`/api/catalogs/${type}${id == null ? "" : `/${id}`}`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: refresh,
    onError: (error: Error) => toast({ title: `Could not update ${title.toLowerCase()}`, description: error.message, variant: "destructive" }),
  });
  const rows = catalogRows(query.data).sort((a, b) => (a.sortOrder ?? a.order ?? 0) - (b.sortOrder ?? b.order ?? 0));
  const entryLabel = (entry: CatalogEntry) => entry.label ?? entry.name ?? "Untitled";
  const toggle = (entry: CatalogEntry) => mutation.mutate({ method: "PATCH", id: entry.id, body: { active: !(entry.active ?? entry.isActive ?? true) } });
  const move = (entry: CatalogEntry, delta: number) =>
    mutation.mutate({ method: "PATCH", id: entry.id, body: { sortOrder: Math.max(0, (entry.sortOrder ?? entry.order ?? 0) + delta) } });
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><h3 className="text-sm font-bold text-slate-800">{title}</h3><p className="text-xs text-slate-500">{description}</p></div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{rows.filter((row) => row.active ?? row.isActive ?? true).length} active</span>
      </div>
      {query.isLoading ? <p className="mt-3 text-xs text-slate-400">Loading choices…</p>
        : query.isError ? <p className="mt-3 text-xs text-red-600">Catalog could not load.</p>
          : <div className="mt-3 space-y-1">
            {rows.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No choices have been added.</p> : rows.map((entry) => {
              const active = entry.active ?? entry.isActive ?? true;
              return <div key={entry.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`} />
                <span className={`min-w-0 flex-1 text-sm ${active ? "text-slate-700" : "text-slate-400 line-through"}`}>{entryLabel(entry)}</span>
                {canManage && <div className="flex items-center gap-1">
                  <button aria-label={`Move ${entryLabel(entry)} up`} onClick={() => move(entry, -1)} disabled={mutation.isPending} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><ChevronUp className="h-3.5 w-3.5" /></button>
                  <button aria-label={`Move ${entryLabel(entry)} down`} onClick={() => move(entry, 1)} disabled={mutation.isPending} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><ChevronDown className="h-3.5 w-3.5" /></button>
                  <button onClick={() => toggle(entry)} disabled={mutation.isPending} className="px-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-40">{active ? "Deactivate" : "Activate"}</button>
                  <button aria-label={`Remove ${entryLabel(entry)}`} onClick={() => window.confirm(`Remove "${entryLabel(entry)}"?`) && mutation.mutate({ method: "DELETE", id: entry.id })} disabled={mutation.isPending} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"><X className="h-3.5 w-3.5" /></button>
                </div>}
              </div>;
            })}
          </div>}
      {canManage && <form onSubmit={(event) => { event.preventDefault(); const trimmed = label.trim(); if (!trimmed) return; mutation.mutate({ method: "POST", body: { label: trimmed, active: true, sortOrder: rows.length } }, { onSuccess: () => setLabel("") }); }} className="mt-3 flex gap-2">
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={`Add ${title.toLowerCase().replace(/s$/, "")}`} className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 text-xs" />
        <button type="submit" disabled={!label.trim() || mutation.isPending} className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-800 px-2.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add</button>
      </form>}
    </div>
  );
}

function CustomFieldManager({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [template, setTemplate] = useState("all");
  const queryKey = ["custom-field-definitions"];
  const query = useQuery({ queryKey, queryFn: () => apiFetch("/api/custom-fields/definitions") });
  const rows = catalogRows(query.data) as CustomFieldDefinition[];
  const mutation = useMutation({
    mutationFn: ({ method, id, body }: { method: "POST" | "PATCH" | "DELETE"; id?: string | number; body?: object }) => apiFetch(`/api/custom-fields/definitions${id == null ? "" : `/${id}`}`, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (error: Error) => toast({ title: "Could not update custom fields", description: error.message, variant: "destructive" }),
  });
  return <div className="px-5 py-4">
    <h3 className="text-sm font-bold text-slate-800">Custom profile fields</h3>
    <p className="text-xs text-slate-500">Add optional fields to capture business-specific customer information.</p>
    <div className="mt-3 space-y-1">{query.isLoading ? <p className="text-xs text-slate-400">Loading fields…</p> : rows.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No custom fields have been defined.</p> : rows.map((field) => {
      const active = field.active ?? field.isActive ?? true;
      const name = field.label ?? field.name ?? field.fieldKey ?? "Untitled";
      return <div key={field.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2"><span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`} /><span className={`flex-1 text-sm ${active ? "text-slate-700" : "text-slate-400 line-through"}`}>{name}</span><span className="text-[10px] uppercase text-slate-400">{field.fieldType ?? "text"}</span>{canManage && <><button aria-label={`Move ${name} up`} onClick={() => mutation.mutate({ method: "PATCH", id: field.id, body: { sortOrder: Math.max(0, (field.sortOrder ?? 0) - 1) } })} className="rounded p-1 text-slate-400 hover:bg-slate-100"><ChevronUp className="h-3.5 w-3.5" /></button><button aria-label={`Move ${name} down`} onClick={() => mutation.mutate({ method: "PATCH", id: field.id, body: { sortOrder: (field.sortOrder ?? 0) + 1 } })} className="rounded p-1 text-slate-400 hover:bg-slate-100"><ChevronDown className="h-3.5 w-3.5" /></button><button onClick={() => mutation.mutate({ method: "PATCH", id: field.id, body: { active: !active } })} className="text-[11px] font-semibold text-slate-500 hover:text-slate-900">{active ? "Deactivate" : "Activate"}</button><button aria-label={`Remove ${name}`} onClick={() => window.confirm(`Remove "${name}"?`) && mutation.mutate({ method: "DELETE", id: field.id })} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-3.5 w-3.5" /></button></>}</div>;
    })}</div>
    {canManage && <form onSubmit={(event) => { event.preventDefault(); const trimmed = label.trim(); if (!trimmed) return; mutation.mutate({ method: "POST", body: { label: trimmed, fieldKey: trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), fieldType, template, active: true, sortOrder: rows.length } }, { onSuccess: () => setLabel("") }); }} className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_130px_auto]"><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Field label" className="h-8 min-w-0 rounded-lg border border-slate-200 px-2.5 text-xs" /><select value={fieldType} onChange={event => setFieldType(event.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs"><option value="text">Text</option><option value="multiline">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Yes / no</option></select><select value={template} onChange={event => setTemplate(event.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs"><option value="all">All profiles</option><option value="residential">Residential</option><option value="commercial">Commercial</option></select><button type="submit" disabled={!label.trim() || mutation.isPending} className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-slate-800 px-2.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add field</button></form>}
  </div>;
}

function CommunicationSafetySettings({
  canManage,
  capabilitiesLoading,
}: {
  canManage: boolean;
  capabilitiesLoading: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [timezone, setTimezone] = useState("America/Chicago");
  const [emailStart, setEmailStart] = useState("");
  const [emailEnd, setEmailEnd] = useState("");
  const [smsStart, setSmsStart] = useState("");
  const [smsEnd, setSmsEnd] = useState("");
  const quietQuery = useQuery<{
    timezone: string;
    email?: { start: string; end: string } | null;
    sms?: { start: string; end: string } | null;
  } | null>({
    queryKey: ["communication-quiet-hours"],
    enabled: canManage,
    queryFn: () => apiFetch("/api/communication-safety/quiet-hours"),
  });
  const suppressionsQuery = useQuery<{
    data: Array<{
      id: number;
      channel: string;
      destinationHash: string;
      reason: string;
      scope: string;
      active: boolean;
      createdAt: string;
      deactivatedAt?: string | null;
    }>;
    total: number;
  }>({
    queryKey: ["communication-suppressions"],
    enabled: canManage,
    queryFn: () =>
      apiFetch("/api/communication-safety/suppressions?pageSize=50"),
  });

  useEffect(() => {
    const config = quietQuery.data;
    if (!config) return;
    setTimezone(config.timezone);
    setEmailStart(config.email?.start ?? "");
    setEmailEnd(config.email?.end ?? "");
    setSmsStart(config.sms?.start ?? "");
    setSmsEnd(config.sms?.end ?? "");
  }, [quietQuery.data]);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/communication-safety/quiet-hours", {
        method: "PUT",
        headers: {
          "Idempotency-Key":
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : String(Date.now()),
        },
        body: JSON.stringify({
          timezone,
          emailStart: emailStart || null,
          emailEnd: emailEnd || null,
          smsStart: smsStart || null,
          smsEnd: smsEnd || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["communication-quiet-hours"] });
      toast({
        title: "Quiet hours saved",
        description:
          "The dispatcher will defer matching automation deliveries until the next allowed local time.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not save quiet hours",
        description: error.message,
        variant: "destructive",
      }),
  });
  const suppressionMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/communication-safety/suppressions/${id}`, {
        method: "PATCH",
        headers: {
          "Idempotency-Key":
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : String(Date.now()),
        },
        body: JSON.stringify({ active: false }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["communication-suppressions"] });
      toast({
        title: "Suppression deactivated",
        description: "The immutable history remains available for audit.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not deactivate suppression",
        description: error.message,
        variant: "destructive",
      }),
  });

  if (capabilitiesLoading || !canManage) return null;
  const fields = [
    ["Email quiet start", emailStart, setEmailStart],
    ["Email quiet end", emailEnd, setEmailEnd],
    ["SMS quiet start", smsStart, setSmsStart],
    ["SMS quiet end", smsEnd, setSmsEnd],
  ] as const;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
          <Clock3 className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Communication safety
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Authorized delivery controls for quiet hours and local-time
            compliance.
          </p>
        </div>
      </div>
      <div className="p-5 space-y-4">
        {quietQuery.isLoading ? (
          <p className="text-sm text-slate-400">
            Loading quiet-hours configuration…
          </p>
        ) : (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                IANA timezone
              </label>
              <input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="America/Chicago"
                className="h-9 w-full max-w-sm rounded-lg border border-slate-200 px-3 text-sm"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {fields.map(([label, value, setter]) => (
                <label
                  key={label}
                  className="text-xs font-semibold text-slate-600"
                >
                  {label}
                  <input
                    type="time"
                    value={value}
                    onChange={(event) => setter(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal"
                  />
                </label>
              ))}
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <span>
                Quiet hours are evaluated in the configured IANA timezone,
                including cross-midnight windows and daylight-saving
                transitions. Leave a channel blank to disable its quiet hours;
                matching start/end times are also treated as disabled.
              </span>
            </div>
            <button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {mutation.isPending ? "Saving…" : "Save quiet hours"}
            </button>
            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Durable suppressions
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Destination hashes only; raw destinations are never shown in
                    this list.
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-slate-400">
                  {suppressionsQuery.data?.total ?? 0} total
                </span>
              </div>
              {suppressionsQuery.isLoading ? (
                <p className="text-xs text-slate-400">Loading suppressions…</p>
              ) : (suppressionsQuery.data?.data ?? []).length === 0 ? (
                <p className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500">
                  No durable suppressions have been recorded.
                </p>
              ) : (
                <div className="space-y-2">
                  {(suppressionsQuery.data?.data ?? []).map((suppression) => (
                    <div
                      key={suppression.id}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${suppression.active ? "bg-rose-500" : "bg-slate-300"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-700">
                          {suppression.channel.toUpperCase()} ·{" "}
                          {suppression.reason.replaceAll("_", " ")} ·{" "}
                          {suppression.scope}
                        </p>
                        <p className="text-[10px] font-mono text-slate-400 truncate">
                          {suppression.destinationHash}
                        </p>
                      </div>
                      {suppression.active ? (
                        <button
                          disabled={suppressionMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Deactivate this suppression? Its history will remain immutable.",
                              )
                            )
                              suppressionMutation.mutate(suppression.id);
                          }}
                          className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <span className="text-[10px] font-semibold text-slate-400">
                          Inactive
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
