import { useState } from "react";
import { Layout } from "@/components/Layout";
import {
  ArrowLeft, RefreshCw, Calendar, User, MapPin, Pencil, Save, X,
  PlayCircle, PauseCircle, XCircle, Zap, Briefcase, ChevronRight,
  Clock, DollarSign,
} from "lucide-react";
import {
  useGetRecurringPlan,
  useUpdateRecurringPlan,
  useDeleteRecurringPlan,
  useGenerateRecurringJob,
  useListJobs,
  getGetRecurringPlanQueryKey,
  getListRecurringPlansQueryKey,
  getListJobsQueryKey,
  getGetCustomerQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useParams } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { format, parseISO, isPast, isToday } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { parsePositiveRouteId } from "@/lib/route-id";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { PropertyPicker } from "@/components/PropertyPicker";

// ─── Config ───────────────────────────────────────────────────────────────────

const FREQ_OPTIONS = [
  { value: "weekly",     label: "Weekly" },
  { value: "biweekly",   label: "Every 2 Weeks" },
  { value: "monthly",    label: "Monthly" },
  { value: "bimonthly",  label: "Every 2 Months" },
  { value: "quarterly",  label: "Quarterly" },
  { value: "semiannual", label: "Semi-Annual" },
  { value: "annual",     label: "Annual" },
];

const FREQ_LABEL: Record<string, string> = Object.fromEntries(FREQ_OPTIONS.map((f) => [f.value, f.label]));

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  active:   { label: "Active",   color: "text-emerald-700", bg: "bg-emerald-50",  dot: "bg-emerald-500" },
  paused:   { label: "Paused",   color: "text-amber-700",   bg: "bg-amber-50",    dot: "bg-amber-400" },
  canceled:  { label: "Canceled",  color: "text-red-600",    bg: "bg-red-50",      dot: "bg-red-400" },
  cancelled: { label: "Canceled",  color: "text-red-600",    bg: "bg-red-50",      dot: "bg-red-400" },
  seasonal: { label: "Seasonal", color: "text-blue-700",   bg: "bg-blue-50",     dot: "bg-blue-500" },
};

const JOB_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  scheduled:   { label: "Scheduled",   color: "text-blue-700",    bg: "bg-blue-50" },
  in_progress: { label: "In Progress", color: "text-amber-700",   bg: "bg-amber-50" },
  completed:   { label: "Completed",   color: "text-emerald-700", bg: "bg-emerald-50" },
  canceled:    { label: "Canceled",    color: "text-red-600",     bg: "bg-red-50" },
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SERVICE_TYPES = [
  { value: "window_cleaning", label: "Window Cleaning" },
  { value: "gutter_cleaning", label: "Gutter Cleaning" },
  { value: "pressure_washing", label: "Pressure Washing" },
  { value: "solar_panels", label: "Solar Panel Cleaning" },
  { value: "general", label: "General Service" },
];

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try { return format(parseISO(d), "EEE, MMM d, yyyy"); } catch { return d; }
}

function RecurringPlanUnavailable({
  kind,
  onBack,
}: {
  kind: "invalid" | "missing";
  onBack: () => void;
}) {
  const invalid = kind === "invalid";
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <XCircle className="w-12 h-12 text-red-200 mb-4" />
        <h2 className="text-lg font-bold text-slate-700 mb-1">
          {invalid ? "Invalid recurring plan link" : "Recurring plan not found"}
        </h2>
        <p className="text-slate-400 text-sm mb-5">
          {invalid
            ? "The plan ID must be a positive whole number."
            : "This recurring plan does not exist or is no longer available."}
        </p>
        <Button type="button" onClick={onBack} className="rounded-xl">
          Back to Recurring Plans
        </Button>
      </div>
    </Layout>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function RecurringPlanDetail() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const parsedPlanId = parsePositiveRouteId(id);
  const isValidRouteId = parsedPlanId !== null;
  // Generated hooks require a numeric argument even when disabled.
  const planId = parsedPlanId ?? 0;
  const [, navigate] = useLocation();
  const { goBack, backLabel } = useBackNavigation("/recurring-plans");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string | number | boolean>>({});
  const [editPropertyId, setEditPropertyId] = useState<number | "">("");

  const { data: plan, isLoading } = useGetRecurringPlan(planId, {
    query: {
      enabled: isValidRouteId,
      queryKey: getGetRecurringPlanQueryKey(planId),
    },
  });
  const jobsParams = { customerId: plan?.customerId };
  const { data: allJobs = [] } = useListJobs(
    jobsParams,
    {
      query: {
        enabled: isValidRouteId && plan?.customerId != null,
        queryKey: authScopedQueryKey(user, getListJobsQueryKey(jobsParams)),
      },
    },
  );
  const canMutate = isValidRouteId && plan != null;

  // Filter to jobs for this customer that are recurring (rough match by date proximity)
  const generatedJobs = (allJobs as Array<{
    id: number; jobNumber: string; status: string; scheduledDate?: string | null;
    totalAmount: number; customerId: number; isRecurring?: boolean;
  }>).filter((j) => j.customerId === plan?.customerId && j.isRecurring);

  const updateMutation = useUpdateRecurringPlan({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRecurringPlanQueryKey(planId) });
        queryClient.invalidateQueries({ queryKey: getListRecurringPlansQueryKey() });
        toast({ title: "Plan updated" });
        setEditing(false);
      },
      onError: () => toast({ title: "Failed to update plan", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteRecurringPlan({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRecurringPlansQueryKey() });
        navigate("/recurring-plans");
        toast({ title: "Plan deleted" });
      },
      onError: () => toast({ title: "Failed to delete plan", variant: "destructive" }),
    },
  });

  const generateMutation = useGenerateRecurringJob({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetRecurringPlanQueryKey(planId) });
        queryClient.invalidateQueries({ queryKey: getListRecurringPlansQueryKey() });
        // Ensure the jobs list and customer activity log are fresh
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        if (plan?.customerId) {
          queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(plan.customerId) });
        }
        toast({
          title: "Job generated!",
          description: result.message,
        });
        navigate(`/jobs/${(result.job as { id: number }).id}`);
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? "Failed to generate job";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  const startEdit = () => {
    if (!canMutate) return;
    setEditForm({
      name: plan.name,
      propertyId: plan.propertyId ?? "",
      status: plan.status,
      frequencyType: plan.frequencyType,
      preferredDayOfWeek: plan.preferredDayOfWeek ?? "",
      preferredTimeWindow: plan.preferredTimeWindow ?? "",
      nextRunDate: plan.nextRunDate ?? "",
      serviceType: plan.serviceType ?? "",
      estimatedAmount: plan.estimatedAmount ?? "",
      defaultDurationMinutes: plan.defaultDurationMinutes ?? "",
      defaultServiceNotes: plan.defaultServiceNotes ?? "",
    });
    setEditPropertyId(plan.propertyId ?? "");
    setEditing(true);
  };

  const saveEdit = () => {
    if (!canMutate) return;
    updateMutation.mutate({
      id: planId,
      data: {
        customerId: plan.customerId,
        propertyId: editPropertyId === "" ? null : Number(editPropertyId),
        name: String(editForm.name),
        status: String(editForm.status),
        frequencyType: String(editForm.frequencyType),
        preferredDayOfWeek: String(editForm.preferredDayOfWeek) || undefined,
        preferredTimeWindow: String(editForm.preferredTimeWindow) || undefined,
        nextRunDate: String(editForm.nextRunDate) || undefined,
        serviceType: String(editForm.serviceType) || undefined,
        estimatedAmount: editForm.estimatedAmount ? String(editForm.estimatedAmount) : undefined,
        defaultDurationMinutes: editForm.defaultDurationMinutes ? Number(editForm.defaultDurationMinutes) : undefined,
        defaultServiceNotes: String(editForm.defaultServiceNotes) || undefined,
      },
    });
  };

  const toggleAutoGenerate = () => {
    if (!canMutate) return;
    updateMutation.mutate({
      id: planId,
      data: { autoGenerateJobs: !plan.autoGenerateJobs } as Parameters<typeof updateMutation.mutate>[0]["data"],
    });
  };

  const generateNextJob = () => {
    if (!canMutate) return;
    generateMutation.mutate({ id: planId });
  };

  const deletePlan = () => {
    if (!canMutate) return;
    if (confirm("Delete this recurring plan?")) deleteMutation.mutate({ id: planId });
  };

  if (!isValidRouteId) {
    return <RecurringPlanUnavailable kind="invalid" onBack={() => navigate("/recurring-plans")} />;
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!plan) {
    return <RecurringPlanUnavailable kind="missing" onBack={() => navigate("/recurring-plans")} />;
  }

  const cfg = STATUS_CFG[plan.status] ?? STATUS_CFG.active;
  const isActive = plan.status === "active";
  const nextRunOverdue = plan.nextRunDate ? (isPast(parseISO(plan.nextRunDate)) && !isToday(parseISO(plan.nextRunDate))) : false;
  const enrichedPlan = plan as typeof plan & { customerName?: string | null; propertyAddress?: string | null; propertyName?: string | null };

  const ef = (key: string) => String(editForm[key] ?? "");

  return (
    <Layout>
      <div className="pb-28 sm:pb-0">

        {/* Header */}
        <div className="flex items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={goBack} className="rounded-xl h-9 w-9 mt-0.5">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-display font-bold text-slate-900">{plan.name}</h1>
                <Badge variant="outline" className={`border-none text-sm ${cfg.bg} ${cfg.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${cfg.dot}`} />
                  {cfg.label}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm mt-0.5">
                {FREQ_LABEL[plan.frequencyType] ?? plan.frequencyType} · Created {plan.createdAt ? format(new Date(plan.createdAt), "MMM d, yyyy") : "—"}
              </p>
            </div>
          </div>

          {/* Desktop actions */}
          <div className="hidden sm:flex items-center gap-2">
            {!editing ? (
              <>
                {/* Auto-generate toggle */}
                <button
                  title={plan.autoGenerateJobs ? "Auto-generate ON — click to disable" : "Auto-generate OFF — click to enable"}
                   onClick={toggleAutoGenerate}
                  className={`flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs font-semibold transition-all ${
                    plan.autoGenerateJobs
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                      : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <Zap className={`w-3 h-3 ${plan.autoGenerateJobs ? "text-emerald-500" : "text-slate-400"}`} />
                  Auto-gen {plan.autoGenerateJobs ? "ON" : "OFF"}
                </button>
                {isActive && (
                  <Button
                    className="rounded-xl shadow-md shadow-primary/20 gap-2"
                     onClick={generateNextJob}
                    disabled={generateMutation.isPending}
                  >
                    <Zap className="w-4 h-4" />
                    {generateMutation.isPending ? "Generating…" : "Generate Next Job"}
                  </Button>
                )}
                <Button variant="outline" size="sm" className="rounded-xl" onClick={startEdit}>
                  <Pencil className="w-4 h-4 mr-1" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-red-200 text-red-600 hover:bg-red-50"
                   onClick={deletePlan}
                >
                  Delete
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="rounded-xl shadow-md shadow-primary/20"
                  onClick={saveEdit}
                  disabled={updateMutation.isPending}
                >
                  <Save className="w-4 h-4 mr-1" />
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setEditing(false)}>
                  <X className="w-4 h-4 mr-1" /> Cancel
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">

          {/* ─── Main column ─────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-5">

            {/* Plan info */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sm:p-6">
              <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary" />
                Plan Configuration
              </h2>

              {editing ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Plan Name</Label>
                    <Input value={ef("name")} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="rounded-xl" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={ef("status")} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="paused">Paused</SelectItem>
                          <SelectItem value="canceled">Canceled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Frequency</Label>
                      <Select value={ef("frequencyType")} onValueChange={(v) => setEditForm({ ...editForm, frequencyType: v })}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FREQ_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <PropertyPicker
                    customerId={plan.customerId}
                    value={editPropertyId}
                    onChange={setEditPropertyId}
                    allowNone
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Preferred Day</Label>
                      <Select value={ef("preferredDayOfWeek") || "any"} onValueChange={(v) => setEditForm({ ...editForm, preferredDayOfWeek: v === "any" ? "" : v })}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Any" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">No preference</SelectItem>
                          {DAYS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Next Run Date</Label>
                      <Input type="date" value={ef("nextRunDate")} onChange={(e) => setEditForm({ ...editForm, nextRunDate: e.target.value })} className="rounded-xl" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Service Type</Label>
                      <Select value={ef("serviceType") || "none"} onValueChange={(v) => setEditForm({ ...editForm, serviceType: v === "none" ? "" : v })}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {SERVICE_TYPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Estimated Amount ($)</Label>
                      <Input type="number" min="0" step="0.01" value={ef("estimatedAmount")} onChange={(e) => setEditForm({ ...editForm, estimatedAmount: e.target.value })} className="rounded-xl" placeholder="0.00" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Default Job Notes</Label>
                    <Textarea value={ef("defaultServiceNotes")} onChange={(e) => setEditForm({ ...editForm, defaultServiceNotes: e.target.value })} className="rounded-xl resize-none" rows={3} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-5 gap-x-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Frequency</p>
                    <p className="text-slate-900 font-semibold">{FREQ_LABEL[plan.frequencyType] ?? plan.frequencyType}</p>
                  </div>
                  {plan.preferredDayOfWeek && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Preferred Day</p>
                      <p className="text-slate-700">{plan.preferredDayOfWeek}</p>
                    </div>
                  )}
                  {plan.preferredTimeWindow && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Preferred Start Time</p>
                      <p className="text-slate-700">{plan.preferredTimeWindow}</p>
                    </div>
                  )}
                  {plan.serviceType && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Service Type</p>
                      <p className="text-slate-700 capitalize">{plan.serviceType.replace("_", " ")}</p>
                    </div>
                  )}
                  {plan.estimatedAmount && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Estimated Per Job</p>
                      <p className="text-slate-900 font-bold text-lg">{formatCurrency(Number(plan.estimatedAmount))}</p>
                    </div>
                  )}
                  {plan.defaultDurationMinutes && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Est. Duration</p>
                      <p className="text-slate-700">{plan.defaultDurationMinutes} min</p>
                    </div>
                  )}
                  {plan.defaultServiceNotes && (
                    <div className="sm:col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Default Notes</p>
                      <p className="text-slate-700 text-sm whitespace-pre-line">{plan.defaultServiceNotes}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Auto-Generate Jobs</p>
                    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${plan.autoGenerateJobs ? "text-emerald-700" : "text-slate-400"}`}>
                      <Zap className="w-3.5 h-3.5" />
                      {plan.autoGenerateJobs ? "Enabled — scheduler creates jobs automatically" : "Disabled — use 'Generate Next Job' manually"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Mobile edit/delete */}
            {!editing && (
              <div className="sm:hidden flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 rounded-xl" onClick={startEdit}>
                  <Pencil className="w-4 h-4 mr-1" /> Edit Plan
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-red-200 text-red-600"
                   onClick={deletePlan}
                >
                  Delete
                </Button>
              </div>
            )}
            {editing && (
              <div className="sm:hidden flex gap-2">
                <Button className="flex-1 rounded-xl" onClick={saveEdit} disabled={updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-1" />
                  {updateMutation.isPending ? "Saving…" : "Save"}
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            )}

            {/* Generated jobs */}
            {generatedJobs.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sm:p-6">
                <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-primary" />
                  Generated Jobs
                  <span className="ml-auto text-xs text-slate-400 font-normal">{generatedJobs.length} jobs</span>
                </h2>
                <div className="space-y-2">
                  {generatedJobs.slice(0, 10).map((job) => {
                    const jcfg = JOB_STATUS_CFG[job.status] ?? JOB_STATUS_CFG.scheduled;
                    return (
                      <div
                        key={job.id}
                        onClick={() => navigate(`/jobs/${job.id}`)}
                        className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className={`border-none text-xs ${jcfg.bg} ${jcfg.color}`}>
                            {jcfg.label}
                          </Badge>
                          <div>
                            <p className="font-mono text-sm text-slate-700">{job.jobNumber}</p>
                            {job.scheduledDate && (
                              <p className="text-xs text-slate-400">{fmtDate(job.scheduledDate)}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900">{formatCurrency(job.totalAmount)}</span>
                          <ChevronRight className="w-4 h-4 text-slate-300" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ─── Sidebar ─────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Next run */}
            <div className={`rounded-2xl p-5 border ${nextRunOverdue ? "bg-red-50 border-red-100" : isActive ? "bg-primary text-white" : "bg-white border-slate-100"}`}>
              <p className={`text-sm font-medium mb-1 ${nextRunOverdue ? "text-red-600" : isActive ? "text-primary-foreground/70" : "text-slate-400"}`}>
                Next Run Date
              </p>
              <p className={`text-2xl font-bold ${nextRunOverdue ? "text-red-700" : isActive ? "text-white" : "text-slate-900"}`}>
                {plan.nextRunDate ? format(parseISO(plan.nextRunDate), "MMM d") : "Not set"}
              </p>
              {plan.nextRunDate && (
                <p className={`text-sm ${nextRunOverdue ? "text-red-600" : isActive ? "text-primary-foreground/60" : "text-slate-500"}`}>
                  {nextRunOverdue ? "⚠ Overdue — " : ""}{format(parseISO(plan.nextRunDate), "EEEE, yyyy")}
                </p>
              )}
              {plan.lastGeneratedDate && (
                <p className={`text-xs mt-2 ${isActive ? "text-primary-foreground/50" : "text-slate-400"}`}>
                  Last generated {fmtDate(plan.lastGeneratedDate)}
                </p>
              )}
            </div>

            {/* Customer */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2">
                <User className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Customer</h2>
              </div>
              <p className="font-semibold text-slate-900">{enrichedPlan.customerName ?? `Customer #${plan.customerId}`}</p>
              <Button variant="link" className="p-0 h-auto text-xs text-primary mt-1" onClick={() => navigate(`/customers/${plan.customerId}`)}>
                View customer →
              </Button>
            </div>

            {/* Property */}
            {plan.propertyId && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="w-4 h-4 text-slate-400" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Property</h2>
                </div>
                {enrichedPlan.propertyName && (
                  <p className="font-semibold text-slate-900">{enrichedPlan.propertyName}</p>
                )}
                {enrichedPlan.propertyAddress && (
                  <p className="text-sm text-slate-600">{enrichedPlan.propertyAddress}</p>
                )}
              </div>
            )}

            {/* Timeline */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">Timeline</h2>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>Created</span>
                  <span>{plan.createdAt ? format(new Date(plan.createdAt), "MMM d, yyyy") : "—"}</span>
                </div>
                {plan.lastGeneratedDate && (
                  <div className="flex justify-between text-slate-500">
                    <span>Last job generated</span>
                    <span>{fmtDate(plan.lastGeneratedDate)}</span>
                  </div>
                )}
                <div className={`flex justify-between font-medium ${nextRunOverdue ? "text-red-600" : "text-slate-700"}`}>
                  <span>Next run</span>
                  <span>{fmtDate(plan.nextRunDate)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky action bar */}
      {!editing && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-t border-slate-200 p-3">
          {isActive ? (
            <Button
              className="w-full h-12 rounded-xl text-base font-semibold shadow-md shadow-primary/20 gap-2"
                   onClick={generateNextJob}
              disabled={generateMutation.isPending}
            >
              <Zap className="w-5 h-5" />
              {generateMutation.isPending ? "Generating Job…" : "Generate Next Job"}
            </Button>
          ) : (
            <div className="flex items-center justify-center gap-2 py-2">
              {plan.status === "paused" ? <PauseCircle className="w-5 h-5 text-amber-500" /> : <XCircle className="w-5 h-5 text-red-400" />}
              <span className="text-sm text-slate-500">Plan is {plan.status} — activate to generate jobs</span>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
