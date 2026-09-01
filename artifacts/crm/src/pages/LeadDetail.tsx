import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, User, StickyNote, FileText, Activity,
  Phone, Mail, MapPin, DollarSign, Clock, Edit2, X, Save, ChevronRight, Plus, Paperclip,
} from "lucide-react";
import { FilesTab } from "@/components/FilesTab";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { protectedFetch } from "@/lib/auth-scope";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ActivityLog {
  id: number;
  action: string;
  fromValue?: string | null;
  toValue?: string | null;
  reason?: string | null;
  note?: string | null;
  performedBy?: string | null;
  createdAt: string;
}

interface LeadDetail {
  id: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  status: string;
  source?: string | null;
  notes?: string | null;
  estimatedValue?: number | null;
  followUpDate?: string | null;
  assignedTo?: string | null;
  lostReason?: string | null;
  clientType?: string | null;
  accountType?: string | null;
  lifecycleStatus?: "prospect" | "customer" | "inactive" | "archived" | null;
  convertedCustomerId?: number | null;
  createdAt: string;
  updatedAt: string;
  activityLogs: ActivityLog[];
}

interface DuplicateCandidate {
  id: number;
  firstName: string;
  lastName: string;
  companyName?: string | null;
  lifecycleStatus: "prospect" | "customer" | "inactive" | "archived";
  accountType: "residential" | "commercial";
  matchTypes: Array<"email" | "phone">;
}

interface DuplicateCandidateResponse {
  candidateCount: number;
  candidates: DuplicateCandidate[];
}

// ─── Tab config ───────────────────────────────────────────────────────────────
type Tab = "overview" | "notes" | "files" | "quotes" | "activity";
const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview",  label: "Overview",  icon: User },
  { id: "notes",     label: "Notes",     icon: StickyNote },
  { id: "files",     label: "Files",     icon: Paperclip },
  { id: "quotes",    label: "Quotes",    icon: FileText },
  { id: "activity",  label: "Activity",  icon: Activity },
];

const STATUS_COLORS: Record<string, string> = {
  new:        "bg-blue-100 text-blue-700",
  contacted:  "bg-yellow-100 text-yellow-700",
  qualified:  "bg-violet-100 text-violet-700",
  proposal:   "bg-indigo-100 text-indigo-700",
  won:        "bg-emerald-100 text-emerald-700",
  lost:       "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`text-[10px] font-bold rounded-full px-2.5 py-0.5 capitalize ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { goBack, backLabel } = useBackNavigation("/prospects");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [isEditing, setIsEditing] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [conversionMode, setConversionMode] = useState<"new" | "existing">("new");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [confirmLost, setConfirmLost] = useState(false);
  const [form, setForm] = useState<Partial<LeadDetail>>({});
  const [emailModal, setEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  const { data: lead, isLoading, error } = useQuery<LeadDetail>({
    queryKey: ["lead", id],
    queryFn: async () => {
      const res = await protectedFetch(`/api/leads/${id}`);
      if (!res.ok) throw new Error("Prospect not found");
      return res.json();
    },
  });

  const customerSearchQuery = useQuery<{ customers: Array<{
    id: number;
    firstName: string;
    lastName: string;
    companyName?: string | null;
    email?: string | null;
    lifecycleStatus?: string | null;
    accountType?: string | null;
  }> }>({
    queryKey: ["customers", "conversion-search", customerSearch],
    enabled: confirmConvert && conversionMode === "existing",
    queryFn: async () => {
      const params = new URLSearchParams({ search: customerSearch, limit: "20" });
      const res = await protectedFetch(`${BASE}/api/customers?${params}`);
      if (!res.ok) throw new Error("Customer search failed");
      return res.json();
    },
    staleTime: 30_000,
  });

  const duplicateCandidatesQuery = useQuery<DuplicateCandidateResponse>({
    queryKey: ["lead", id, "duplicate-candidates"],
    enabled: confirmConvert,
    queryFn: async () => {
      const res = await protectedFetch(`${BASE}/api/leads/${id}/duplicate-candidates`);
      if (!res.ok) throw new Error("Duplicate check failed");
      return res.json();
    },
    staleTime: 0,
  });

  const strongCandidates = duplicateCandidatesQuery.data?.candidates ?? [];
  const duplicateCheckReady = !duplicateCandidatesQuery.isLoading && !duplicateCandidatesQuery.isError;

  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<LeadDetail>) => {
      const res = await protectedFetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      toast({ title: "Prospect saved" });
      setIsEditing(false);
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const addNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      const res = await protectedFetch(`/api/leads/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) throw new Error("Failed to add note");
      return res.json();
    },
    onSuccess: (log: ActivityLog) => {
      queryClient.setQueryData<LeadDetail>(["lead", id], (current) => current
        ? { ...current, activityLogs: [log, ...current.activityLogs] }
        : current,
      );
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      setNoteText("");
      toast({ title: "Note added" });
    },
    onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: async (payload: {
      existingCustomerId?: number;
      createSeparateAccount?: boolean;
      overrideReason?: string;
    }) => {
      const res = await protectedFetch(`/api/leads/${id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? "Convert failed");
      }
      return res.json();
    },
    onSuccess: (customer) => {
      toast({ title: "Prospect converted to customer!" });
      navigate(`/customers/${customer.id}`);
    },
    onError: (conversionError: Error) => toast({
      title: "Conversion failed",
      description: conversionError.message,
      variant: "destructive",
    }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ status, reason }: { status: string; reason?: string }) => {
      const res = await protectedFetch(`/api/leads/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason }),
      });
      if (!res.ok) throw new Error("Status update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Status update failed", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="p-6 flex items-center justify-center h-64">
          <div className="animate-pulse text-slate-400">Loading prospect…</div>
        </div>
      </Layout>
    );
  }

  if (error || !lead) {
    return (
      <Layout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">Prospect not found.</div>
          <button onClick={goBack} className="mt-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="w-3.5 h-3.5" /> {backLabel ?? "Prospects"}
          </button>
        </div>
      </Layout>
    );
  }

  const fullName = `${lead.firstName} ${lead.lastName}`;
  const initials = [lead.firstName?.[0], lead.lastName?.[0]].filter(Boolean).join("").toUpperCase();

  function startEdit() {
    setForm({
      firstName:      lead!.firstName,
      lastName:       lead!.lastName,
      email:          lead!.email,
      phone:          lead!.phone,
      address:        lead!.address,
      city:           lead!.city,
      state:          lead!.state,
      zip:            lead!.zip,
      source:         lead!.source,
      estimatedValue: lead!.estimatedValue,
      followUpDate:   lead!.followUpDate,
      assignedTo:     lead!.assignedTo,
       clientType:     lead!.clientType,
       accountType:     lead!.accountType ?? lead!.clientType,
    });
    setIsEditing(true);
  }

  function handleSave() {
    saveMutation.mutate(form);
  }

  const INP = "mt-1 w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white";
  const LBL = "text-[10px] font-semibold uppercase tracking-wider text-slate-400";

  return (
    <Layout>
      <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <button onClick={goBack}
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50 transition-colors shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> {backLabel ?? "Prospects"}
            </button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-violet-100 flex items-center justify-center shrink-0">
                <span className="text-base font-bold text-violet-700">{initials}</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{fullName}</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={lead.status} />
                  <span className="text-[10px] font-bold rounded-full px-2.5 py-0.5 capitalize bg-violet-100 text-violet-700">
                    {lead.lifecycleStatus ?? "prospect"}
                  </span>
                  {(lead.accountType ?? lead.clientType) && (
                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 capitalize">
                      {lead.accountType ?? lead.clientType}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400">Prospect #{lead.id}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {!isEditing && lead.email && (
              <button
                onClick={() => setEmailModal(true)}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-blue-200 text-blue-700 bg-white text-xs font-semibold hover:bg-blue-50 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" /> Send Email
              </button>
            )}
            {lead.status !== "won" && lead.status !== "lost" && (
              <>
                <button
                  onClick={() => setConfirmLost(true)}
                  disabled={statusMutation.isPending}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-red-200 text-red-600 bg-white text-xs font-semibold hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  Mark Lost
                </button>
                <button
                   onClick={() => {
                     setConversionMode("new");
                     setCustomerSearch("");
                     setSelectedCustomerId(null);
                      setOverrideReason("");
                      setOverrideConfirmed(false);
                     setConfirmConvert(true);
                   }}
                  disabled={convertMutation.isPending}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-emerald-200 text-emerald-700 bg-white text-xs font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-50"
                >
                  Convert to Customer
                </button>
              </>
            )}
            {lead.convertedCustomerId && (
              <Link
                href={`/customers/${lead.convertedCustomerId}`}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-emerald-200 text-emerald-700 bg-emerald-50 text-xs font-semibold hover:bg-emerald-100 transition-colors"
              >
                View Customer Account <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            )}
            {isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saveMutation.isPending ? "Saving…" : "Save Changes"}
                </button>
              </>
            ) : (
              <button
                onClick={startEdit}
                className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>
        </div>

        {/* ── One-off email modal ─────────────────────────────────────────── */}
        {emailModal && (
          <Dialog open onOpenChange={() => { setEmailModal(false); setEmailSubject(""); setEmailBody(""); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Send Email to {lead.firstName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-sm text-slate-600">
                  To: <span className="font-semibold text-slate-800">{lead.email}</span>
                </div>
                <div className="space-y-1">
                  <Label>Subject</Label>
                  <input
                    value={emailSubject}
                    onChange={e => setEmailSubject(e.target.value)}
                    placeholder="Subject line…"
                    className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Message <span className="text-slate-400 font-normal text-xs">(plain text or HTML)</span></Label>
                  <textarea
                    value={emailBody}
                    onChange={e => setEmailBody(e.target.value)}
                    rows={7}
                    placeholder={"Hi " + lead.firstName + ",\n\nYour message here…"}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none font-mono"
                  />
                </div>
              </div>
              <DialogFooter className="gap-2">
                <button
                  onClick={() => { setEmailModal(false); setEmailSubject(""); setEmailBody(""); }}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={emailSending || !emailSubject.trim() || !emailBody.trim()}
                  onClick={async () => {
                    setEmailSending(true);
                    try {
                      const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");
                      const res = await protectedFetch(`${BASE}/api/emails/send-one`, {
                        method: "POST",
                        credentials: "include",
                        headers: {
                          "Content-Type": "application/json",
                          "Idempotency-Key": crypto.randomUUID(),
                        },
                        body: JSON.stringify({
                          entityType: "lead",
                          entityId: lead.id,
                          email: lead.email,
                          firstName: lead.firstName,
                          lastName: lead.lastName,
                          subject: emailSubject,
                          bodyHtml: emailBody,
                        }),
                      });
                      if (!res.ok) throw new Error("Send failed");
                      toast({ title: "Email sent!", description: `Sent to ${lead.email}` });
                      queryClient.invalidateQueries({ queryKey: ["lead", id] });
                      setEmailModal(false);
                      setEmailSubject("");
                      setEmailBody("");
                    } catch {
                      toast({ title: "Failed to send email", variant: "destructive" });
                    } finally {
                      setEmailSending(false);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {emailSending ? "Sending…" : "Send Email"}
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* ── Stat Cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2 bg-violet-50 text-violet-600">
              <DollarSign className="w-4 h-4" />
            </div>
            <p className="text-lg font-bold text-slate-900">
              {lead.estimatedValue != null ? `$${lead.estimatedValue.toLocaleString()}` : "—"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Est. Value</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2 bg-blue-50 text-blue-600">
              <Clock className="w-4 h-4" />
            </div>
            <p className="text-lg font-bold text-slate-900 capitalize">{lead.status.replace("_", " ")}</p>
            <p className="text-xs text-slate-400 mt-0.5">Status</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2 bg-emerald-50 text-emerald-600">
              <Activity className="w-4 h-4" />
            </div>
            <p className="text-lg font-bold text-slate-900">{lead.activityLogs.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">Activities</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2 bg-amber-50 text-amber-600">
              <FileText className="w-4 h-4" />
            </div>
            <p className="text-sm font-bold text-slate-900">
              {lead.followUpDate
                ? new Date(lead.followUpDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : "—"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Follow-up</p>
          </div>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px">
          {TABS.map(t => {
            const Icon = t.icon;
            const count = t.id === "activity" ? lead.activityLogs.length : null;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap rounded-t-lg transition-colors border-b-2 -mb-px
                  ${activeTab === t.id
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {count !== null && (
                  <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${activeTab === t.id ? "bg-primary/15 text-primary" : "bg-slate-100 text-slate-500"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab Content ─────────────────────────────────────────────────── */}
        <div>
          {/* Overview */}
          {activeTab === "overview" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Contact */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Contact</p>
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={LBL}>First Name</label><input value={form.firstName ?? ""} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className={INP} /></div>
                      <div><label className={LBL}>Last Name</label><input value={form.lastName ?? ""} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className={INP} /></div>
                    </div>
                    <div><label className={LBL}>Email</label><input type="email" value={form.email ?? ""} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={INP} /></div>
                    <div><label className={LBL}>Phone</label><input value={form.phone ?? ""} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={INP} /></div>
                      <div><label className={LBL}>Account Type</label>
                       <select value={form.accountType ?? form.clientType ?? "residential"} onChange={e => setForm(f => ({ ...f, accountType: e.target.value }))} className={INP}>
                        <option value="residential">Residential</option>
                        <option value="commercial">Commercial</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {lead.email && <div className="flex items-center gap-2 text-sm text-slate-700"><Mail className="w-4 h-4 text-slate-400 shrink-0" />{lead.email}</div>}
                    {lead.phone && <div className="flex items-center gap-2 text-sm text-slate-700"><Phone className="w-4 h-4 text-slate-400 shrink-0" />{lead.phone}</div>}
                    {(lead.address || lead.city) && (
                      <div className="flex items-start gap-2 text-sm text-slate-700">
                        <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <span>{[lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                    {!lead.email && !lead.phone && !lead.address && (
                      <p className="text-sm text-slate-400 italic">No contact info</p>
                    )}
                  </div>
                )}
              </div>

              {/* Prospect Details */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Prospect Details</p>
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={LBL}>Status</label>
                        <select value={form.status ?? lead.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={INP}>
                          {["new","contacted","qualified","proposal","won","lost"].map(s => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                          ))}
                        </select>
                      </div>
                      <div><label className={LBL}>Est. Value ($)</label><input type="number" value={form.estimatedValue ?? ""} onChange={e => setForm(f => ({ ...f, estimatedValue: e.target.value ? Number(e.target.value) : null }))} className={INP} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={LBL}>Source</label><input value={form.source ?? ""} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className={INP} /></div>
                      <div><label className={LBL}>Follow-up Date</label><input type="date" value={form.followUpDate ?? ""} onChange={e => setForm(f => ({ ...f, followUpDate: e.target.value }))} className={INP} /></div>
                    </div>
                    <div><label className={LBL}>Assigned To</label><input value={form.assignedTo ?? ""} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} className={INP} /></div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Row label="Pipeline"><StatusBadge status={lead.status} /></Row>
                    <Row label="Lifecycle"><span className="text-sm font-semibold text-violet-700 capitalize">{lead.lifecycleStatus ?? "prospect"}</span></Row>
                    <Row label="Account Type">{(lead.accountType ?? lead.clientType) ? <span className="capitalize text-sm text-slate-700">{lead.accountType ?? lead.clientType}</span> : <em className="text-slate-300 text-sm">—</em>}</Row>
                    <Row label="Source">{lead.source ?? <em className="text-slate-300 text-sm">—</em>}</Row>
                    <Row label="Follow-up">{lead.followUpDate ? new Date(lead.followUpDate + "T12:00:00").toLocaleDateString() : <em className="text-slate-300 text-sm">—</em>}</Row>
                    <Row label="Assigned To">{lead.assignedTo ?? <em className="text-slate-300 text-sm">—</em>}</Row>
                    {lead.lostReason && <Row label="Lost Reason"><span className="text-red-600 text-sm">{lead.lostReason}</span></Row>}
                    <Row label="Created">{new Date(lead.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</Row>
                  </div>
                )}
              </div>

              {/* Address (editing only - otherwise shown inline above) */}
              {isEditing && (
                <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Address</p>
                  <div><label className={LBL}>Street</label><input value={form.address ?? ""} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={INP} /></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className={LBL}>City</label><input value={form.city ?? ""} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className={INP} /></div>
                    <div><label className={LBL}>State</label><input value={form.state ?? ""} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} className={INP} /></div>
                    <div><label className={LBL}>Zip</label><input value={form.zip ?? ""} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} className={INP} /></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Files */}
          {activeTab === "files" && (
            <FilesTab entityType="lead" entityId={lead.id} />
          )}

          {/* Quotes */}
          {activeTab === "quotes" && (
            <LeadQuotesTab leadId={lead.id} />
          )}

          {/* Notes Log */}
          {activeTab === "notes" && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Add Note</p>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  rows={3}
                  placeholder="Log a call, email, meeting, or any update…"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none"
                />
                <button
                  onClick={() => { if (noteText.trim()) addNoteMutation.mutate(noteText); }}
                  disabled={addNoteMutation.isPending || !noteText.trim()}
                  className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {addNoteMutation.isPending ? "Saving…" : "Add Note"}
                </button>
              </div>

              <div className="space-y-2">
                {lead.activityLogs
                  .filter(l => l.action === "note_added")
                  .map(log => (
                    <div key={log.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{log.note}</p>
                      <p className="text-[10px] text-slate-400 mt-1.5">
                        {new Date(log.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        {log.performedBy && ` · ${log.performedBy}`}
                      </p>
                    </div>
                  ))}
                {lead.activityLogs.filter(l => l.action === "note_added").length === 0 && (
                  <div className="py-12 text-center text-slate-300">
                    <StickyNote className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-sm">No notes yet</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Activity */}
          {activeTab === "activity" && (
            <div className="space-y-2">
              {lead.activityLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-300">
                  <Activity className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-sm">No activity yet</p>
                </div>
              ) : (
                <div className="relative pl-6">
                  <div className="absolute left-2.5 top-0 bottom-0 w-px bg-slate-100" />
                  {lead.activityLogs.map(log => (
                    <div key={log.id} className="relative mb-4">
                      <div className={`absolute -left-3.5 top-1.5 w-2.5 h-2.5 rounded-full border-2 ${
                        log.action === "email_sent" ? "bg-blue-200 border-blue-500" :
                        log.action === "status_changed" && log.toValue === "lost" ? "bg-red-200 border-red-500" :
                        log.action === "status_changed" && log.toValue === "won"  ? "bg-emerald-200 border-emerald-500" :
                        "bg-primary/20 border-primary/60"
                      }`} />
                      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{formatAction(log.action)}</span>
                          <span className="text-[10px] text-slate-400">{new Date(log.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        {log.note && <p className="text-sm text-slate-700 whitespace-pre-wrap">{log.note}</p>}
                        {log.fromValue && log.toValue && (
                          <p className="text-xs text-slate-500">
                            <span className="font-medium">{log.fromValue}</span>
                            {" → "}
                            <span className="font-medium text-primary">{log.toValue}</span>
                          </p>
                        )}
                        {log.reason && <p className="text-xs text-slate-500 mt-0.5">Reason: {log.reason}</p>}
                        {log.performedBy && <p className="text-[10px] text-slate-400 mt-1">{log.performedBy}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Confirm Convert Dialog ───────────────────────────────────────── */}
      <Dialog open={confirmConvert} onOpenChange={setConfirmConvert}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-emerald-700">Convert to Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-slate-600">
              Choose exactly how to resolve <span className="font-semibold">{lead?.firstName} {lead?.lastName}</span>.
              The system never auto-merges leads and customers.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "new" as const, title: "Create new customer", detail: "Copy this lead into a new customer account." },
                { value: "existing" as const, title: "Link existing customer", detail: "Reuse an existing account and preserve its ID/history." },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setConversionMode(option.value);
                    setSelectedCustomerId(null);
                  }}
                  className={`text-left rounded-xl border px-3 py-3 transition-colors ${
                    conversionMode === option.value
                      ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-bold text-slate-800">{option.title}</p>
                  <p className="text-xs text-slate-500 mt-1">{option.detail}</p>
                </button>
              ))}
            </div>
            {duplicateCandidatesQuery.isLoading && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                Checking for matching contact details…
              </div>
            )}
            {duplicateCandidatesQuery.isError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                The duplicate check could not complete. Close this dialog and try again.
              </div>
            )}
            {duplicateCheckReady && strongCandidates.length === 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-800">
                No strong email or phone match was found. Similar names, companies, addresses, or multiple properties do not block creating a separate account.
              </div>
            )}
            {duplicateCheckReady && strongCandidates.length > 0 && (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    Possible existing account{strongCandidates.length === 1 ? "" : "s"} found
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    These are contact-detail candidates only. Names, addresses, and multiple properties are not duplicate rules. Choose an account below, or explicitly confirm creating a separate account.
                  </p>
                </div>
                <div className="space-y-1.5">
                  {strongCandidates.map(candidate => {
                    const blocked = candidate.lifecycleStatus === "inactive" || candidate.lifecycleStatus === "archived";
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        disabled={blocked}
                        onClick={() => {
                          setConversionMode("existing");
                          setSelectedCustomerId(candidate.id);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left ${
                          selectedCustomerId === candidate.id
                            ? "border-emerald-500 bg-emerald-50"
                            : blocked
                              ? "border-amber-100 bg-white/60 opacity-60"
                              : "border-amber-200 bg-white hover:border-amber-400"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-800">
                            {candidate.firstName} {candidate.lastName}
                            {candidate.companyName && <span className="font-normal text-slate-400"> · {candidate.companyName}</span>}
                          </span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            {candidate.lifecycleStatus}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Matched by {candidate.matchTypes.join(" and ")}
                          {blocked ? " · Reactivate before linking" : " · Select to use this account"}
                        </p>
                      </button>
                    );
                  })}
                </div>
                {conversionMode === "new" && (
                  <div className="space-y-2 border-t border-amber-200 pt-3">
                    <label className="flex items-start gap-2 text-xs text-amber-900">
                      <input
                        type="checkbox"
                        checked={overrideConfirmed}
                        onChange={event => setOverrideConfirmed(event.target.checked)}
                        className="mt-0.5"
                      />
                      <span>I checked the possible matches and want a separate account anyway.</span>
                    </label>
                    <textarea
                      value={overrideReason}
                      onChange={event => setOverrideReason(event.target.value)}
                      placeholder="Why should this be a separate account?"
                      maxLength={500}
                      rows={2}
                      className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                    <p className="text-[11px] text-amber-800">A short reason is required and will be recorded in the lead activity history.</p>
                  </div>
                )}
              </div>
            )}
            {conversionMode === "existing" && (
              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Search existing customers
                </label>
                <input
                  value={customerSearch}
                  onChange={event => setCustomerSearch(event.target.value)}
                  placeholder="Search by name, company, email, or phone…"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <div className="max-h-44 overflow-y-auto space-y-1">
                  {(customerSearchQuery.data?.customers ?? []).map(candidate => {
                    const blocked = candidate.lifecycleStatus === "inactive" || candidate.lifecycleStatus === "archived";
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        disabled={blocked}
                        onClick={() => setSelectedCustomerId(candidate.id)}
                        className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                          selectedCustomerId === candidate.id
                            ? "border-emerald-500 bg-emerald-50"
                            : blocked
                              ? "border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed"
                              : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-800">
                            {candidate.firstName} {candidate.lastName}
                            {candidate.companyName && <span className="font-normal text-slate-400"> · {candidate.companyName}</span>}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-500 capitalize">
                            {candidate.lifecycleStatus ?? "customer"}
                          </span>
                        </div>
                        {candidate.email && <p className="text-xs text-slate-400 mt-0.5">{candidate.email}</p>}
                        {blocked && <p className="text-[10px] text-red-500 mt-0.5">Reactivate before linking</p>}
                      </button>
                    );
                  })}
                  {customerSearchQuery.isLoading && <p className="text-xs text-slate-400 py-2">Searching customers…</p>}
                  {!customerSearchQuery.isLoading && customerSearch && (customerSearchQuery.data?.customers ?? []).length === 0 && (
                    <p className="text-xs text-slate-400 py-2">No matching customers. No account will be merged automatically.</p>
                  )}
                </div>
              </div>
            )}
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              Existing accounts are never selected or merged automatically. Multiple properties for one account are normal.
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setConfirmConvert(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (conversionMode === "existing") {
                  if (selectedCustomerId !== null) {
                    convertMutation.mutate({ existingCustomerId: selectedCustomerId });
                  }
                  return;
                }
                if (strongCandidates.length > 0) {
                  convertMutation.mutate({
                    createSeparateAccount: true,
                    overrideReason: overrideReason.trim(),
                  });
                  return;
                }
                convertMutation.mutate({});
              }}
              disabled={
                convertMutation.isPending
                || !duplicateCheckReady
                || (conversionMode === "existing" && selectedCustomerId === null)
                || (conversionMode === "new" && strongCandidates.length > 0 && (
                  !overrideConfirmed || !overrideReason.trim()
                ))
              }
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60"
            >
              {convertMutation.isPending
                ? "Converting…"
                : conversionMode === "existing"
                  ? "Link Customer"
                  : "Create Customer"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm Mark Lost Dialog ─────────────────────────────────────── */}
      <Dialog open={confirmLost} onOpenChange={setConfirmLost}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-600">Mark Prospect as Lost</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-1">
            Mark <span className="font-semibold">{lead?.firstName} {lead?.lastName}</span> as lost?
            You can update the status again later if they come back.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setConfirmLost(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { setConfirmLost(false); statusMutation.mutate({ status: "lost" }); }}
              disabled={statusMutation.isPending}
              className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {statusMutation.isPending ? "Updating…" : "Mark Lost"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 w-24 shrink-0 pt-0.5">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function formatAction(action: string): string {
  const labels: Record<string, string> = {
    email_sent:             "Email Sent",
    note_added:             "Note Added",
    status_changed:         "Status Changed",
    field_updated:          "Field Updated",
    created:                "Created",
    converted:              "Converted to Customer",
    quote_created:          "Quote Created",
    quote_updated:          "Quote Updated",
    quote_status_changed:   "Quote Status Changed",
    quote_converted:        "Quote Converted to Job",
    file_uploaded:          "File Uploaded",
    file_deleted:           "File Deleted",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

// ─── Lead Quotes Tab ──────────────────────────────────────────────────────────
interface QuoteSummary {
  id: number;
  quoteNumber: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  validUntil?: string | null;
}

const QUOTE_STATUS_COLORS: Record<string, string> = {
  draft:    "bg-slate-100 text-slate-600",
  sent:     "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  declined: "bg-red-100 text-red-700",
  expired:  "bg-amber-100 text-amber-700",
};

function LeadQuotesTab({ leadId }: { leadId: number }) {
  const [, navigate] = useLocation();
  const [quotes, setQuotes] = useState<QuoteSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    protectedFetch(`${BASE}/api/quotes?leadId=${leadId}`)
      .then(r => r.json())
      .then(data => setQuotes(Array.isArray(data) ? data : []))
      .catch(() => setQuotes([]))
      .finally(() => setIsLoading(false));
  }, [leadId]);

  if (isLoading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-xl border border-slate-200" />)}
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-200">
        <FileText className="w-10 h-10 text-slate-200 mx-auto mb-3" />
        <p className="text-slate-600 font-bold text-sm">No quotes linked to this lead</p>
        <p className="text-slate-400 text-xs mt-1">Quotes created for this lead will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {quotes.map(q => {
        const statusCls = QUOTE_STATUS_COLORS[q.status] ?? "bg-slate-100 text-slate-600";
        return (
          <button
            key={q.id}
            onClick={() => navigate(`/quotes/${q.id}`)}
            className="w-full text-left bg-white rounded-xl border border-slate-200 px-4 py-3 hover:shadow-sm hover:border-slate-300 active:scale-[.998] transition-all group flex items-center gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-mono text-xs text-slate-500">{q.quoteNumber}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${statusCls}`}>{q.status}</span>
              </div>
              <p className="text-sm font-semibold text-slate-700">
                ${Number(q.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {new Date(q.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {q.validUntil ? ` · Valid until ${new Date(q.validUntil + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400 shrink-0 transition-colors" />
          </button>
        );
      })}
    </div>
  );
}
