import { useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  ArrowLeft, Clock, MapPin, FileText, User, Pencil, Save,
  PlayCircle, CheckCircle2, XCircle, Trash2, X, Receipt,
  Phone, Mail, Navigation, ExternalLink, CalendarDays,
  AlertCircle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  useGetJob,
  useUpdateJob,
  useDeleteJob,
  useListCrews,
  useListActiveTeamUsers,
  generateInvoice,
  useListInvoices,
  getListJobsQueryKey,
  getGetJobQueryKey,
  getGetCustomerQueryKey,
  getListCustomersQueryKey,
  getListInvoicesQueryKey,
  getListCrewsQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation, useParams } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { format } from "date-fns";
import { formatJobDateOnly, isJobScheduledInFuture } from "@/lib/job-date";
import { PropertyPicker } from "@/components/PropertyPicker";
import { nextIdSelectValue, nextOptionalSelectValue } from "@/lib/select-guards";
import { useAuth } from "@workspace/replit-auth-web";
import { hasClientCapability } from "@/lib/rbac";
import { getJobFinancialVisibility } from "@/lib/job-financial-visibility";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { buildJobNotesPayload, hasJobNotesChanges, isAppendOnlyJobNotes } from "@/lib/job-notes-editing";
import { filterSelectableCrewTechnicians } from "@/lib/crew-technician-options";
import { liveDateControlValue, liveTimeControlValue } from "@/lib/job-new-scheduled-date";
import { committedJobScheduleMatches } from "@/lib/job-date-commit";
import { canOfferPermanentJobDelete, isCompletedJobStatus } from "@/lib/job-delete-eligibility";

// ─── Status config ────────────────────────────────────────────────────────────

const CREW_UNASSIGNED = "unassigned";
const TECH_UNASSIGNED = "unassigned";

const STATUS_CONFIG: Record<string, {
  label: string;
  badgeBg: string;
  badgeText: string;
  dot: string;
  border: string;
}> = {
  scheduled:   { label: "Scheduled",   badgeBg: "bg-blue-50",    badgeText: "text-blue-700",    dot: "bg-blue-400",    border: "border-l-blue-400" },
  in_progress: { label: "In Progress", badgeBg: "bg-amber-50",   badgeText: "text-amber-700",   dot: "bg-amber-400",   border: "border-l-amber-400" },
  completed:   { label: "Completed",   badgeBg: "bg-emerald-50", badgeText: "text-emerald-700", dot: "bg-emerald-400", border: "border-l-emerald-400" },
  canceled:    { label: "Canceled",    badgeBg: "bg-red-50",     badgeText: "text-red-600",     dot: "bg-red-400",     border: "border-l-red-400" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d?: string | null) {
  return formatJobDateOnly(d, "EEEE, MMMM d, yyyy");
}

function formatDateShort(d?: string | null) {
  return formatJobDateOnly(d, "EEE, MMM d");
}

function formatTime(t?: string | null) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDatetime(d?: string | null) {
  if (!d) return null;
  try { return format(new Date(d), "MMM d, yyyy 'at' h:mm a"); }
  catch { return d; }
}

function buildMapsUrl(property: { address?: string; city?: string; state?: string; zip?: string } | null) {
  if (!property?.address) return null;
  const addr = [property.address, property.city, property.state, property.zip].filter(Boolean).join(", ");
  return `https://maps.google.com/?q=${encodeURIComponent(addr)}`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status?.trim()
      ? status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      : "Unknown",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-600",
    dot: "bg-slate-400",
    border: "border-l-slate-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold ${cfg.badgeBg} ${cfg.badgeText}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function JobDetailSkeleton() {
  return (
    <Layout>
      <div className="animate-pulse space-y-4 pb-32 sm:pb-0">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 bg-slate-200 rounded-xl" />
          <div className="h-5 w-24 bg-slate-200 rounded-md" />
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
          <div className="h-7 w-48 bg-slate-200 rounded-md" />
          <div className="h-4 w-36 bg-slate-100 rounded-md" />
          <div className="h-4 w-28 bg-slate-100 rounded-md" />
          <div className="h-10 w-full bg-slate-100 rounded-xl mt-2" />
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 h-24" />
        <div className="bg-white rounded-2xl border border-slate-100 p-5 h-32" />
      </div>
    </Layout>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const jobId = parseInt(id, 10);
  const [, navigate] = useLocation();
  const { goBack, backLabel } = useBackNavigation("/jobs");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const financialVisibility = getJobFinancialVisibility(user);
  const canManageJob = hasClientCapability(user, "jobs.manage");
  const canManageSchedule = hasClientCapability(user, "schedule.manage");
  const appendOnlyNotes = isAppendOnlyJobNotes(user);

  // Confirmation dialogs
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editTechNotes, setEditTechNotes] = useState("");
  const [editServiceType, setEditServiceType] = useState("");
  const [editPropertyId, setEditPropertyId] = useState<number | "">("");
  const [editCrewId, setEditCrewId] = useState<number | "">("");
  const [editAssignedTechnicianUserId, setEditAssignedTechnicianUserId] = useState<string>("");
  const editDateInputRef = useRef<HTMLInputElement>(null);
  const editStartTimeInputRef = useRef<HTMLInputElement>(null);
  const editEndTimeInputRef = useRef<HTMLInputElement>(null);

  // Notes state (always-visible inline)
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [techNotesDraft, setTechNotesDraft] = useState<string | null>(null);

  const { data: job, isLoading, isError } = useGetJob(jobId, {
    query: { queryKey: authScopedQueryKey(user, getGetJobQueryKey(jobId)) },
  });

  const { data: crewsData } = useListCrews({
    query: {
      enabled: canManageSchedule,
      queryKey: authScopedQueryKey(user, getListCrewsQueryKey())
    }
  });
  const crews = (crewsData ?? []).filter((c) => c.isActive);

  const { data: teamUsersData } = useListActiveTeamUsers({
    query: {
      enabled: canManageSchedule,
      queryKey: authScopedQueryKey(user, ["/api/team-users/active"])
    }
  });
  const teamUsers = filterSelectableCrewTechnicians(teamUsersData ?? []);

  const canViewInvoices = financialVisibility.showInvoices;
  const canViewJobValue = financialVisibility.showJobValue;
  const canViewLinkedQuote = financialVisibility.showLinkedQuote;
  const canManageInvoices = hasClientCapability(user, "invoices.manage");
  const { data: invoices = [], isLoading: invoicesLoading } = useListInvoices(
    { jobId },
    {
      query: {
        enabled: canViewInvoices,
        queryKey: authScopedQueryKey(user, getListInvoicesQueryKey({ jobId })),
      },
    },
  );
  const hasLinkedInvoices = invoices.length > 0;

  const updateMutation = useUpdateJob({
    mutation: {
      onSuccess: (committedJob, variables) => {
        const detailQueryKey = authScopedQueryKey(user, getGetJobQueryKey(jobId));
        queryClient.setQueryData(detailQueryKey, committedJob);
        if (!committedJobScheduleMatches(variables.data, committedJob)) {
          toast({
            title: "Save not confirmed",
            description: "The server did not commit the scheduled date and times you entered. The editor remains open.",
            variant: "destructive",
          });
          queryClient.invalidateQueries({ queryKey: detailQueryKey });
          return;
        }
        queryClient.invalidateQueries({ queryKey: detailQueryKey });
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListJobsQueryKey()) });
        // Keep the customer detail view consistent when navigating back
        if (job?.customerId) {
          queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetCustomerQueryKey(job.customerId)) });
          queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCustomersQueryKey()) });
        }
        toast({ title: "Saved" });
        setEditing(false);
        setNotesDraft(null);
        setTechNotesDraft(null);
      },
      onError: () => {
        toast({ title: "Failed to save", variant: "destructive" });
      },
    },
  });

  const deleteMutation = useDeleteJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListJobsQueryKey()) });
        // Keep customer detail fresh after deletion
        if (job?.customerId) {
          queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetCustomerQueryKey(job.customerId)) });
        }
        navigate("/jobs");
        toast({ title: "Job deleted" });
      },
      onError: () => {
        toast({ title: "Failed to delete", variant: "destructive" });
      },
    },
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: ({ id, key }: { id: number; key: string }) =>
      generateInvoice(id, idempotencyRequest(key)),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListInvoicesQueryKey()) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetJobQueryKey(jobId)) });
      toast({ title: "Invoice created!" });
      navigate(`/invoices/${invoice.id}`);
    },
    onError: (err: unknown) => {
      const apiErr = err as { data?: { error?: string; invoiceId?: number } };
      if (apiErr?.data?.invoiceId) {
        toast({ title: "Opening existing invoice" });
        navigate(`/invoices/${apiErr.data.invoiceId}`);
      } else {
        toast({ title: apiErr?.data?.error ?? "Failed to generate invoice", variant: "destructive" });
      }
    },
  });

  const changeStatus = (status: string) => {
    updateMutation.mutate({ id: jobId, data: { status } });
  };

  const startEdit = () => {
    if (!job) return;
    setEditDate(job.scheduledDate ?? "");
    setEditStartTime(job.scheduledStartTime ?? "");
    setEditEndTime(job.scheduledEndTime ?? "");
    setEditNotes(job.notes ?? "");
    setEditTechNotes(job.techNotes ?? "");
    setEditServiceType(job.serviceType ?? "");
    setEditPropertyId(job.propertyId ?? "");
    setEditCrewId(job.crewId ?? "");
    setEditAssignedTechnicianUserId(job.assignedTechnicianUserId ?? "");
    setEditing(true);
  };

  const saveEdit = () => {
    const submittedEditDate = liveDateControlValue(
      editDateInputRef.current,
      editDate,
    );
    const submittedStartTime = liveTimeControlValue(editStartTimeInputRef.current, editStartTime);
    const submittedEndTime = liveTimeControlValue(editEndTimeInputRef.current, editEndTime);
    updateMutation.mutate({
      id: jobId,
      data: {
        scheduledDate: submittedEditDate || null,
        scheduledStartTime: submittedStartTime || null,
        scheduledEndTime: submittedEndTime || null,
        notes: editNotes || null,
        techNotes: editTechNotes || null,
        serviceType: editServiceType || null,
        propertyId: editPropertyId === "" ? null : Number(editPropertyId),
        crewId: editCrewId === "" ? null : Number(editCrewId),
        assignedTechnicianUserId: editAssignedTechnicianUserId === "" ? null : editAssignedTechnicianUserId,
      },
    });
  };

  const saveNotes = () => {
    const data = buildJobNotesPayload({
      appendOnly: appendOnlyNotes,
      notesDraft,
      techNotesDraft,
      existingNotes: job?.notes,
      existingTechNotes: job?.techNotes,
    });
    if (!Object.keys(data).length) return;
    updateMutation.mutate({
      id: jobId,
      data,
    });
  };

  if (isLoading) return <JobDetailSkeleton />;

  if (isError || !job) {
    return (
      <Layout>
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLabel ?? "Jobs"}
        </button>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <AlertCircle className="w-12 h-12 text-slate-200 mb-4" />
          <h2 className="text-lg font-bold text-slate-700 mb-1">Job not found</h2>
          <p className="text-slate-400 text-sm mb-5">This job doesn't exist or may have been deleted.</p>
          <button
            onClick={goBack}
            className="px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors"
          >
            {backLabel ?? "Jobs"}
          </button>
        </div>
      </Layout>
    );
  }

  const statusCfg = STATUS_CONFIG[job.status] ?? {
    label: "Unknown", badgeBg: "bg-slate-100", badgeText: "text-slate-600",
    dot: "bg-slate-400", border: "border-l-slate-400",
  };
  const jobCustomer = (job as { customer?: { displayName?: string; email?: string | null; phone?: string | null } }).customer;
  const jobProperty = (job as { property?: { name?: string | null; address?: string; city?: string; state?: string; zip?: string } | null }).property ?? null;
  const linkedQuote  = (job as { linkedQuote?: { id: number; quoteNumber: string; status: string; totalAmount: number } | null }).linkedQuote;
  const assignment = job as typeof job & {
    crewSummary?: { displayName?: string | null; name?: string | null; isActive?: boolean; archivedAt?: string | null } | null;
    crew?: { displayName?: string | null; name?: string | null; isActive?: boolean; archivedAt?: string | null } | null;
    assignedTechnician?: { displayName?: string | null; isActive?: boolean; archivedAt?: string | null } | null;
  };
  const assignedCrew = assignment.crewSummary ?? assignment.crew;
  const assignedCrewName = assignedCrew?.displayName || assignedCrew?.name
    || crews.find((crew) => crew.id === job.crewId)?.name;
  const crewLabel = job.crewId
    ? assignedCrewName
      ? `${assignedCrewName}${assignedCrew?.archivedAt || assignedCrew?.isActive === false ? " (Archived)" : ""}`
      : "Archived or unavailable crew"
    : "Unassigned";
  const technicianLabel = job.assignedTechnicianUserId
    ? assignment.assignedTechnician?.displayName
      ? `${assignment.assignedTechnician.displayName}${assignment.assignedTechnician.archivedAt || assignment.assignedTechnician.isActive === false ? " (Archived)" : ""}`
      : "Archived or unavailable technician"
    : "Unassigned";
  const mapsUrl = buildMapsUrl(jobProperty);

  const isActionable = job.status === "scheduled" || job.status === "in_progress";
  const isCompleted  = isCompletedJobStatus(job.status);
  const isCanceled   = job.status === "canceled";
  // The detail API derives this flag from completion plus both invoice-link
  // models. Missing state fails closed; the DELETE transaction remains the
  // authority if a stale browser tab races a later invoice association.
  const isDeleteProtected = isCompleted || job.isDeleteProtected !== false;
  const canDeleteJob = canOfferPermanentJobDelete({
    canManageJobs: canManageJob,
    status: job.status,
    isDeleteProtected: job.isDeleteProtected,
  });

  // Future-date guard: Mark Complete is blocked when the job's scheduled date
  // is strictly in the future.  Mirrors the API-level check so the UI
  // prevents the request rather than showing a confusing 400 error.
  const isFutureJob  = isActionable && isJobScheduledInFuture(job?.scheduledDate);

  const notesValue = appendOnlyNotes ? notesDraft ?? "" : notesDraft ?? job.notes ?? "";
  const techNotesValue = appendOnlyNotes ? techNotesDraft ?? "" : techNotesDraft ?? job.techNotes ?? "";
  const anyNotesDirty = hasJobNotesChanges(
    appendOnlyNotes, notesDraft, techNotesDraft, job.notes, job.techNotes,
  );

  // ── Property address text ─────────────────────────────────────────────────
  const propertyLine1 = jobProperty?.name
    ? `${jobProperty.name} — ${jobProperty.address ?? ""}`
    : (jobProperty?.address ?? null);
  const propertyLine2 = [jobProperty?.city, jobProperty?.state, jobProperty?.zip].filter(Boolean).join(", ");

  // ── Date/time display ─────────────────────────────────────────────────────
  const dateDisplay = job.scheduledDate ? formatDateShort(job.scheduledDate) : null;
  const startT = formatTime(job.scheduledStartTime);
  const endT   = formatTime(job.scheduledEndTime);
  const timeDisplay = startT ? (endT ? `${startT} – ${endT}` : startT) : null;

  return (
    <Layout>
      {/* Add bottom padding on mobile so sticky bar doesn't overlap content */}
      <div className="pb-32 sm:pb-4">

        {/* ── Back nav ─────────────────────────────────────────────────── */}
        <div className="mb-4">
          <button
            onClick={goBack}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {backLabel ?? "Jobs"}
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════
             HERO CARD — Customer · Location · Date · Value
        ══════════════════════════════════════════════════════════════ */}
        <div className={`bg-white rounded-2xl border-l-4 border border-slate-200 ${statusCfg.border} p-5 sm:p-6 mb-4`}>
          {/* Top row: job number + status */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="font-mono text-xs text-slate-400">{job.jobNumber}</span>
            <StatusBadge status={job.status} />
          </div>

          {/* Customer name — primary info */}
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 leading-tight mb-1">
            {jobCustomer?.displayName ?? `Customer #${job.customerId}`}
          </h1>

          {/* Quick contact links */}
          {(jobCustomer?.phone || jobCustomer?.email) && (
            <div className="flex flex-wrap gap-3 mb-3">
              {jobCustomer?.phone && (
                <a
                  href={`tel:${jobCustomer.phone}`}
                  className="flex items-center gap-1 text-primary text-sm font-medium hover:underline"
                >
                  <Phone className="w-3.5 h-3.5" />
                  {jobCustomer.phone}
                </a>
              )}
              {jobCustomer?.email && (
                <a
                  href={`mailto:${jobCustomer.email}`}
                  className="flex items-center gap-1 text-slate-500 text-sm hover:text-primary transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {jobCustomer.email}
                </a>
              )}
            </div>
          )}

          {/* Property */}
          {propertyLine1 && (
            <div className="flex items-start gap-2 mb-2">
              <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-slate-600">{propertyLine1}</p>
                {propertyLine2 && <p className="text-xs text-slate-400">{propertyLine2}</p>}
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary text-xs font-medium mt-1 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Navigation className="w-3 h-3" />
                    Open in Maps
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Date + time */}
          {(dateDisplay || timeDisplay) && (
            <div className="flex items-center gap-3 flex-wrap mb-3">
              {dateDisplay && (
                <span className="flex items-center gap-1 text-sm text-slate-600">
                  <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                  {dateDisplay}
                </span>
              )}
              {timeDisplay && (
                <span className="flex items-center gap-1 text-sm text-slate-600">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {timeDisplay}
                </span>
              )}
            </div>
          )}

          {/* Completion timestamp */}
          {isCompleted && job.completedAt && (
            <div className="flex items-center gap-1.5 mb-3">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <p className="text-sm font-medium text-emerald-600">
                Completed {formatDatetime(job.completedAt)}
              </p>
            </div>
          )}

          {/* Job value */}
          {canViewJobValue && <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-100">
            <span className="text-sm text-slate-500 font-medium">Job Value</span>
            <span className="text-2xl font-bold text-slate-900">{formatCurrency(job.totalAmount)}</span>
          </div>}
        </div>

        {/* Future-date guard banner */}
        {isFutureJob && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-800">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <span>
              Scheduled for <strong>{formatDate(job?.scheduledDate)}</strong> — Start Job and Mark Complete are unavailable until that date arrives.
            </span>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
             PRIMARY ACTIONS — full-width, impossible to miss
        ══════════════════════════════════════════════════════════════ */}
        <div className="hidden sm:block mb-4">
          <div className="flex flex-col sm:flex-row gap-2.5">
            {canManageJob && job.status === "scheduled" && (
              <button
                onClick={() => changeStatus("in_progress")}
                disabled={updateMutation.isPending || isFutureJob}
                title={isFutureJob ? `Scheduled for ${job?.scheduledDate} — not yet startable` : undefined}
                className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl
                           bg-amber-500 hover:bg-amber-600 active:scale-[.98]
                           text-white text-base font-bold shadow-md shadow-amber-200
                           transition-all disabled:opacity-60"
              >
                <PlayCircle className="w-5 h-5" />
                Start Job
              </button>
            )}
            {canManageJob && isActionable && (
              <button
                onClick={() => changeStatus("completed")}
                disabled={updateMutation.isPending || isFutureJob}
                title={isFutureJob ? `Scheduled for ${job?.scheduledDate} — not yet completable` : undefined}
                className="flex-[2] flex items-center justify-center gap-2 h-12 rounded-xl
                           bg-emerald-500 hover:bg-emerald-600 active:scale-[.98]
                           text-white text-base font-bold shadow-md shadow-emerald-200
                           transition-all disabled:opacity-60"
              >
                <CheckCircle2 className="w-5 h-5" />
                Mark Complete
              </button>
            )}
            {canManageInvoices && isCompleted && !invoicesLoading && !hasLinkedInvoices && (
              <button
                onClick={() => generateInvoiceMutation.mutate({ id: jobId, key: createIdempotencyKey() })}
                disabled={generateInvoiceMutation.isPending}
                className="flex-[2] flex items-center justify-center gap-2 h-12 rounded-xl
                           bg-primary hover:bg-primary/90 active:scale-[.98]
                           text-white text-base font-bold shadow-md shadow-primary/20
                           transition-all disabled:opacity-60"
              >
                <Receipt className="w-5 h-5" />
                {generateInvoiceMutation.isPending ? "Generating…" : "Generate Invoice"}
              </button>
            )}
            {canManageSchedule && isActionable && (
              <button
                onClick={() => setConfirmCancel(true)}
                disabled={updateMutation.isPending}
                className="flex items-center justify-center gap-2 h-12 px-5 rounded-xl
                           border-2 border-red-200 text-red-600 bg-white hover:bg-red-50 active:scale-[.98]
                           text-sm font-bold transition-all disabled:opacity-60"
              >
                <XCircle className="w-4.5 h-4.5" />
                Cancel Job
              </button>
            )}
            {canManageSchedule && (isCompleted || isCanceled) && (
              <button
                onClick={() => changeStatus("scheduled")}
                disabled={updateMutation.isPending}
                className="flex items-center justify-center gap-2 h-12 px-5 rounded-xl
                           border-2 border-blue-200 text-blue-700 bg-white hover:bg-blue-50 active:scale-[.98]
                           text-sm font-bold transition-all disabled:opacity-60"
              >
                Reopen
              </button>
            )}
            {canManageSchedule && <button
              onClick={startEdit}
              className="flex items-center justify-center gap-2 h-12 px-4 rounded-xl
                         border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 active:scale-[.98]
                         text-sm font-semibold transition-all"
            >
              <Pencil className="w-4 h-4" />
              Edit
            </button>}
            {canDeleteJob && <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMutation.isPending}
              title="Delete job"
              aria-label="Delete job"
              className="flex items-center justify-center h-12 w-12 rounded-xl
                         border border-red-200 text-red-500 bg-white hover:bg-red-50 active:scale-[.98]
                         transition-all disabled:opacity-60"
            >
              <Trash2 className="w-4 h-4" />
            </button>}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════
             MAIN CONTENT (2-col on desktop)
        ══════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ─── Left: Notes + Invoice + Quote ───────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* NOTES SECTION */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-slate-800">Notes</h2>
                {canManageJob && anyNotesDirty && (
                  <div className="flex gap-2">
                    <button
                      onClick={saveNotes}
                      disabled={updateMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white
                                 text-xs font-bold shadow-sm shadow-primary/20 hover:bg-primary/90
                                 transition-all disabled:opacity-60"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {updateMutation.isPending ? "Saving…" : "Save Notes"}
                    </button>
                    <button
                      onClick={() => { setNotesDraft(null); setTechNotesDraft(null); }}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500
                                 text-xs font-semibold hover:bg-slate-50 transition-all"
                    >
                      Discard
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    {appendOnlyNotes ? "Job Note History" : "Job Notes"}
                  </label>
                  {appendOnlyNotes && job.notes && (
                    <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{job.notes}</p>
                  )}
                  {appendOnlyNotes && (
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Add Job Note</label>
                  )}
                  <Textarea
                    value={notesValue}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder={appendOnlyNotes ? "Add a job note…" : "Add notes about this job…"}
                    className="resize-none rounded-xl text-sm min-h-[80px]"
                    rows={3}
                    disabled={!canManageJob}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    {appendOnlyNotes ? "Tech / Crew Note History" : "Tech / Crew Notes"}
                  </label>
                  {appendOnlyNotes && job.techNotes && (
                    <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{job.techNotes}</p>
                  )}
                  {appendOnlyNotes && (
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Add Tech / Crew Note</label>
                  )}
                  <Textarea
                    value={techNotesValue}
                    onChange={(e) => setTechNotesDraft(e.target.value)}
                    placeholder={appendOnlyNotes ? "Add a crew note…" : "Notes for the field crew…"}
                    className="resize-none rounded-xl text-sm min-h-[60px]"
                    rows={2}
                    disabled={!canManageJob}
                  />
                </div>
              </div>
            </div>

            {/* INVOICE SECTION */}
            {canViewInvoices && <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Receipt className="w-4 h-4 text-slate-400" />
                <h2 className="text-base font-bold text-slate-800">Invoices</h2>
              </div>

              {invoicesLoading ? (
                <p className="text-sm text-slate-400">Checking invoice access…</p>
              ) : hasLinkedInvoices ? (
                <div className="divide-y divide-slate-100">
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="flex items-center justify-between cursor-pointer group py-3 first:pt-0 last:pb-0"
                      onClick={() => navigate(`/invoices/${invoice.id}`)}
                    >
                      <div>
                        <p className="font-mono font-semibold text-slate-900 text-sm">{invoice.invoiceNumber}</p>
                        <p className="text-xs text-slate-500 capitalize mt-0.5">{invoice.status}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{formatCurrency(invoice.totalAmount)}</span>
                        <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : isCompleted && canManageInvoices ? (
                <div>
                  <p className="text-sm text-slate-500 mb-3">No invoice yet — ready to generate.</p>
                  <button
                    onClick={() => generateInvoiceMutation.mutate({ id: jobId, key: createIdempotencyKey() })}
                    disabled={generateInvoiceMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white
                               text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90
                               transition-all disabled:opacity-60"
                  >
                    <Receipt className="w-4 h-4" />
                    {generateInvoiceMutation.isPending ? "Generating…" : "Generate Invoice"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-400">
                  <AlertCircle className="w-4 h-4" />
                  <p className="text-sm">No invoice created yet. Complete the job to generate one.</p>
                </div>
              )}
            </div>}

            {/* LINKED QUOTE */}
            {canViewLinkedQuote && linkedQuote && (
              <div
                className="bg-white rounded-2xl border border-slate-100 p-5 cursor-pointer hover:border-slate-200 transition-colors group"
                onClick={() => navigate(`/quotes/${linkedQuote.id}`)}
              >
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <h2 className="text-base font-bold text-slate-800">From Quote</h2>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{linkedQuote.quoteNumber}</p>
                    <p className="text-xs text-slate-500 capitalize mt-0.5">{linkedQuote.status}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{formatCurrency(linkedQuote.totalAmount)}</span>
                    <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </div>
            )}

            {/* SCHEDULING — edit mode */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-slate-400" />
                  <h2 className="text-base font-bold text-slate-800">Scheduling</h2>
                </div>
                {!editing && canManageSchedule && (
                  <button
                    onClick={startEdit}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-primary transition-colors"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>

              {editing && canManageSchedule ? (
                <div className="space-y-4">
                  <PropertyPicker
                    customerId={job.customerId}
                    value={editPropertyId}
                    onChange={setEditPropertyId}
                    allowNone
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2 space-y-1.5">
                      <Label>Scheduled Date</Label>
                      <Input ref={editDateInputRef} type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="rounded-xl" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Start Time</Label>
                       <Input ref={editStartTimeInputRef} type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} className="rounded-xl" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>End Time</Label>
                       <Input ref={editEndTimeInputRef} type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} className="rounded-xl" />
                    </div>
                    <div className="sm:col-span-2 space-y-1.5">
                      <Label>Service Type</Label>
                      <Select value={editServiceType} onValueChange={setEditServiceType}>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="Select type…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="window_cleaning">Window Cleaning</SelectItem>
                          <SelectItem value="gutter_cleaning">Gutter Cleaning</SelectItem>
                          <SelectItem value="pressure_washing">Pressure Washing</SelectItem>
                          <SelectItem value="solar_panels">Solar Panels</SelectItem>
                          <SelectItem value="general">General Service</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Assign Crew</Label>
                      <Select value={editCrewId ? String(editCrewId) : CREW_UNASSIGNED} onValueChange={(v) => setEditCrewId((prev) => nextIdSelectValue(prev, v, CREW_UNASSIGNED))}>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={CREW_UNASSIGNED}>Unassigned</SelectItem>
                          {crews.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Direct Tech</Label>
                      <Select value={editAssignedTechnicianUserId || TECH_UNASSIGNED} onValueChange={(v) => setEditAssignedTechnicianUserId((prev) => nextOptionalSelectValue(prev, v, TECH_UNASSIGNED))}>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={TECH_UNASSIGNED}>Unassigned</SelectItem>
                          {teamUsers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Job Notes (edit mode)</Label>
                    <Textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Notes…"
                      className="rounded-xl resize-none"
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tech Notes</Label>
                    <Textarea
                      value={editTechNotes}
                      onChange={(e) => setEditTechNotes(e.target.value)}
                      placeholder="Field crew notes…"
                      className="rounded-xl resize-none"
                      rows={2}
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveEdit}
                      disabled={updateMutation.isPending}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white
                                 text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90
                                 transition-all disabled:opacity-60"
                    >
                      <Save className="w-4 h-4" />
                      {updateMutation.isPending ? "Saving…" : "Save Changes"}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200
                                 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all"
                    >
                      <X className="w-4 h-4" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Date</p>
                    <p className="text-slate-800 font-semibold">{formatDate(job.scheduledDate)}</p>
                  </div>
                  {(job.scheduledStartTime || job.scheduledEndTime) && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Time</p>
                      <p className="text-slate-700">
                        {formatTime(job.scheduledStartTime)}{job.scheduledEndTime ? ` – ${formatTime(job.scheduledEndTime)}` : ""}
                      </p>
                    </div>
                  )}
                  {job.serviceType && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Service Type</p>
                      <p className="text-slate-700 capitalize">{job.serviceType.replace(/_/g, " ")}</p>
                    </div>
                  )}
                  {canManageSchedule && (
                    <>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Assigned Crew</p>
                        <p className="text-slate-700">
                          {crewLabel}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Direct Tech</p>
                        <p className="text-slate-700">
                          {technicianLabel}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ─── Right: Sidebar (desktop only) ───────────────────────── */}
          <div className="hidden lg:block space-y-4">

            {/* Customer */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <User className="w-4 h-4 text-slate-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Customer</h3>
              </div>
              {jobCustomer ? (
                <div className="space-y-2">
                  <p className="font-semibold text-slate-900">{jobCustomer.displayName}</p>
                  {jobCustomer.phone && (
                    <a href={`tel:${jobCustomer.phone}`} className="flex items-center gap-1.5 text-primary text-sm font-medium hover:underline">
                      <Phone className="w-3.5 h-3.5" />
                      {jobCustomer.phone}
                    </a>
                  )}
                  {jobCustomer.email && (
                    <a href={`mailto:${jobCustomer.email}`} className="flex items-center gap-1.5 text-slate-500 text-sm hover:text-primary transition-colors">
                      <Mail className="w-3.5 h-3.5" />
                      {jobCustomer.email}
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Customer #{job.customerId}</p>
              )}
            </div>

            {/* Property */}
            {jobProperty && (
              <div className="bg-white rounded-2xl border border-slate-100 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="w-4 h-4 text-slate-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Property</h3>
                </div>
                <div className="space-y-0.5">
                  {jobProperty.name && (
                    <p className="font-semibold text-slate-900 text-sm">{jobProperty.name}</p>
                  )}
                  <p className="text-sm text-slate-700">{jobProperty.address}</p>
                  <p className="text-xs text-slate-500">
                    {[jobProperty.city, jobProperty.state, jobProperty.zip].filter(Boolean).join(", ")}
                  </p>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-primary text-xs font-medium mt-2 hover:underline"
                    >
                      <Navigation className="w-3 h-3" />
                      Open in Maps
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Timeline</h3>
              <div className="space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Created</span>
                  <span className="text-slate-700 font-medium">{format(new Date(job.createdAt), "MMM d, yyyy")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Updated</span>
                  <span className="text-slate-700 font-medium">{format(new Date(job.updatedAt), "MMM d, yyyy")}</span>
                </div>
                {job.completedAt && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-600 font-medium">Completed</span>
                    <span className="text-emerald-700 font-semibold">{formatDatetime(job.completedAt)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Danger zone */}
            {isDeleteProtected && canManageSchedule && (
              <p className="pt-1 text-xs text-slate-400">
                Permanent deletion is unavailable for completed jobs or jobs with linked invoices. Use the job workflow instead.
              </p>
            )}
            {canDeleteJob && <div className="pt-1">
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 text-sm text-red-500 hover:text-red-700 font-medium transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete Job
              </button>
            </div>}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
           MOBILE STICKY BOTTOM ACTION BAR
      ══════════════════════════════════════════════════════════════ */}
      {!editing && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/96 backdrop-blur-md border-t border-slate-200 px-4 py-3 safe-area-bottom">
          <div className="flex gap-2 max-w-lg mx-auto">
            {canManageJob && job.status === "scheduled" && (
              <button
                onClick={() => changeStatus("in_progress")}
                disabled={updateMutation.isPending || isFutureJob}
                title={isFutureJob ? `Scheduled for ${job?.scheduledDate} — not yet startable` : undefined}
                className="flex-1 flex items-center justify-center gap-2 h-14 rounded-xl
                           bg-amber-500 hover:bg-amber-600 active:scale-[.98]
                           text-white text-base font-bold shadow-md shadow-amber-200
                           transition-all disabled:opacity-60"
              >
                <PlayCircle className="w-5 h-5" />
                Start Job
              </button>
            )}
            {canManageJob && isActionable && (
              <button
                onClick={() => changeStatus("completed")}
                disabled={updateMutation.isPending || isFutureJob}
                title={isFutureJob ? `Scheduled for ${job?.scheduledDate} — not yet completable` : undefined}
                className="flex-[2] flex items-center justify-center gap-2 h-14 rounded-xl
                           bg-emerald-500 hover:bg-emerald-600 active:scale-[.98]
                           text-white text-base font-bold shadow-md shadow-emerald-200
                           transition-all disabled:opacity-60"
              >
                <CheckCircle2 className="w-5 h-5" />
                Complete
              </button>
            )}
            {canManageSchedule && isActionable && (
              <button
                onClick={() => setConfirmCancel(true)}
                disabled={updateMutation.isPending}
                title="Cancel job"
                aria-label="Cancel job"
                className="flex items-center justify-center h-14 w-14 rounded-xl
                           border-2 border-red-200 text-red-600 bg-white hover:bg-red-50 active:scale-[.98]
                           transition-all disabled:opacity-60"
              >
                <XCircle className="w-5 h-5" />
              </button>
            )}
            {canManageInvoices && isCompleted && !invoicesLoading && !hasLinkedInvoices && (
              <button
                onClick={() => generateInvoiceMutation.mutate({ id: jobId, key: createIdempotencyKey() })}
                disabled={generateInvoiceMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 h-14 rounded-xl
                           bg-primary hover:bg-primary/90 active:scale-[.98]
                           text-white text-base font-bold shadow-md shadow-primary/20
                           transition-all disabled:opacity-60"
              >
                <Receipt className="w-5 h-5" />
                {generateInvoiceMutation.isPending ? "Generating…" : "Invoice"}
              </button>
            )}
            {canManageSchedule && (isCompleted || isCanceled) && (
              <button
                onClick={() => changeStatus("scheduled")}
                disabled={updateMutation.isPending}
                className="flex-1 flex items-center justify-center h-14 rounded-xl
                           border-2 border-blue-200 text-blue-700 bg-white hover:bg-blue-50 active:scale-[.98]
                           text-sm font-bold transition-all disabled:opacity-60"
              >
                Reopen
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Confirm Delete Dialog ─────────────────────────────────────── */}
      {canDeleteJob && <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-4 h-4" /> Delete Job
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-1">
            Are you sure you want to permanently delete <span className="font-semibold">{job?.jobNumber}</span>?
            This cannot be undone.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Keep Job
            </button>
            <button
              onClick={() => { setConfirmDelete(false); deleteMutation.mutate({ id: jobId }); }}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Permanently"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {/* ── Confirm Cancel Dialog ─────────────────────────────────────── */}
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <XCircle className="w-4 h-4" /> Cancel Job
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-1">
            Mark <span className="font-semibold">{job?.jobNumber}</span> as canceled?
            You can reopen it later if needed.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setConfirmCancel(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Keep Scheduled
            </button>
            <button
              onClick={() => { setConfirmCancel(false); changeStatus("canceled"); }}
              disabled={updateMutation.isPending}
              className="px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors disabled:opacity-60"
            >
              Cancel Job
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
