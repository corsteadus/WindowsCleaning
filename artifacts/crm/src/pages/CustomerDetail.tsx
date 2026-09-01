import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Layout } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { customerLifecycleDisplayStatus } from "@/lib/customer-lifecycle-display";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { hasClientCapability } from "@/lib/rbac";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";
import { getListCustomersQueryKey, getListProspectsQueryKey } from "@workspace/api-client-react";
import {
  ArrowLeft, Edit2, Save, X, Phone, Mail, MapPin, Tag,
  Building2, Briefcase, FileText, Receipt, MessageSquare,
  PhoneCall, StickyNote, Home, ChevronRight, User, Calendar,
  Layers, Info, AlertCircle, CheckCircle2, Clock, DollarSign,
  Repeat, Plus, Trash2, Star, CreditCard, Activity, PowerOff, Power, Paperclip, RotateCcw,
  Users,
  ContactRound,
} from "lucide-react";
import { FilesTab } from "@/components/FilesTab";
import { CommunicationSafetyCard } from "@/components/CommunicationSafetyCard";
import { ProfileDetailsTab } from "@/components/ProfileDetailsTab";
import { CustomerCombobox, type CustomerComboboxRecord } from "@/components/CustomerCombobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  useArchiveProperty,
  useCreateProperty,
  useLinkPropertyAccount,
  useRestoreProperty,
  useUnlinkPropertyAccount,
  useUpdateProperty,
} from "@/lib/property-client";

function parseJobDate(d: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = d.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (m[3].length === 2) y = y >= 50 ? 1900 + y : 2000 + y;
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface CustomerDetail {
  id: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  homePhone?: string | null;
  workPhone?: string | null;
  cellPhone?: string | null;
  altPhone?: string | null;
  altPhoneType?: string | null;
  billingAddress?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingZip?: string | null;
  county?: string | null;
  subdivision?: string | null;
  isNonProfit?: boolean;
  ccFeeExempt?: boolean;
  taxExempt?: boolean;
  preferredContactMethod?: string | null;
  sendingPreferences?: string | null;
  windowCount?: number | null;
  windowType?: string | null;
  houseSize?: string | null;
  laddersNeeded?: string | null;
  companyName?: string | null;
  salutation?: string | null;
  fax?: string | null;
  altContact?: string | null;
  starRating?: number | null;
  source?: string | null;
  howHeard?: string | null;
  tags?: string | null;
  status: string;
  lifecycleStatus?: string | null;
  clientType?: string | null;
  accountType?: string | null;
  deactivatedAt?: string | null;
  deactivationReason?: string | null;
  deactivatedBy?: string | null;
  importExternalId?: string | null;
  notes?: string | null;
  specificNotes?: string | null;
  callbackNotes?: string | null;
  directions?: string | null;
  prospectDate?: string | null;
  customerDate?: string | null;
  birthday?: string | null;
  defaultPropertyId?: number | null;
  effectiveDefaultPropertyId?: number | null;
  defaultPropertySource?: "manual" | "auto";
  createdAt: string;
  updatedAt: string;
  jobs: Job[];
  quotes?: Quote[];
  invoices?: Invoice[];
  payments?: PaymentRecord[];
  properties: Property[];
  contacts: Contact[];
  messages: MessageLog[];
  activityLogs: ActivityLog[];
}

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

interface Job {
  id: number;
  jobNumber: string;
  status: string;
  serviceType?: string | null;
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  totalAmount: string;
  notes?: string | null;
  lineItems?: string | null;
}

interface Quote {
  id: number;
  quoteNumber: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  validUntil?: string | null;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  status: string;
  totalAmount: string;
  balanceDue: string;
  dueDate?: string | null;
  createdAt: string;
}

interface PaymentRecord {
  id: number;
  amount: number;
  paymentDate: string;
  method: string;
  reference?: string | null;
  note?: string | null;
  allocations: Array<{ id: number; invoiceId: number; amount: number }>;
}

interface Property {
  id: number;
  customerId: number;
  name?: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  county?: string | null;
  subdivision?: string | null;
  directions?: string | null;
  locationNotes?: string | null;
  propertyType: string;
  stories?: number | null;
  windowCount?: number | null;
  accessNotes?: string | null;
  gateCode?: string | null;
  hasScreens: boolean;
  hasHardWater: boolean;
  hasTracks: boolean;
  riskNotes?: string | null;
  serviceNotes?: string | null;
  isPrimary: boolean;
  isManualDefault: boolean;
  isBillingAddress: boolean;
  billingAddress?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingZip?: string | null;
  archivedAt?: string | null;
  relationshipType?: string | null;
  isOwner?: boolean;
}

interface ShareCustomer extends CustomerComboboxRecord {
  firstName: string;
  lastName: string;
  companyName?: string | null;
}

type ShareCustomerPickerProps = {
  selectedCustomer: ShareCustomer | null;
  onSelect: (customer: ShareCustomer) => void;
  labelFor: (customer: ShareCustomer) => string;
  placeholder: string;
  activeOnly?: boolean;
};

const ShareCustomerPicker = CustomerCombobox as React.ComponentType<ShareCustomerPickerProps>;

interface Contact {
  id: number;
  customerId: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  role?: string | null;
  title?: string | null;
  isPrimary: boolean;
  receiveSms: boolean;
  receiveEmail: boolean;
  notes?: string | null;
  archivedAt?: string | null;
}

interface MessageLog {
  id: number;
  channel: string;
  triggerType: string;
  subject?: string | null;
  body: string;
  status: string;
  sentAt?: string | null;
  createdAt: string;
}

// ─── Tab config ───────────────────────────────────────────────────────────────
type Tab = "overview" | "profile" | "contacts" | "properties" | "jobs" | "quotes" | "invoices" | "payments" | "communications" | "callbacks" | "notes" | "files" | "activity";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview",       label: "Overview",        icon: User },
  { id: "profile",        label: "Profile Details", icon: ContactRound },
  { id: "contacts",       label: "Contacts",        icon: Users },
  { id: "properties",     label: "Properties",      icon: Home },
  { id: "jobs",           label: "Job History",     icon: Briefcase },
  { id: "quotes",         label: "Quotes",          icon: FileText },
  { id: "invoices",       label: "Invoices",        icon: Receipt },
  { id: "payments",       label: "Payments",        icon: CreditCard },
  { id: "communications", label: "Communications",  icon: MessageSquare },
  { id: "callbacks",      label: "Callbacks",       icon: PhoneCall },
  { id: "notes",          label: "Notes",           icon: StickyNote },
  { id: "files",          label: "Files",           icon: Paperclip },
  { id: "activity",       label: "Activity",        icon: Activity },
];

// ─── Main component ───────────────────────────────────────────────────────────
export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const isProspectRoute = location.startsWith("/prospects/");
  const entityLabel = isProspectRoute ? "Prospect" : "Customer";
  const entityLabelPlural = isProspectRoute ? "Prospects" : "Customers";
  const apiBase = isProspectRoute ? "/api/prospects" : "/api/customers";
  const { goBack, backLabel } = useBackNavigation(isProspectRoute ? "/prospects" : "/customers");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canManageCustomer = hasClientCapability(user, "customers.manage");
  const canManageProperties = hasClientCapability(user, "properties.manage");
  const canManageContacts = hasClientCapability(user, "contacts.manage");
  const canScheduleJobs = hasClientCapability(user, "schedule.manage");
  const canCreateEstimates = hasClientCapability(user, "quotes.manage");
  const canSendEmail = hasClientCapability(user, "communication.send");
  const canViewFinancials = hasClientCapability(user, "invoices.view");
  const visibleTabs = TABS.filter((tab) =>
    (tab.id !== "quotes" || hasClientCapability(user, "quotes.view"))
    && (tab.id !== "invoices" || canViewFinancials)
    && (tab.id !== "payments" || hasClientCapability(user, "payments.view"))
    && (tab.id !== "communications" || hasClientCapability(user, "communication.view"))
    && (tab.id !== "profile" || canManageCustomer)
    && (tab.id !== "callbacks" || canManageCustomer)
    && (tab.id !== "files" || canManageCustomer)
    && (tab.id !== "activity" || canManageCustomer)
  );
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [isEditing, setIsEditing] = useState(false);
  const [deactivateModal, setDeactivateModal] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState("");
  const [emailModal, setEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  const { data: customer, isLoading, error } = useQuery<CustomerDetail>({
    queryKey: authScopedQueryKey(user, ["customer", id]),
    queryFn: async () => {
      const res = await protectedFetch(`${apiBase}/${id}`);
      if (!res.ok) throw new Error(`${entityLabel} not found`);
      const data = await res.json();
      return {
        ...data,
        jobs: data.jobs ?? [],
        quotes: data.quotes ?? [],
        invoices: data.invoices ?? [],
        payments: data.payments ?? [],
        properties: data.properties ?? [],
        contacts: data.contacts ?? [],
        messages: data.messages ?? [],
        activityLogs: data.activityLogs ?? [],
      };
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ status, reason }: { status: string; reason?: string }) => {
      const res = await protectedFetch(`${apiBase}/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason }),
      });
      if (!res.ok) throw new Error("Status update failed");
      return res.json();
    },
    onSuccess: (committedCustomer) => {
      queryClient.setQueryData<CustomerDetail>(
        authScopedQueryKey(user, ["customer", id]),
        (current) => current ? { ...current, ...committedCustomer } : current,
      );
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["customer", id]) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["customers"]) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["prospects"]) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCustomersQueryKey()) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListProspectsQueryKey()) });
      toast({ title: "Status updated" });
      setDeactivateModal(false);
      setDeactivateReason("");
    },
    onError: () => toast({ title: "Status update failed", variant: "destructive" }),
  });

  const mutation = useMutation({
    mutationFn: async (updates: Partial<CustomerDetail>) => {
      const res = await protectedFetch(`${apiBase}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: (committedCustomer) => {
      queryClient.setQueryData<CustomerDetail>(
        authScopedQueryKey(user, ["customer", id]),
        (current) => current ? { ...current, ...committedCustomer } : current,
      );
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["customer", id]) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["customers"]) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["prospects"]) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCustomersQueryKey()) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListProspectsQueryKey()) });
      toast({ title: `${entityLabel} saved` });
      setIsEditing(false);
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const form = useForm<Partial<CustomerDetail>>({ defaultValues: customer });

  function startEdit() {
    form.reset(customer);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    form.reset(customer);
  }

  function onSubmit(values: Partial<CustomerDetail>) {
    mutation.mutate(values);
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="p-6 flex items-center justify-center h-64">
          <div className="animate-pulse text-slate-400">Loading {entityLabel.toLowerCase()}…</div>
        </div>
      </Layout>
    );
  }

  if (error || !customer) {
    return (
      <Layout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            {entityLabel} not found.
          </div>
          <button onClick={goBack} className="mt-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="w-3.5 h-3.5" /> {backLabel ?? entityLabelPlural}
          </button>
        </div>
      </Layout>
    );
  }

  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  const accountName = customer.companyName?.trim() || fullName || `${entityLabel} #${customer.id}`;
  const initials = (customer.companyName
    ? customer.companyName.split(/\s+/).slice(0, 2).map(part => part[0]).join("")
    : [customer.firstName?.[0], customer.lastName?.[0]].filter(Boolean).join("")
  ).toUpperCase();
  const activeProperties = customer.properties.filter((property) => !property.archivedAt);

  // Revenue = all completed jobs (covers TCF-imported jobs that have no invoices,
  // and new CRM jobs – jobs are the primary record of work done)
  const totalRevenue = canViewFinancials ? customer.jobs
    .filter(j => j.status === "completed")
    .reduce((s, j) => s + parseFloat(j.totalAmount || "0"), 0) : 0;

  const lastServiceDate = customer.jobs
    .filter(j => j.scheduledDate)
    .map(j => parseJobDate(j.scheduledDate!))
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);

  return (
    <Layout>
      <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <button onClick={goBack} className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50 transition-colors shrink-0">
              <ArrowLeft className="w-3.5 h-3.5" />
              {backLabel ?? entityLabelPlural}
            </button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-base font-bold text-primary">{initials}</span>
              </div>
              <div>
                 <h1 className="text-xl font-bold text-slate-900">{accountName}</h1>
                 {customer.companyName && fullName && (
                   <p className="text-xs text-slate-500 mt-0.5">Primary contact: {fullName}</p>
                 )}
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={customerLifecycleDisplayStatus(customer)} />
                  <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 capitalize">
                    {customer.accountType ?? customer.clientType ?? "residential"}
                  </span>
                  {customer.isNonProfit && (
                    <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 rounded-full px-2 py-0.5">Non-Profit</span>
                  )}
                  {customer.taxExempt && (
                    <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">Tax Exempt</span>
                  )}
                  {customer.ccFeeExempt && (
                    <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5">No CC Fee</span>
                  )}
                  <span className="text-[10px] text-slate-400">ID #{customer.id}</span>
                  {customer.importExternalId && (
                    <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">CF #{customer.importExternalId}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {/* Schedule Job */}
            {!isEditing && canScheduleJobs && (customer.lifecycleStatus === "customer" || customer.status === "active") && (
              <button
                onClick={() => navigate(`/jobs/new?customerId=${customer.id}`)}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 shadow-sm shadow-primary/20 transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Schedule Job
              </button>
            )}
            {/* New Quote */}
            {!isEditing && canCreateEstimates && (customer.lifecycleStatus === "customer" || customer.status === "active") && (
              <button
                onClick={() => navigate(`/quotes/new?customerId=${customer.id}`)}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-primary/30 text-primary bg-white text-xs font-semibold hover:bg-primary/5 transition-colors"
              >
                <FileText className="w-3.5 h-3.5" /> New Estimate
              </button>
            )}
            {/* One-off email button */}
            {!isEditing && canSendEmail && customer.email && (
              <button
                onClick={() => setEmailModal(true)}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-blue-200 text-blue-700 bg-white text-xs font-semibold hover:bg-blue-50 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" /> Send Email
              </button>
            )}
            {/* Status toggle — only in view mode */}
            {!isEditing && canManageCustomer && (customer.lifecycleStatus === "customer" || customer.status === "active") && (
              <button
                onClick={() => setDeactivateModal(true)}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-orange-200 text-orange-600 bg-white text-xs font-semibold hover:bg-orange-50 transition-colors"
              >
                <PowerOff className="w-3.5 h-3.5" /> Deactivate
              </button>
            )}
            {!isEditing && canManageCustomer && (customer.lifecycleStatus === "inactive" || customer.lifecycleStatus === "archived" || customer.status === "inactive") && (
              <button
                onClick={() => statusMutation.mutate({ status: "active" })}
                disabled={statusMutation.isPending}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-emerald-200 text-emerald-700 bg-white text-xs font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-50"
              >
                <Power className="w-3.5 h-3.5" /> Reactivate
              </button>
            )}
            {canManageCustomer && (isEditing ? (
              <>
                <button
                  onClick={cancelEdit}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
                <button
                  onClick={form.handleSubmit(onSubmit)}
                  disabled={mutation.isPending}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" />
                  {mutation.isPending ? "Saving…" : "Save Changes"}
                </button>
              </>
            ) : (
              <button
                onClick={startEdit}
                className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
            ))}
          </div>
        </div>

        {/* ── One-off email modal ─────────────────────────────────────────── */}
        {emailModal && (
          <Dialog open onOpenChange={() => { setEmailModal(false); setEmailSubject(""); setEmailBody(""); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Send Email to {customer.firstName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-sm text-slate-600">
                  To: <span className="font-semibold text-slate-800">{customer.email}</span>
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
                    placeholder={"Hi " + customer.firstName + ",\n\nYour message here…"}
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
                          entityType: "customer",
                          entityId: customer.id,
                          email: customer.email,
                          firstName: customer.firstName,
                          lastName: customer.lastName,
                          subject: emailSubject,
                          bodyHtml: emailBody,
                        }),
                      });
                      if (!res.ok) throw new Error("Send failed");
                      toast({ title: "Email sent!", description: `Sent to ${customer.email}` });
                      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["customer", id]) });
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

        {/* ── Deactivation reason modal ───────────────────────────────────── */}
        {deactivateModal && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Deactivate Customer</h2>
              <p className="text-sm text-slate-500">
                Please provide a reason for deactivating{" "}
                <span className="font-semibold text-slate-700">{fullName}</span>.
                This will be logged in the activity history.
              </p>
              <textarea
                value={deactivateReason}
                onChange={e => setDeactivateReason(e.target.value)}
                rows={3}
                placeholder="e.g. Moved out of service area, requested to stop service…"
                className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setDeactivateModal(false); setDeactivateReason(""); }}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => statusMutation.mutate({ status: "inactive", reason: deactivateReason })}
                  disabled={statusMutation.isPending || !deactivateReason.trim()}
                  className="px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {statusMutation.isPending ? "Saving…" : "Confirm Deactivation"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Stat cards ─────────────────────────────────────────────────── */}
        <div className={`grid grid-cols-2 ${canViewFinancials ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-3`}>
          <StatCard label="Total Jobs" value={String(customer.jobs.length)} icon={Briefcase} color="blue" />
          {canViewFinancials && <StatCard label="Total Revenue" value={`$${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={DollarSign} color="emerald" />}
          <StatCard
            label="Last Service"
            value={lastServiceDate
              ? new Date(lastServiceDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : "—"}
            icon={Calendar}
            color="violet"
          />
          <StatCard
            label="Windows"
            value={customer.windowCount != null ? String(customer.windowCount) : "—"}
            icon={Layers}
            color="slate"
          />
        </div>

        {/* ── Default property banner ─────────────────────────────────────── */}
        {activeProperties.length > 0 && (() => {
          const effId = customer.effectiveDefaultPropertyId;
          const defaultProp = effId
            ? activeProperties.find(p => p.id === effId) ?? activeProperties[0]
            : activeProperties[0];
          const isManual = customer.defaultPropertySource === "manual";
          const propCount    = activeProperties.length;
          const displayName  = defaultProp.name
            ? `${defaultProp.name} · ${defaultProp.address}`
            : defaultProp.address;
          const cityLine = [defaultProp.city, defaultProp.state, defaultProp.zip]
            .filter(Boolean).join(", ");
          return (
            <button
              onClick={() => setActiveTab("properties")}
              className="flex items-center gap-3 w-full bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-amber-300 hover:bg-amber-50/40 transition-colors group text-left"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <Home className="w-4 h-4 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                    Default Property
                  </span>
                  {!isManual && (
                    <span className="text-[10px] text-slate-400 italic">(auto-selected)</span>
                  )}
                  {isManual && (
                    <span className="text-[10px] text-slate-400 italic">(manually set)</span>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-800 truncate">{displayName}</p>
                {cityLine && (
                  <p className="text-xs text-slate-400 truncate">{cityLine}</p>
                )}
              </div>
              {propCount > 1 && (
                <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 rounded-full px-2.5 py-1 whitespace-nowrap shrink-0">
                  {propCount} properties
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-amber-500 shrink-0 transition-colors" />
            </button>
          );
        })()}

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px">
          {visibleTabs.map(t => {
            const Icon = t.icon;
            const count = getTabCount(t.id, customer);
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

        {/* ── Tab content ─────────────────────────────────────────────────── */}
        <div>
          {activeTab === "overview" && (
            <OverviewTab customer={customer} isEditing={isEditing} form={form} />
          )}
          {activeTab === "profile" && (
            <ProfileDetailsTab
              customerId={customer.id}
              apiBase={apiBase}
              contacts={customer.contacts ?? []}
              fallbackLocations={customer.properties ?? []}
              entityLabel={entityLabel}
            />
          )}
          {activeTab === "contacts" && (
            canManageContacts
              ? <ContactsTab contacts={customer.contacts ?? []} customerId={customer.id} />
              : <ReadOnlyContacts contacts={customer.contacts ?? []} />
          )}
          {activeTab === "properties" && (
            canManageProperties
              ? <PropertiesTab customer={customer} properties={customer.properties} customerId={customer.id} />
              : <ReadOnlyProperties customer={customer} properties={customer.properties} />
          )}
          {activeTab === "jobs" && (
            <JobsTab jobs={customer.jobs} customerId={customer.id} canSchedule={canScheduleJobs} />
          )}
          {activeTab === "quotes" && (
            <QuotesTab quotes={customer.quotes ?? []} customerId={customer.id} />
          )}
          {activeTab === "invoices" && (
            <InvoicesTab invoices={customer.invoices ?? []} customerId={customer.id} />
          )}
          {activeTab === "payments" && (
            <PaymentsTab payments={customer.payments ?? []} />
          )}
          {activeTab === "communications" && (
            <CommunicationsTab messages={customer.messages} customerId={customer.id} />
          )}
          {activeTab === "callbacks" && (
            <CallbacksTab customer={customer} isEditing={isEditing} form={form} />
          )}
          {activeTab === "notes" && (
            <NotesTab customer={customer} isEditing={isEditing} form={form} />
          )}
          {activeTab === "files" && (
            <FilesTab entityType="customer" entityId={customer.id} />
          )}
          {activeTab === "activity" && (
            <ActivityTab logs={customer.activityLogs} />
          )}
        </div>
      </div>
    </Layout>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "emerald" | "amber" | "violet" | "slate";
}) {
  const colors = {
    blue:    "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber:   "bg-amber-50 text-amber-600",
    violet:  "bg-violet-50 text-violet-600",
    slate:   "bg-slate-50 text-slate-500",
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${colors[color]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function getTabCount(tab: Tab, customer: CustomerDetail): number | null {
  if (tab === "jobs")           return customer.jobs.length;
  if (tab === "quotes")         return customer.quotes?.length ?? 0;
  if (tab === "invoices")       return customer.invoices?.length ?? 0;
  if (tab === "payments")       return customer.payments?.length ?? 0;
  if (tab === "properties") {
    return customer.properties.filter((property) => !property.archivedAt).length;
  }
  if (tab === "contacts")       return customer.contacts?.length ?? 0;
  if (tab === "communications") return customer.messages.length;
  if (tab === "activity")       return customer.activityLogs?.length ?? 0;
  return null;
}

// ─── Contacts Tab ─────────────────────────────────────────────────────────────
function ReadOnlyContacts({ contacts }: { contacts: Contact[] }) {
  return (
    <div className="space-y-2">
      {contacts.length === 0 ? <Empty icon={Users} message="No contacts available" /> : contacts.map((contact) => (
        <div key={contact.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-semibold text-slate-900">
            {[contact.firstName, contact.lastName].filter(Boolean).join(" ")}
            {contact.isPrimary && <span className="ml-2 text-xs text-primary">Primary</span>}
          </p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-600">
            {contact.phone && <span>{contact.phone}</span>}
            {contact.alternatePhone && <span>{contact.alternatePhone}</span>}
            {contact.email && <span>{contact.email}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReadOnlyProperties({ customer, properties }: { customer: CustomerDetail; properties: Property[] }) {
  const activeProperties = properties.filter((property) => !property.archivedAt);
  const showLegacyAddress = !!customer.billingAddress
    && !activeProperties.some((property) => property.isBillingAddress);
  return (
    <div className="space-y-2">
      {showLegacyAddress && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Legacy address (compatibility only)</p>
          <p className="mt-1 text-sm text-slate-600">
            {[customer.billingAddress, customer.billingCity, customer.billingState, customer.billingZip].filter(Boolean).join(", ")}
          </p>
          <p className="mt-1 text-xs text-slate-400">This is not a persisted property and is not included in the Properties count.</p>
        </div>
      )}
      {activeProperties.length === 0 ? <Empty icon={Home} message="No assigned service property" /> : activeProperties.map((property) => (
        <div key={property.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-semibold text-slate-900">{property.name || "Service property"}</p>
          <p className="mt-1 text-sm text-slate-600">
            {[property.address, property.city, property.state, property.zip].filter(Boolean).join(", ")}
          </p>
          {property.gateCode && <p className="mt-2 text-sm"><strong>Gate code:</strong> {property.gateCode}</p>}
          {property.accessNotes && <p className="mt-1 text-sm"><strong>Access:</strong> {property.accessNotes}</p>}
          {property.directions && <p className="mt-1 text-sm"><strong>Directions:</strong> {property.directions}</p>}
          {property.serviceNotes && <p className="mt-1 text-sm"><strong>Service notes:</strong> {property.serviceNotes}</p>}
        </div>
      ))}
    </div>
  );
}

type ContactDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  alternatePhone: string;
  role: string;
  receiveSms: boolean;
  receiveEmail: boolean;
  notes: string;
};

const EMPTY_CONTACT_DRAFT: ContactDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  alternatePhone: "",
  role: "",
  receiveSms: false,
  receiveEmail: false,
  notes: "",
};

function contactDraft(contact?: Contact): ContactDraft {
  return contact ? {
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    alternatePhone: contact.alternatePhone ?? "",
    role: contact.role ?? contact.title ?? "",
    receiveSms: contact.receiveSms,
    receiveEmail: contact.receiveEmail,
    notes: contact.notes ?? "",
  } : { ...EMPTY_CONTACT_DRAFT };
}

function ContactsTab({ contacts, customerId }: { contacts: Contact[]; customerId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_CONTACT_DRAFT);
  const [showArchived, setShowArchived] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({
    queryKey: authScopedQueryKey(user, ["customer", String(customerId)]),
  });
  const request = async (url: string, init?: RequestInit) => {
    const response = await protectedFetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "Request failed");
    return payload;
  };

  const saveContact = useMutation({
    mutationFn: async () => {
      const body = {
        ...draft,
        customerId,
        email: draft.email || null,
        phone: draft.phone || null,
        alternatePhone: draft.alternatePhone || null,
        role: draft.role || null,
        notes: draft.notes || null,
      };
      return request(editingId ? `/api/contacts/${editingId}` : "/api/contacts", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      invalidate();
      setShowAddForm(false);
      setEditingId(null);
      setDraft(contactDraft());
      toast({ title: editingId ? "Contact updated" : "Contact added" });
    },
    onError: (error: Error) => toast({ title: error.message || "Could not save contact", variant: "destructive" }),
  });

  const action = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "primary" | "archive" | "restore" }) =>
      request(`/api/contacts/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Contact updated" });
    },
    onError: (error: Error) => toast({ title: error.message || "Contact action failed", variant: "destructive" }),
  });

  const activeContacts = contacts.filter(contact => !contact.archivedAt);
  const archivedContacts = contacts.filter(contact => !!contact.archivedAt);
  const visibleContacts = showArchived ? [...activeContacts, ...archivedContacts] : activeContacts;

  function beginEdit(contact: Contact) {
    setEditingId(contact.id);
    setDraft(contactDraft(contact));
    setShowAddForm(true);
  }

  function cancelEdit() {
    setShowAddForm(false);
    setEditingId(null);
    setDraft(contactDraft());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {activeContacts.length} active contact{activeContacts.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            The primary contact stays synchronized with the account’s legacy contact fields.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {archivedContacts.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={event => setShowArchived(event.target.checked)}
                className="w-3.5 h-3.5 rounded accent-primary"
              />
              Show archived ({archivedContacts.length})
            </label>
          )}
          <button
            onClick={() => {
              if (showAddForm && !editingId) cancelEdit();
              else {
                setEditingId(null);
                setDraft(contactDraft());
                setShowAddForm(true);
              }
            }}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Contact
          </button>
        </div>
      </div>

      {showAddForm && (
        <ContactEditor
          draft={draft}
          isEditing={editingId !== null}
          isPending={saveContact.isPending}
          onChange={setDraft}
          onSubmit={() => saveContact.mutate()}
          onCancel={cancelEdit}
        />
      )}

      {visibleContacts.length === 0 ? (
        <Empty icon={Users} message="No contacts yet — add the account’s first point of contact" />
      ) : (
        <div className="grid gap-3">
          {visibleContacts.map(contact => {
            const archived = !!contact.archivedAt;
            return (
              <div
                key={contact.id}
                className={`rounded-2xl border p-5 transition-colors ${
                  archived ? "border-slate-200 bg-slate-50/80 opacity-75" :
                  contact.isPrimary ? "border-primary/30 bg-primary/[0.025] shadow-sm" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      archived ? "bg-slate-200 text-slate-500" : contact.isPrimary ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-500"
                    }`}>
                      <User className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-slate-900 text-sm">
                          {contact.firstName} {contact.lastName}
                        </h3>
                        {contact.isPrimary && !archived && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                            <Star className="w-2.5 h-2.5" /> Primary
                          </span>
                        )}
                        {archived && (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                            Archived
                          </span>
                        )}
                        {(contact.role || contact.title) && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            {contact.role ?? contact.title}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                        {contact.email && <span className="inline-flex items-center gap-1.5"><Mail className="w-3 h-3" />{contact.email}</span>}
                        {contact.phone && <span className="inline-flex items-center gap-1.5"><Phone className="w-3 h-3" />{contact.phone}</span>}
                        {contact.alternatePhone && <span className="inline-flex items-center gap-1.5"><PhoneCall className="w-3 h-3" />Alt: {contact.alternatePhone}</span>}
                      </div>
                      {(contact.receiveEmail || contact.receiveSms) && !archived && (
                        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Communication: {[contact.receiveEmail && "Email", contact.receiveSms && "SMS"].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {contact.notes && <p className="mt-2 text-xs text-slate-500">{contact.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!archived && !contact.isPrimary && (
                      <button
                        onClick={() => action.mutate({ id: contact.id, action: "primary" })}
                        disabled={action.isPending}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Set primary
                      </button>
                    )}
                    {!archived && (
                      <button
                        onClick={() => beginEdit(contact)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => action.mutate({ id: contact.id, action: archived ? "restore" : "archive" })}
                      disabled={action.isPending}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${
                        archived ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" :
                        "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {archived ? "Restore" : "Archive"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContactEditor({
  draft,
  isEditing,
  isPending,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: ContactDraft;
  isEditing: boolean;
  isPending: boolean;
  onChange: (draft: ContactDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const update = (field: keyof ContactDraft, value: string | boolean) =>
    onChange({ ...draft, [field]: value });
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/[0.025] p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-bold text-slate-900">{isEditing ? "Edit contact" : "Add contact"}</p>
          <p className="text-xs text-slate-400 mt-0.5">Use a person’s details here; account display names stay on the account record.</p>
        </div>
        <button onClick={onCancel} className="text-xs font-semibold text-slate-400 hover:text-slate-700">Cancel</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {([
          ["firstName", "First name", "required"],
          ["lastName", "Last name", "required"],
          ["role", "Role / title", ""],
          ["email", "Email", "email"],
          ["phone", "Phone", "tel"],
          ["alternatePhone", "Alternate phone", "tel"],
        ] as const).map(([field, label, type]) => (
          <label key={field} className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {label}
            <input
              value={draft[field] as string}
              onChange={event => update(field, event.target.value)}
              type={type === "required" ? "text" : type || "text"}
              required={type === "required"}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
          <input type="checkbox" checked={draft.receiveEmail} onChange={event => update("receiveEmail", event.target.checked)} className="w-4 h-4 rounded accent-primary" />
          Email communication
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
          <input type="checkbox" checked={draft.receiveSms} onChange={event => update("receiveSms", event.target.checked)} className="w-4 h-4 rounded accent-primary" />
          SMS communication
        </label>
      </div>
      <label className="block mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Notes
        <textarea
          value={draft.notes}
          onChange={event => update("notes", event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
        <button
          onClick={onSubmit}
          disabled={isPending || !draft.firstName.trim() || !draft.lastName.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-primary/20 hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? "Saving…" : isEditing ? "Save contact" : "Add contact"}
        </button>
      </div>
    </div>
  );
}

// ─── Field components ─────────────────────────────────────────────────────────
function FieldRow({ label, value, editing, name, form, type = "text", placeholder }: {
  label: string;
  value?: string | number | null;
  editing: boolean;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  type?: string;
  placeholder?: string;
}) {
  if (editing) {
    return (
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</label>
        <input
          {...form.register(name)}
          type={type}
          placeholder={placeholder ?? label}
          className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
        />
      </div>
    );
  }
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</label>
      <p className="text-sm text-slate-800 mt-0.5">{value ?? <span className="text-slate-300 italic">—</span>}</p>
    </div>
  );
}

function CheckboxRow({ label, value, editing, name, form }: {
  label: string; value?: boolean; editing: boolean; name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
}) {
  if (editing) {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" {...form.register(name)} className="w-4 h-4 rounded accent-primary" />
        <span className="text-sm text-slate-700">{label}</span>
      </label>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {value
        ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        : <div className="w-4 h-4 rounded-full border-2 border-slate-200 shrink-0" />}
      <span className="text-sm text-slate-700">{label}</span>
    </div>
  );
}

function Section({ title, icon: Icon, children }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-400" />
        {title}
      </h3>
      {children}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ customer, isEditing, form }: {
  customer: CustomerDetail; isEditing: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

      {/* Contact Info */}
      <Section title="Contact Information" icon={Phone}>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="First Name"  value={customer.firstName} editing={isEditing} name="firstName" form={form} />
          <FieldRow label="Last Name"   value={customer.lastName}  editing={isEditing} name="lastName"  form={form} />
        </div>
        <FieldRow label="Company / Business Name" value={customer.companyName} editing={isEditing} name="companyName" form={form} placeholder="Optional company name" />
        <FieldRow label="Email" value={customer.email} editing={isEditing} name="email" form={form} type="email" />
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Home Phone" value={customer.homePhone} editing={isEditing} name="homePhone" form={form} placeholder="(555) 000-0000" />
          <FieldRow label="Work Phone" value={customer.workPhone} editing={isEditing} name="workPhone" form={form} placeholder="(555) 000-0000" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Cell Phone" value={customer.cellPhone} editing={isEditing} name="cellPhone" form={form} placeholder="(555) 000-0000" />
          <FieldRow label="Alt Phone"  value={customer.altPhone}  editing={isEditing} name="altPhone"  form={form} placeholder="(555) 000-0000" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Fax"            value={customer.fax}        editing={isEditing} name="fax"        form={form} placeholder="(555) 000-0000" />
          <FieldRow label="Alt Phone Type" value={customer.altPhoneType} editing={isEditing} name="altPhoneType" form={form} placeholder="e.g. Second Cell, Office" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Alt. Contact Name" value={customer.altContact} editing={isEditing} name="altContact" form={form} placeholder="Name of alternate contact" />
          <FieldRow label="Birthday" value={customer.birthday} editing={isEditing} name="birthday" form={form} type="text" placeholder="MM/DD" />
        </div>
        {/* Star rating display */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Star Rating</label>
          {isEditing ? (
            <select {...form.register("starRating", { valueAsNumber: true })} className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white">
              <option value="">— None —</option>
              {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}
            </select>
          ) : (
            <p className="mt-0.5 text-sm text-amber-500">
              {customer.starRating
                ? "★".repeat(customer.starRating) + "☆".repeat(5 - customer.starRating)
                : <span className="text-slate-300 italic">—</span>}
            </p>
          )}
        </div>
      </Section>

      {/* Address — resolved from default property when available */}
      {(() => {
        const defProp = customer.effectiveDefaultPropertyId
          ? customer.properties.find(p => p.id === customer.effectiveDefaultPropertyId)
          : null;
        const addr   = defProp?.address ?? customer.billingAddress;
        const city   = defProp?.city    ?? customer.billingCity;
        const state  = defProp?.state   ?? customer.billingState;
        const zip    = defProp?.zip     ?? customer.billingZip;
        return (
          <Section title="Service Address" icon={MapPin}>
            {defProp ? (
              <>
                <FieldRow label="Street Address" value={addr} editing={false} name="" form={form} />
                <div className="grid grid-cols-3 gap-3">
                  <FieldRow label="City"  value={city}  editing={false} name="" form={form} />
                  <FieldRow label="State" value={state} editing={false} name="" form={form} />
                  <FieldRow label="Zip"   value={zip}   editing={false} name="" form={form} />
                </div>
                <p className="text-[10px] text-slate-400 italic">From default property{defProp.name ? ` — ${defProp.name}` : ""}</p>
              </>
            ) : (
              <>
                <FieldRow label="Street Address" value={customer.billingAddress} editing={isEditing} name="billingAddress" form={form} />
                <div className="grid grid-cols-3 gap-3">
                  <FieldRow label="City"    value={customer.billingCity}  editing={isEditing} name="billingCity"  form={form} />
                  <FieldRow label="State"   value={customer.billingState} editing={isEditing} name="billingState" form={form} />
                  <FieldRow label="Zip"     value={customer.billingZip}   editing={isEditing} name="billingZip"   form={form} />
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-4">
              <FieldRow label="County"      value={customer.county}      editing={isEditing} name="county"      form={form} />
              <FieldRow label="Subdivision" value={customer.subdivision} editing={isEditing} name="subdivision" form={form} />
            </div>
          </Section>
        );
      })()}

      {/* Window Details */}
      <Section title="Window & Property Details" icon={Layers}>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Window Count" value={customer.windowCount ?? undefined} editing={isEditing} name="windowCount" form={form} type="number" />
          <FieldRow label="Window Type"  value={customer.windowType}  editing={isEditing} name="windowType"  form={form} placeholder="e.g. Double-hung" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="House Size"     value={customer.houseSize}     editing={isEditing} name="houseSize"     form={form} placeholder="e.g. 2800 sq ft" />
          <FieldRow label="Ladders Needed" value={customer.laddersNeeded} editing={isEditing} name="laddersNeeded" form={form} placeholder="e.g. 24 ft extension" />
        </div>
      </Section>

      {/* Account Flags */}
      <Section title="Account Settings" icon={Info}>
        <div className="space-y-3">
          <CheckboxRow label="Non-Profit (no CC processing fee)" value={customer.isNonProfit}  editing={isEditing} name="isNonProfit"  form={form} />
          <CheckboxRow label="Exempt from CC processing fee"     value={customer.ccFeeExempt}  editing={isEditing} name="ccFeeExempt"  form={form} />
          <CheckboxRow label="Tax Exempt"                         value={customer.taxExempt}    editing={isEditing} name="taxExempt"    form={form} />
        </div>
        <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Lifecycle</label>
            {isEditing ? (
              <select {...form.register("lifecycleStatus")} className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white">
                <option value="customer">Customer</option>
                <option value="prospect">Prospect</option>
                <option value="inactive" disabled>Inactive — use Deactivate</option>
                <option value="archived" disabled>Archived — use Deactivate</option>
              </select>
            ) : (
              <p className="mt-0.5"><StatusBadge status={customerLifecycleDisplayStatus(customer)} /></p>
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Account Type</label>
            {isEditing ? (
              <select {...form.register("accountType")} className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white">
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
              </select>
            ) : (
              <p className="text-sm text-slate-800 mt-0.5 capitalize">{customer.accountType ?? customer.clientType ?? "residential"}</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Preferred Contact"    value={customer.preferredContactMethod} editing={isEditing} name="preferredContactMethod" form={form} placeholder="Email / Phone / Text" />
          <FieldRow label="Sending Preferences"  value={customer.sendingPreferences}     editing={isEditing} name="sendingPreferences"     form={form} placeholder="email, sms" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="How Did They Hear?" value={customer.howHeard} editing={isEditing} name="howHeard" form={form} placeholder="Referral, Google, …" />
          <FieldRow label="Tags"               value={customer.tags}    editing={isEditing} name="tags"    form={form} placeholder="comma-separated tags" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Prospect Date"  value={customer.prospectDate}  editing={isEditing} name="prospectDate"  form={form} placeholder="YYYY-MM-DD" />
          <FieldRow label="Customer Since" value={customer.customerDate}  editing={isEditing} name="customerDate"  form={form} placeholder="YYYY-MM-DD" />
        </div>
      </Section>
    </div>
  );
}

// ─── Properties Tab ───────────────────────────────────────────────────────────
function PropertiesTab({
  customer,
  properties,
  customerId,
}: {
  customer: CustomerDetail;
  properties: Property[];
  customerId: number;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<number | null>(null);
  const [sharingPropertyId, setSharingPropertyId] = useState<number | null>(null);
  const [shareCustomer, setShareCustomer] = useState<ShareCustomer | null>(null);
  const [shareRelationshipType, setShareRelationshipType] = useState("shared");

  const invalidate = () => {
    // The detail, customer picker, and property picker use separate query keys.
    // Refresh all of them so a newly added/primary/archived property is usable
    // immediately by job and invoice forms.
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["customer"]) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCustomersQueryKey()) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListProspectsQueryKey()) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["customers"]) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["prospects"]) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["/api/properties"]) });
  };

  const updateProp = useUpdateProperty({
    mutation: {
      onSuccess: (_data: unknown, variables: { data: { isPrimary?: boolean } }) => {
        invalidate();
        setEditingPropertyId(null);
        toast({ title: variables.data.isPrimary ? "Primary property updated" : "Property updated" });
      },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    },
  });

  const deleteProp = useArchiveProperty({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Property archived" }); },
      onError: () => toast({ title: "Archive failed", variant: "destructive" }),
    },
  });

  const restoreProp = useRestoreProperty({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Property restored" }); },
      onError: () => toast({ title: "Restore failed", variant: "destructive" }),
    },
  });

  const createProp = useCreateProperty({
    mutation: {
      onSuccess: () => {
        invalidate();
        setShowAddForm(false);
        setEditingPropertyId(null);
        toast({ title: "Property added" });
      },
      onError: () => toast({ title: "Could not add property", variant: "destructive" }),
    },
  });

  const shareProp = useLinkPropertyAccount({
    mutation: {
      onSuccess: () => {
        invalidate();
        setSharingPropertyId(null);
        setShareCustomer(null);
        setShareRelationshipType("shared");
        toast({ title: "Property linked to account" });
      },
      onError: () => toast({ title: "Could not link property", variant: "destructive" }),
    },
  });

  const unlinkProp = useUnlinkPropertyAccount({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Property unlinked from account" });
      },
      onError: () => toast({ title: "Could not unlink property", variant: "destructive" }),
    },
  });

  // Show the customer's billing address as a derived "primary address" card when:
  // - customer has a billing address, AND
  // - no explicit property is flagged as the billing address
  const hasBilling = !!(customer.billingAddress && customer.billingCity);
  const activeProperties = properties.filter(p => !p.archivedAt);
  const archivedProperties = properties.filter(p => !!p.archivedAt);
  const visibleProperties = showArchived ? properties : activeProperties;
  const hasBillingProp = activeProperties.some(p => p.isOwner !== false && p.isBillingAddress);
  const showDerivedCard = hasBilling && !hasBillingProp;

  const isManualDefault = customer.defaultPropertySource === "manual";
  const defaultPropertyId = customer.effectiveDefaultPropertyId ?? activeProperties[0]?.id;

  const totalCount = activeProperties.length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {totalCount} propert{totalCount === 1 ? "y" : "ies"}
        </p>
        <div className="flex items-center gap-3">
          {archivedProperties.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="w-3.5 h-3.5 rounded accent-primary" />
              Show archived ({archivedProperties.length})
            </label>
          )}
          <button
            onClick={() => {
              setEditingPropertyId(null);
              setShowAddForm(v => !v);
            }}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Property
          </button>
        </div>
      </div>

      {/* Add Property form (inline, collapsed/expanded) */}
      {showAddForm && (
        <AddPropertyForm
          customerId={customerId}
          customerAddress={customer.billingAddress}
          customerCity={customer.billingCity}
          customerState={customer.billingState}
          customerZip={customer.billingZip}
          isPending={createProp.isPending}
          onSubmit={data => createProp.mutate({ data: { ...data, customerId } as any })}
          onCancel={() => setShowAddForm(false)}
        />
      )}
      {editingPropertyId !== null && (() => {
        const property = properties.find(item => item.id === editingPropertyId);
        if (!property) return null;
        return (
          <AddPropertyForm
            key={`edit-${property.id}`}
            customerId={customerId}
            initialProperty={property}
            submitLabel="Save Property"
            customerAddress={customer.billingAddress}
            customerCity={customer.billingCity}
            customerState={customer.billingState}
            customerZip={customer.billingZip}
            isPending={updateProp.isPending}
            onSubmit={data => updateProp.mutate({ id: property.id, data })}
            onCancel={() => setEditingPropertyId(null)}
          />
        );
      })()}

      {/* Derived billing address card (from customer billing fields — NOT a real property) */}
      {showDerivedCard && (
        <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-slate-900 text-sm truncate">
                  {customer.billingAddress}
                </p>
                <span className="flex items-center gap-1 text-[10px] font-semibold bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 whitespace-nowrap">
                   <CreditCard className="w-2.5 h-2.5" /> Legacy address
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0" />
                {[customer.billingCity, customer.billingState, customer.billingZip].filter(Boolean).join(", ")}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-400 italic">
             Compatibility information only. This is not a persisted property and is not included in the Properties count.
          </p>
        </div>
      )}

      {/* Explicit property records */}
      {activeProperties.length === 0 && !showArchived && (
        <Empty icon={Home} message="No properties yet — click Add Property to get started" />
      )}

      {visibleProperties.map(p => {
        const isArchived = !!p.archivedAt;
        const isDefault  = !isArchived && p.id === defaultPropertyId;
        const isOwner = p.isOwner !== false;
        return (
        <div
          key={p.id}
          className={`${isArchived ? "bg-slate-50/80 opacity-75" : "bg-white"} rounded-2xl border p-5 transition-all ${
            isDefault ? "border-amber-300 shadow-sm" : "border-slate-200"
          }`}
        >
          {/* Property header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-slate-900 text-sm">
                  {p.name ?? p.address}
                </p>
                {isDefault && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 whitespace-nowrap">
                    <Star className="w-2.5 h-2.5" />
                    {isManualDefault ? "Default (manual)" : "Default (auto)"}
                  </span>
                )}
                {!isOwner && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold bg-violet-100 text-violet-700 rounded-full px-2 py-0.5 whitespace-nowrap">
                    <Users className="w-2.5 h-2.5" /> Shared{p.relationshipType ? ` · ${p.relationshipType}` : ""}
                  </span>
                )}
                {isOwner && p.isBillingAddress && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 whitespace-nowrap">
                    <CreditCard className="w-2.5 h-2.5" /> Billing
                  </span>
                )}
                {isArchived && (
                  <span className="text-[10px] font-semibold bg-slate-200 text-slate-600 rounded-full px-2 py-0.5">
                    Archived
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0" />
                {p.address}, {p.city}, {p.state} {p.zip}
              </p>
            </div>
            <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 capitalize shrink-0">
              {p.propertyType}
            </span>
          </div>

          {/* Property details */}
          {(p.windowCount || p.stories || p.hasScreens || p.hasHardWater || p.hasTracks) && (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              {p.windowCount && <Detail label="Windows" value={String(p.windowCount)} />}
              {p.stories     && <Detail label="Stories"  value={String(p.stories)} />}
              {p.hasScreens  && <Badge label="Has Screens" />}
              {p.hasHardWater && <Badge label="Hard Water" color="amber" />}
              {p.hasTracks   && <Badge label="Has Tracks" />}
            </div>
          )}
          {(p.accessNotes || p.gateCode || p.serviceNotes || p.riskNotes) && (
            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {p.gateCode     && <Detail label="Gate Code"    value={p.gateCode} />}
              {p.accessNotes  && <Detail label="Access Notes" value={p.accessNotes} />}
              {p.serviceNotes && <Detail label="Service Notes" value={p.serviceNotes} />}
              {p.riskNotes    && <Detail label="Risk Notes"   value={p.riskNotes} color="red" />}
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
            {!isArchived && !isDefault && (
              <button
                onClick={() => {
                  protectedFetch(`/api/customers/${customerId}/set-default-property`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ propertyId: p.id }),
                  }).then(() => invalidate());
                }}
                disabled={updateProp.isPending}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-50"
              >
                <Star className="w-3 h-3" />
                Set as Default
              </button>
            )}
            {!isArchived && isDefault && (
              <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 border border-amber-200">
                <Star className="w-3 h-3" /> {isManualDefault ? "Default (manual)" : "Default"}
              </span>
            )}
            {!isArchived && isDefault && isManualDefault && (
              <button
                onClick={() => {
                  protectedFetch(`/api/customers/${customerId}/reset-default-property`, { method: "POST" })
                    .then(() => invalidate());
                }}
                disabled={updateProp.isPending}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                Reset to Auto
              </button>
            )}
            {!isArchived && isOwner && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={p.isBillingAddress}
                onChange={e => updateProp.mutate({ id: p.id, data: { isBillingAddress: e.target.checked } })}
                disabled={updateProp.isPending}
                className="w-4 h-4 rounded accent-primary"
              />
              <span className="text-xs font-semibold text-slate-600">Billing Address</span>
            </label>
            )}
            {!isArchived && isOwner && (
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setEditingPropertyId(p.id);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Edit
              </button>
            )}
            {!isArchived && isOwner && (
              <button
                onClick={() => {
                  setSharingPropertyId(current => current === p.id ? null : p.id);
                  setShareCustomer(null);
                }}
                className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100"
              >
                Share
              </button>
            )}
            {!isArchived && !isOwner && (
              <button
                onClick={() => {
                  if (confirm("Unlink this shared property from the account?")) unlinkProp.mutate({ id: p.id, customerId });
                }}
                disabled={unlinkProp.isPending}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Unlink
              </button>
            )}
            <div className="flex-1" />
            {isArchived ? (
              <button
                onClick={() => restoreProp.mutate({ id: p.id })}
                disabled={restoreProp.isPending}
                className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore
              </button>
            ) : (
              <button
                onClick={() => {
                  if (confirm("Archive this property? It can be restored later.")) deleteProp.mutate({ id: p.id });
                }}
                disabled={deleteProp.isPending}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Archive
              </button>
            )}
          </div>
          {sharingPropertyId === p.id && !isArchived && isOwner && (
            <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_auto] items-end gap-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Account to share with
                  <div className="mt-1">
                    <ShareCustomerPicker
                      selectedCustomer={shareCustomer}
                      onSelect={setShareCustomer}
                      labelFor={account => account.companyName?.trim() || [account.firstName, account.lastName].filter(Boolean).join(" ")}
                      placeholder="Search accounts…"
                      activeOnly
                    />
                  </div>
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Relationship
                  <select
                    value={shareRelationshipType}
                    onChange={event => setShareRelationshipType(event.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal normal-case tracking-normal text-slate-700"
                  >
                    <option value="shared">Shared</option>
                    <option value="tenant">Tenant</option>
                    <option value="manager">Manager</option>
                    <option value="hoa">HOA</option>
                  </select>
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (shareCustomer && sharingPropertyId !== null) {
                        shareProp.mutate({
                          id: sharingPropertyId,
                          data: { customerId: shareCustomer.id, relationshipType: shareRelationshipType },
                        });
                      }
                    }}
                    disabled={!shareCustomer || shareProp.isPending}
                    className="h-11 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {shareProp.isPending ? "Linking…" : "Link account"}
                  </button>
                  <button
                    onClick={() => {
                      setSharingPropertyId(null);
                      setShareCustomer(null);
                    }}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

// ─── Add Property Form ────────────────────────────────────────────────────────
function AddPropertyForm({
  customerId,
  initialProperty,
  submitLabel = "Add Property",
  customerAddress,
  customerCity,
  customerState,
  customerZip,
  isPending,
  onSubmit,
  onCancel,
}: {
  customerId: number;
  initialProperty?: Property;
  submitLabel?: string;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
  isPending: boolean;
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(() => ({
    name: initialProperty?.name ?? "",
    address: initialProperty?.address ?? "",
    city: initialProperty?.city ?? "",
    state: initialProperty?.state ?? "",
    zip: initialProperty?.zip ?? "",
    county: initialProperty?.county ?? "",
    subdivision: initialProperty?.subdivision ?? "",
    propertyType: initialProperty?.propertyType ?? "residential",
    windowCount: initialProperty?.windowCount != null ? String(initialProperty.windowCount) : "",
    stories: initialProperty?.stories != null ? String(initialProperty.stories) : "",
    gateCode: initialProperty?.gateCode ?? "",
    accessNotes: initialProperty?.accessNotes ?? "",
    serviceNotes: initialProperty?.serviceNotes ?? "",
    directions: initialProperty?.directions ?? "",
    locationNotes: initialProperty?.locationNotes ?? "",
    hasScreens: initialProperty?.hasScreens ?? false,
    hasHardWater: initialProperty?.hasHardWater ?? false,
    hasTracks: initialProperty?.hasTracks ?? false,
    isPrimary: initialProperty?.isPrimary ?? false,
    isBillingAddress: initialProperty?.isBillingAddress ?? false,
  }));

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      windowCount: form.windowCount ? parseInt(form.windowCount, 10) : null,
      stories:     form.stories     ? parseInt(form.stories,     10) : null,
    });
  };

  const INP = "w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all";
  const LBL = "block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1";

  return (
    <form onSubmit={handleSubmit} className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-4">
      <p className="text-sm font-bold text-slate-700">{initialProperty ? "Edit Property" : "New Property"}</p>

      <div>
        <label className={LBL}>Property Name / Label <span className="text-slate-300">(optional)</span></label>
        <input className={INP} value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Lake House, Office" />
      </div>

      <div>
        <label className={LBL}>Street Address <span className="text-red-400">*</span></label>
        <input required className={INP} value={form.address} onChange={e => set("address", e.target.value)} placeholder="1234 Elm Street" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={LBL}>City <span className="text-red-400">*</span></label>
          <input required className={INP} value={form.city} onChange={e => set("city", e.target.value)} placeholder="City" />
        </div>
        <div>
          <label className={LBL}>State <span className="text-red-400">*</span></label>
          <input required className={INP} value={form.state} onChange={e => set("state", e.target.value)} placeholder="MO" />
        </div>
        <div>
          <label className={LBL}>Zip <span className="text-red-400">*</span></label>
          <input required className={INP} value={form.zip} onChange={e => set("zip", e.target.value)} placeholder="64501" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LBL}>County</label>
          <input className={INP} value={form.county} onChange={e => set("county", e.target.value)} placeholder="County" />
        </div>
        <div>
          <label className={LBL}>Subdivision</label>
          <input className={INP} value={form.subdivision} onChange={e => set("subdivision", e.target.value)} placeholder="Subdivision or campus" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={LBL}>Type</label>
          <select className={INP} value={form.propertyType} onChange={e => set("propertyType", e.target.value)}>
            {["residential","commercial","condo","hoa"].map(t => (
              <option key={t} value={t} className="capitalize">{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={LBL}>Windows</label>
          <input type="number" className={INP} value={form.windowCount} onChange={e => set("windowCount", e.target.value)} placeholder="24" />
        </div>
        <div>
          <label className={LBL}>Stories</label>
          <input type="number" className={INP} value={form.stories} onChange={e => set("stories", e.target.value)} placeholder="2" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LBL}>Gate Code</label>
          <input className={INP} value={form.gateCode} onChange={e => set("gateCode", e.target.value)} placeholder="#1234" />
        </div>
        <div>
          <label className={LBL}>Access Notes</label>
          <input className={INP} value={form.accessNotes} onChange={e => set("accessNotes", e.target.value)} placeholder="Side gate on left" />
        </div>
      </div>

      <div>
        <label className={LBL}>Service Notes</label>
        <input className={INP} value={form.serviceNotes} onChange={e => set("serviceNotes", e.target.value)} placeholder="Any notes for the crew" />
      </div>

      <div>
        <label className={LBL}>Directions</label>
        <textarea className={INP} value={form.directions} onChange={e => set("directions", e.target.value)} placeholder="Arrival, parking, or entrance directions" />
      </div>

      <div>
        <label className={LBL}>Location Notes</label>
        <textarea className={INP} value={form.locationNotes} onChange={e => set("locationNotes", e.target.value)} placeholder="Notes that stay with this service location" />
      </div>

      <div className="flex flex-wrap gap-5 py-1">
        {[
          { key: "hasScreens",   label: "Has Screens" },
          { key: "hasHardWater", label: "Hard Water" },
          { key: "hasTracks",    label: "Has Tracks" },
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded accent-primary"
              checked={(form as Record<string, unknown>)[key] as boolean}
              onChange={e => set(key, e.target.checked)} />
            <span className="text-sm text-slate-700">{label}</span>
          </label>
        ))}
      </div>

      <div className="pt-1 border-t border-slate-200 flex flex-wrap gap-5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 rounded accent-primary"
            checked={form.isPrimary} onChange={e => set("isPrimary", e.target.checked)} />
          <span className="text-sm font-semibold text-amber-700 flex items-center gap-1">
            <Star className="w-3.5 h-3.5" /> Set as Default Property
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 rounded accent-primary"
            checked={form.isBillingAddress} onChange={e => set("isBillingAddress", e.target.checked)} />
          <span className="text-sm font-semibold text-blue-700 flex items-center gap-1">
            <CreditCard className="w-3.5 h-3.5" /> Use as Billing Address
          </span>
        </label>
      </div>

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={isPending}
          className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 active:scale-[.98] transition-all disabled:opacity-60">
          {isPending ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel}
          className="px-5 h-10 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Jobs Tab ─────────────────────────────────────────────────────────────────
function JobsTab({ jobs, customerId, canSchedule }: { jobs: Job[]; customerId: number; canSchedule: boolean }) {
  const [, navigate] = useLocation();
  const scheduledJobs = jobs.filter((job) => job.status !== "completed");
  const completedJobs = jobs.filter((job) => job.status === "completed");
  const statusColor: Record<string, string> = {
    scheduled: "border-blue-400",
    in_progress: "border-amber-400",
    completed: "border-emerald-400",
    cancelled: "border-red-300",
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{jobs.length} job{jobs.length !== 1 ? "s" : ""}</p>
        {canSchedule && <button
          onClick={() => navigate(`/jobs/new?customerId=${customerId}`)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3 h-3" /> Schedule Job
        </button>}
      </div>
      {jobs.length === 0 ? (
        <Empty icon={Briefcase} message="No jobs yet" />
      ) : (
        <div className="space-y-5">
          {([
            ["Scheduled & active", scheduledJobs],
            ["Completed", completedJobs],
          ] as const).map(([label, group]) => group.length > 0 && (
            <section key={label} className="space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label} · {group.length}</h3>
              {group.map(j => (
          <Link key={j.id} href={`/jobs/${j.id}`}>
            <div className={`bg-white rounded-2xl border-l-4 border border-slate-200 ${statusColor[j.status] ?? "border-slate-300"} pl-4 pr-5 py-4 hover:shadow-md transition-shadow cursor-pointer flex items-center gap-4`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-slate-900 text-sm">{j.jobNumber}</p>
                  <StatusBadge status={j.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {j.serviceType && <span className="mr-2">{j.serviceType}</span>}
                  {j.scheduledDate && (() => {
                    const iso = parseJobDate(j.scheduledDate);
                    if (!iso) return null;
                    return <span className="flex items-center gap-1 inline-flex"><Calendar className="w-3 h-3" />{new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>;
                  })()}
                  {j.lineItems && (() => {
                    try {
                      const items = JSON.parse(j.lineItems);
                      if (Array.isArray(items) && items.length > 1) {
                        return <span className="ml-2 text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">{items.length} services</span>;
                      }
                    } catch {}
                    return null;
                  })()}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-slate-900 text-sm">${parseFloat(j.totalAmount).toFixed(2)}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
            </div>
          </Link>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentsTab({ payments }: { payments: PaymentRecord[] }) {
  if (payments.length === 0) return <Empty icon={CreditCard} message="No payments recorded" />;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-emerald-800">Total payment history</span>
        <span className="text-lg font-bold text-emerald-900">
          ${payments.reduce((sum, payment) => sum + Number(payment.amount), 0).toFixed(2)}
        </span>
      </div>
      {payments.map((payment) => (
        <div key={payment.id} className="bg-white rounded-2xl border border-slate-200 px-5 py-4 flex items-start gap-4">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <CreditCard className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-900">${Number(payment.amount).toFixed(2)} · {payment.method}</p>
            <p className="text-xs text-slate-500 mt-0.5">{payment.paymentDate}{payment.reference ? ` · ${payment.reference}` : ""}</p>
            {payment.allocations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {payment.allocations.map((allocation) => (
                  <Link key={allocation.id} href={`/invoices/${allocation.invoiceId}`}>
                    <span className="inline-flex rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-primary">
                      Invoice #{allocation.invoiceId} · ${Number(allocation.amount).toFixed(2)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Quotes Tab ───────────────────────────────────────────────────────────────
function QuotesTab({ quotes, customerId }: { quotes: Quote[]; customerId: number }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">{quotes.length} quote{quotes.length !== 1 ? "s" : ""}</p>
      {quotes.length === 0 ? (
        <Empty icon={FileText} message="No quotes yet" />
      ) : (
        quotes.map(q => (
          <Link key={q.id} href={`/quotes/${q.id}`}>
            <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 hover:shadow-md transition-shadow cursor-pointer flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-slate-900 text-sm">{q.quoteNumber}</p>
                  <StatusBadge status={q.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Created {new Date(q.createdAt).toLocaleDateString()}
                  {q.validUntil && ` · Valid until ${q.validUntil}`}
                </p>
              </div>
              <p className="font-bold text-slate-900 text-sm shrink-0">${parseFloat(q.totalAmount).toFixed(2)}</p>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

// ─── Invoices Tab ─────────────────────────────────────────────────────────────
function InvoicesTab({ invoices, customerId }: { invoices: Invoice[]; customerId: number }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">{invoices.length} invoice{invoices.length !== 1 ? "s" : ""}</p>
      {invoices.length === 0 ? (
        <Empty icon={Receipt} message="No invoices yet" />
      ) : (
        invoices.map(inv => (
          <Link key={inv.id} href={`/invoices/${inv.id}`}>
            <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 hover:shadow-md transition-shadow cursor-pointer flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-slate-900 text-sm">{inv.invoiceNumber}</p>
                  <StatusBadge status={inv.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {inv.dueDate && `Due ${inv.dueDate}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-slate-900 text-sm">${parseFloat(inv.totalAmount).toFixed(2)}</p>
                {parseFloat(inv.balanceDue) > 0 && !["paid", "voided", "credited"].includes(inv.status) && (
                  <p className="text-[10px] text-red-500 font-semibold">${parseFloat(inv.balanceDue).toFixed(2)} due</p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

// ─── Communications Tab ───────────────────────────────────────────────────────
function CommunicationsTab({ messages, customerId }: { messages: MessageLog[]; customerId: number }) {
  const channelIcon: Record<string, React.ComponentType<{ className?: string }>> = {
    email: Mail,
    sms: Phone,
    letter: FileText,
  };
  return (
    <div className="space-y-3">
      <CommunicationSafetyCard customerId={customerId} />
      <p className="text-sm text-slate-500">{messages.length} message{messages.length !== 1 ? "s" : ""}</p>
      {messages.length === 0 ? (
        <Empty icon={MessageSquare} message="No communications yet" />
      ) : (
        messages.map(m => {
          const Icon = channelIcon[m.channel] ?? MessageSquare;
          return (
            <div key={m.id} className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-slate-900">{m.subject ?? m.triggerType}</p>
                    <StatusBadge status={m.status} />
                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 capitalize">{m.channel}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{m.body}</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {m.sentAt ? `Sent ${new Date(m.sentAt).toLocaleString()}` : `Created ${new Date(m.createdAt).toLocaleString()}`}
                  </p>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Callbacks Tab ────────────────────────────────────────────────────────────
function CallbacksTab({ customer, isEditing, form }: {
  customer: CustomerDetail; isEditing: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
}) {
  return (
    <div className="space-y-4">
      <Section title="Callback Notes" icon={PhoneCall}>
        {isEditing ? (
          <textarea
            {...form.register("callbackNotes")}
            rows={6}
            placeholder="Enter callback notes…"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white resize-y"
          />
        ) : (
          <p className="text-sm text-slate-700 whitespace-pre-wrap">
            {customer.callbackNotes ?? <span className="italic text-slate-300">No callback notes</span>}
          </p>
        )}
      </Section>
      <Section title="Directions to Property" icon={MapPin}>
        {isEditing ? (
          <textarea
            {...form.register("directions")}
            rows={4}
            placeholder="Directions to reach the property…"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white resize-y"
          />
        ) : (
          <p className="text-sm text-slate-700 whitespace-pre-wrap">
            {customer.directions ?? <span className="italic text-slate-300">No directions</span>}
          </p>
        )}
      </Section>
    </div>
  );
}

// ─── Notes Tab ────────────────────────────────────────────────────────────────
function NotesTab({ customer, isEditing, form }: {
  customer: CustomerDetail; isEditing: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
}) {
  return (
    <div className="space-y-4">
      <Section title="General Notes" icon={StickyNote}>
        {isEditing ? (
          <textarea
            {...form.register("notes")}
            rows={6}
            placeholder="General notes about this customer…"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white resize-y"
          />
        ) : (
          <p className="text-sm text-slate-700 whitespace-pre-wrap">
            {customer.notes ?? <span className="italic text-slate-300">No general notes</span>}
          </p>
        )}
      </Section>
      <Section title="Specific Notes" icon={AlertCircle}>
        {isEditing ? (
          <textarea
            {...form.register("specificNotes")}
            rows={4}
            placeholder="Specific notes (e.g. always knock twice, dog in yard)…"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white resize-y"
          />
        ) : (
          <p className="text-sm text-slate-700 whitespace-pre-wrap">
            {customer.specificNotes ?? <span className="italic text-slate-300">No specific notes</span>}
          </p>
        )}
      </Section>
    </div>
  );
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────
function ActivityTab({ logs }: { logs: ActivityLog[] }) {
  if (!logs || logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-300">
        <Activity className="w-10 h-10 mb-3" />
        <p className="text-sm font-medium">No activity recorded yet</p>
      </div>
    );
  }

  const actionLabel: Record<string, string> = {
    deactivated:                    "Deactivated",
    reactivated:                    "Reactivated",
    status_changed:                 "Status Changed",
    note_added:                     "Note Added",
    note_updated:                   "Note Updated",
    field_updated:                  "Field Updated",
    customer_created:               "Customer Created",
    customer_updated:               "Customer Updated",
    created:                        "Created",
    email_sent:                     "Email Sent",
    quote_created:                  "Quote Created",
    quote_updated:                  "Quote Updated",
    quote_status_changed:           "Quote Status Changed",
    quote_converted:                "Quote Converted to Job",
    job_created:                    "Job Created",
    job_status_changed:             "Job Status Changed",
    job_rescheduled:                "Job Rescheduled",
    job_crew_assigned:              "Crew Assigned",
    job_deleted:                    "Job Deleted",
    invoice_created:                "Invoice Created",
    invoice_generated:              "Invoice Generated",
    invoice_status_changed:         "Invoice Status Changed",
    file_uploaded:                  "File Uploaded",
    file_deleted:                   "File Deleted",
    recurring_plan_created:         "Recurring Plan Created",
    recurring_plan_updated:         "Recurring Plan Updated",
    recurring_plan_status_changed:  "Recurring Plan Status Changed",
    recurring_plan_deleted:         "Recurring Plan Deleted",
  };

  return (
    <div className="relative pl-6">
      <div className="absolute left-2.5 top-0 bottom-0 w-px bg-slate-100" />
      {logs.map(log => (
        <div key={log.id} className="relative mb-4">
          <div className={`absolute -left-3.5 top-1.5 w-2.5 h-2.5 rounded-full border-2 ${
            log.action === "deactivated"                   ? "bg-orange-200 border-orange-500" :
            log.action === "reactivated"                   ? "bg-emerald-200 border-emerald-500" :
            log.action === "email_sent"                    ? "bg-blue-200 border-blue-500" :
            log.action === "quote_converted"               ? "bg-violet-200 border-violet-500" :
            log.action === "job_created"                   ? "bg-cyan-200 border-cyan-500" :
            log.action === "job_deleted"                   ? "bg-red-200 border-red-400" :
            log.action === "job_rescheduled"               ? "bg-amber-200 border-amber-500" :
            log.action === "job_crew_assigned"             ? "bg-indigo-200 border-indigo-500" :
            log.action === "invoice_created"               ? "bg-emerald-200 border-emerald-500" :
            log.action === "invoice_generated"             ? "bg-emerald-200 border-emerald-500" :
            log.action === "invoice_status_changed"        ? "bg-emerald-200 border-emerald-500" :
            log.action === "file_uploaded"                 ? "bg-slate-200 border-slate-400" :
            log.action === "file_deleted"                  ? "bg-red-200 border-red-400" :
            log.action === "customer_created"              ? "bg-cyan-200 border-cyan-500" :
            log.action === "recurring_plan_created"        ? "bg-violet-200 border-violet-400" :
            log.action === "recurring_plan_deleted"        ? "bg-red-200 border-red-400" :
            log.action === "recurring_plan_status_changed" ? "bg-amber-200 border-amber-500" :
            log.action === "recurring_plan_updated"        ? "bg-indigo-200 border-indigo-400" :
            "bg-primary/20 border-primary/60"
          }`} />
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {actionLabel[log.action] ?? log.action.replace(/_/g, " ")}
              </span>
              <span className="text-[10px] text-slate-400">
                {new Date(log.createdAt).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
            </div>
            {log.note && <p className="text-sm text-slate-700 whitespace-pre-wrap">{log.note}</p>}
            {log.fromValue && log.toValue && (
              <p className="text-xs text-slate-500">
                <span className="font-medium">{log.fromValue}</span>
                {" → "}
                <span className="font-medium text-primary">{log.toValue}</span>
              </p>
            )}
            {log.reason && (
              <p className="text-xs text-slate-500 mt-0.5">Reason: {log.reason}</p>
            )}
            {log.performedBy && (
              <p className="text-[10px] text-slate-400 mt-1">{log.performedBy}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────
function Empty({ icon: Icon, message }: { icon: React.ComponentType<{ className?: string }>; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-300">
      <Icon className="w-10 h-10 mb-3" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color?: "red" }) {
  return (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}: </span>
      <span className={`text-xs ${color === "red" ? "text-red-600 font-semibold" : "text-slate-700"}`}>{value}</span>
    </div>
  );
}

function Badge({ label, color = "slate" }: { label: string; color?: "slate" | "amber" }) {
  const c = color === "amber" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
  return <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${c}`}>{label}</span>;
}
