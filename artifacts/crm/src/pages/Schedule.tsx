import { useState, useMemo } from "react";
import { Layout } from "@/components/Layout";
import {
  ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin,
  ExternalLink, Calendar, AlertCircle, CheckCircle2,
  Plus, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  useListJobs,
  useListUnscheduledJobs,
  useUpdateJob,
  getListJobsQueryKey,
  getListUnscheduledJobsQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";
import { hasClientCapability } from "@/lib/rbac";
import { getScheduleEmptyStateCopy } from "@/lib/schedule-empty-state";
import { MonthCalendar } from "@/components/MonthCalendar";
import { DEFAULT_WEEK_START, shiftMonth } from "@/lib/calendar-grid";
import {
  startOfWeek, endOfWeek, addWeeks, subWeeks,
  format, eachDayOfInterval, isToday, parseISO,
} from "date-fns";

// ─── API helper ───────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
async function apiFetch<T>(path: string): Promise<T> {
  const res = await protectedFetch(`${BASE}/api${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobLike {
  id: number;
  jobNumber: string;
  status: string;
  customerId: number;
  propertyId?: number | null;
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  totalAmount: number;
  notes?: string | null;
  customerName?: string;
  propertyAddress?: string | null;
  propertyName?: string | null;
  assignedEmployeeNames?: string[];
  crewName?: string | null;
}
interface EstimateAppointment {
  id: number; quoteId: number; startsAt: string; durationMinutes: number;
  quoteNumber: string; customerName: string; employeeName?: string | null;
}

/** Accept the list response and the documented paginated { data } response.
 * An unexpected payload is an empty display state, never a render exception. */
export function normalizeScheduleList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }
  return [];
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  scheduled:   { label: "Scheduled",   bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-400" },
  in_progress: { label: "In Progress", bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-400" },
  completed:   { label: "Completed",   bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-400" },
  canceled:    { label: "Canceled",    bg: "bg-slate-100",  text: "text-slate-500",   dot: "bg-slate-400" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(t?: string | null) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${ampm}`;
}

function customerLabel(job: JobLike) {
  return job.customerName ?? `Customer #${job.customerId}`;
}

function propertyLabel(job: JobLike) {
  return job.propertyName || job.propertyAddress || (job.propertyId ? `Property #${job.propertyId}` : null);
}

// ─── RescheduleModal ─────────────────────────────────────────────────────────

function RescheduleModal({ job, onClose }: { job: JobLike | null; onClose: () => void }) {
  const [date, setDate]           = useState(job?.scheduledDate ?? "");
  const [startTime, setStartTime] = useState(job?.scheduledStartTime ?? "");
  const [endTime, setEndTime]     = useState(job?.scheduledEndTime ?? "");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const updateMutation = useUpdateJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListUnscheduledJobsQueryKey() });
        toast({ title: "Job rescheduled!" });
        onClose();
      },
      // A refusal to move finished or billed work is a rule, not a fault, and
      // it carries the way forward ("reopen the job first"). Showing only
      // "Failed to reschedule" would strand the user at a dead end.
      onError: (err: unknown) => {
        const detail = (err as { data?: { error?: string } } | null)?.data?.error;
        toast({
          title: "Failed to reschedule job",
          ...(detail ? { description: detail } : {}),
          variant: "destructive",
        });
      },
    },
  });

  if (!job) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Calendar className="w-4 h-4 text-primary" />
            Reschedule Job
          </DialogTitle>
        </DialogHeader>

        <div className="bg-slate-50 rounded-xl p-3 mb-1">
          <p className="font-bold text-slate-900 text-sm">{customerLabel(job)}</p>
          {propertyLabel(job) && <p className="text-xs text-slate-500 mt-0.5">{propertyLabel(job)}</p>}
          <span className="font-mono text-xs text-slate-400">{job.jobNumber}</span>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Date <span className="text-red-500">*</span></Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="rounded-xl" />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-1 gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => updateMutation.mutate({ id: job.id, data: { scheduledDate: date || undefined, scheduledStartTime: startTime || undefined, scheduledEndTime: endTime || undefined } })}
            disabled={!date || updateMutation.isPending}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {updateMutation.isPending ? "Saving…" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── UnscheduledCard ─────────────────────────────────────────────────────────

function UnscheduledCard({ job, onSchedule, canManageSchedule }: {
  job: JobLike; onSchedule: (job: JobLike) => void; canManageSchedule: boolean;
}) {
  const [, navigate] = useLocation();
  const cfg = STATUS_CFG[job.status] ?? STATUS_CFG.scheduled;
  const loc = propertyLabel(job);

  return (
    <div className="bg-white rounded-xl border border-amber-200 p-3 flex items-start gap-3 hover:border-amber-300 hover:shadow-sm transition-all">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${cfg.bg} ${cfg.text}`}>
            {cfg.label}
          </span>
        </div>
        <p className="font-bold text-slate-900 text-sm leading-snug truncate">{customerLabel(job)}</p>
        {loc && (
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
            <p className="text-xs text-slate-500 truncate">{loc}</p>
          </div>
        )}
        {!!job.assignedEmployeeNames?.length && (
          <p className="text-[10px] text-slate-400 truncate mb-2">{job.assignedEmployeeNames.join(", ")}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        {canManageSchedule && <button
          onClick={() => onSchedule(job)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 active:scale-[.97]
                     text-white text-[11px] font-bold transition-all"
        >
          <Calendar className="w-3 h-3" />
          Schedule
        </button>}
        <button
          onClick={() => navigate(`/jobs/${job.id}`)}
          className="flex items-center justify-center h-7 w-full rounded-lg border border-slate-200
                     text-slate-400 hover:text-primary hover:border-primary/30 transition-colors"
          title="View job"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── ScheduleJobCard ─────────────────────────────────────────────────────────

function ScheduleJobCard({ job, onReschedule, canManageSchedule }: {
  job: JobLike; onReschedule: (job: JobLike) => void; canManageSchedule: boolean;
}) {
  const [, navigate] = useLocation();
  const cfg   = STATUS_CFG[job.status] ?? STATUS_CFG.scheduled;
  const loc   = propertyLabel(job);
  const startT = fmtTime(job.scheduledStartTime);
  const endT   = fmtTime(job.scheduledEndTime);
  const isDone = job.status === "completed";
  const isCanceled = job.status === "canceled";
  // Matches the server's completed rule. Invoiced work is also locked there,
  // but the card carries no invoice, so that refusal surfaces on save.
  const scheduleLocked = isDone;

  return (
    <div
      className={`group relative bg-white rounded-xl border border-l-4 transition-all
        ${isDone    ? "border-emerald-200 border-l-emerald-300 opacity-60" : ""}
        ${isCanceled ? "border-slate-200 border-l-slate-300 opacity-50 grayscale" : ""}
        ${!isDone && !isCanceled ? "border-slate-200 border-l-blue-400 hover:border-slate-300 hover:shadow-sm" : ""}
        ${job.status === "in_progress" ? "border-amber-200 border-l-amber-400" : ""}
        ${job.status === "scheduled"   ? "border-slate-200 border-l-blue-400"  : ""}
      `}
    >
      <div className="p-3">
        {/* Status badge */}
        <div className="mb-1">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${cfg.bg} ${cfg.text}`}>
            {cfg.label}
          </span>
        </div>
        {/* Time — own line so it never wraps out of the card */}
        {startT && (
          <div className="flex items-center gap-0.5 text-[10px] text-slate-500 font-medium mb-1.5">
            <Clock className="w-2.5 h-2.5 shrink-0" />
            <span>{startT}{endT ? `–${endT}` : ""}</span>
          </div>
        )}

        {/* Customer name */}
        <p className="font-bold text-slate-900 text-sm leading-snug truncate">{customerLabel(job)}</p>

        {/* Property */}
        {loc && (
          <div className="flex items-center gap-1 mt-0.5 mb-2">
            <MapPin className="w-2.5 h-2.5 text-slate-400 shrink-0" />
            <p className="text-[11px] text-slate-500 truncate">{loc}</p>
          </div>
        )}
        {/*
          The length comparison is load-bearing: `[].length` is 0, and React
          renders a literal 0 rather than nothing, so an unassigned job printed
          a stray "0" on the card. Guard on a boolean, never on a count.
        */}
        {(job.crewName || (job.assignedEmployeeNames?.length ?? 0) > 0) && (
          <p className="text-[10px] text-slate-400 truncate mb-2">
            {[job.crewName, ...(job.assignedEmployeeNames ?? [])].filter(Boolean).join(" · ")}
          </p>
        )}

        {/* Action buttons — always visible */}
        <div className="flex gap-1.5 mt-2 pt-2 border-t border-slate-100">
          <button
            onClick={() => navigate(`/jobs/${job.id}`)}
            className="flex-1 flex items-center justify-center gap-1 h-7 rounded-lg
                       border border-slate-200 text-slate-500 hover:text-primary hover:border-primary/30
                       text-[10px] font-semibold transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </button>
          {/*
            The server refuses to move completed or invoiced work; this only
            keeps the button from walking the user into that refusal. It is not
            the protection itself, and the card cannot see invoices, so a moved
            invoice still comes back as a 409 the dialog reports.
          */}
          {canManageSchedule && <button
            onClick={() => onReschedule(job)}
            disabled={scheduleLocked}
            title={scheduleLocked ? "Completed jobs cannot be rescheduled. Reopen the job first." : undefined}
            className="flex-1 flex items-center justify-center gap-1 h-7 rounded-lg
                       border border-slate-200 text-slate-500 hover:text-amber-600 hover:border-amber-200
                       text-[10px] font-semibold transition-colors
                       disabled:opacity-40 disabled:hover:text-slate-500 disabled:hover:border-slate-200
                       disabled:cursor-not-allowed"
          >
            <Calendar className="w-3 h-3" />
            Move
          </button>}
        </div>
      </div>
    </div>
  );
}

// ─── DayRow (mobile) / DayColumn (desktop) — unified component ───────────────

function DaySection({
  day,
  jobs,
  onReschedule,
  canManageSchedule,
}: {
  day: Date;
  jobs: JobLike[];
  onReschedule: (job: JobLike) => void;
  canManageSchedule: boolean;
}) {
  const isCurrentDay  = isToday(day);
  const dayName       = format(day, "EEE");
  const dayDate       = format(day, "d");
  const monthAbbr     = format(day, "MMM");
  // Canceled work stays in history but is not scheduled work: it must not be
  // counted or drawn on the grid. Once a Canceled filter exists it can opt back
  // in; until then the day shows only what the crew is actually expected to do.
  const activeJobs    = jobs.filter((j) => j.status !== "canceled");

  return (
    <div className={`flex flex-col ${isCurrentDay ? "ring-2 ring-primary/25 rounded-2xl" : ""}`}>
      {/* Day header */}
      <div
        className={`px-3 py-2.5 rounded-t-2xl flex lg:flex-col items-center lg:justify-center gap-2 lg:gap-0 lg:text-center
          ${isCurrentDay ? "bg-primary text-white" : "bg-slate-100 text-slate-700"}`}
      >
        <div className="flex lg:flex-col items-center gap-1 lg:gap-0">
          <p className={`text-xs font-bold uppercase tracking-wider ${isCurrentDay ? "text-white/70" : "text-slate-400"}`}>
            {dayName}
          </p>
          <p className={`text-2xl font-bold leading-none ${isCurrentDay ? "text-white" : "text-slate-900"}`}>
            {dayDate}
          </p>
          <p className={`text-xs ${isCurrentDay ? "text-white/60" : "text-slate-400"}`}>
            {monthAbbr}
          </p>
        </div>
        <span className={`ml-auto lg:ml-0 lg:mt-1.5 text-xs rounded-full px-2 py-0.5 font-bold
          ${isCurrentDay
            ? activeJobs.length > 0 ? "bg-white/25 text-white" : "bg-white/10 text-white/50"
            : activeJobs.length > 0 ? "bg-white text-slate-700 shadow-sm" : "bg-slate-200/60 text-slate-400"
          }`}
        >
          {activeJobs.length} {activeJobs.length === 1 ? "job" : "jobs"}
        </span>
        {isCurrentDay && (
          <span className="lg:hidden text-white/70 text-xs font-semibold ml-1">· Today</span>
        )}
      </div>

      {/* Jobs container */}
      <div
        className={`flex-1 p-2 space-y-2 rounded-b-2xl border border-t-0 min-h-[72px]
          ${isCurrentDay ? "border-primary/20 bg-primary/[.03]" : "border-slate-200 bg-slate-50/60"}`}
      >
        {activeJobs.length === 0 ? (
          <div className="flex items-center justify-center h-full py-5">
            <p className="text-[11px] text-slate-300 font-medium">No jobs</p>
          </div>
        ) : (
          <>
            {activeJobs.map((job) => (
              <ScheduleJobCard key={job.id} job={job} onReschedule={onReschedule} canManageSchedule={canManageSchedule} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ScheduleSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-7 gap-2 animate-pulse">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden">
          <div className="h-20 bg-slate-200 rounded-t-2xl" />
          <div className="bg-slate-100 p-2 space-y-2 rounded-b-2xl min-h-[80px]">
            <div className="h-16 bg-slate-200 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Schedule page ───────────────────────────────────────────────────────

interface DuePlan {
  id: number;
  name: string;
  customerId: number;
  customerName: string;
  serviceType?: string | null;
  nextRunDate?: string | null;
  frequencyType: string;
  dueStatus: "overdue" | "due_today" | "due_soon";
  daysUntilDue: number;
}

export default function Schedule() {
  const [weekOffset,    setWeekOffset]    = useState(0);
  const [rescheduleJob, setRescheduleJob] = useState<JobLike | null>(null);
  const [showDue,       setShowDue]       = useState(true);
  const [view,          setView]          = useState<"week" | "month">("week");
  // Month view tracks its own position: paging months through a week offset
  // would make "next" mean different distances in the two views.
  const [monthCursor,   setMonthCursor]   = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const canManageSchedule = hasClientCapability(user, "schedule.manage");
  const canViewScheduleJobs =
    hasClientCapability(user, "schedule.view") || hasClientCapability(user, "jobs.view");
  const canViewDuePlans = hasClientCapability(user, "recurring_plans.view");
  const canViewEstimates = hasClientCapability(user, "quotes.view");
  const emptyStateCopy = getScheduleEmptyStateCopy(user);

  // Due-for-service
  const { data: dueData, refetch: refetchDue } = useQuery({
    queryKey: authScopedQueryKey(user, ["due-for-service"]),
    queryFn:  () => apiFetch<{ plans: DuePlan[]; total: number }>("/recurring-plans/due?days=30"),
    staleTime: 60000,
    enabled: canViewDuePlans,
  });
  const duePlans = normalizeScheduleList<DuePlan>(dueData?.plans);
  const dueCount = duePlans.length;

  // Week bounds
  const today         = new Date();
  const baseWeekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekStart     = weekOffset === 0
    ? baseWeekStart
    : weekOffset > 0
      ? addWeeks(baseWeekStart, weekOffset)
      : subWeeks(baseWeekStart, Math.abs(weekOffset));
  const weekEnd  = endOfWeek(weekStart, { weekStartsOn: 1 });
  const startStr = format(weekStart, "yyyy-MM-dd");
  const endStr   = format(weekEnd,   "yyyy-MM-dd");

  // Week label formats
  const weekLabelShort = format(weekStart, "MMM d") + " – " + format(weekEnd, "MMM d");
  const weekLabelFull  = format(weekStart, "MMM d") + " – " + format(weekEnd, "MMM d, yyyy");

  // Data
  const weekParams = { start: startStr, end: endStr };
  const { data: weekJobs, isLoading: loadingWeek } = useListJobs(weekParams, {
    query: {
      queryKey: authScopedQueryKey(user, getListJobsQueryKey(weekParams)),
      enabled: canViewScheduleJobs,
      select: normalizeScheduleList<JobLike>,
    },
  });
  const { data: unscheduledJobs, isLoading: loadingUnscheduled } = useListUnscheduledJobs({
    query: {
      queryKey: authScopedQueryKey(user, getListUnscheduledJobsQueryKey()),
      enabled: canViewScheduleJobs,
      select: normalizeScheduleList<JobLike>,
    },
  });
  const { data: estimateAppointments = [] } = useQuery({
    queryKey: authScopedQueryKey(user, ["estimate-calendar", startStr, endStr]),
    queryFn: () => apiFetch<EstimateAppointment[]>(`/estimate-calendar?from=${encodeURIComponent(`${startStr}T00:00:00`)}&to=${encodeURIComponent(`${endStr}T23:59:59`)}`),
    enabled: canViewEstimates,
    select: normalizeScheduleList<EstimateAppointment>,
  });

  // Group by day
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const jobsByDay = useMemo(() => {
    const map = new Map<string, JobLike[]>();
    days.forEach((d) => map.set(format(d, "yyyy-MM-dd"), []));
    normalizeScheduleList<JobLike>(weekJobs).forEach((job) => {
      const key = job.scheduledDate ?? "";
      if (map.has(key)) map.get(key)!.push(job as JobLike);
    });
    return map;
  }, [weekJobs, days]);

  const normalizedWeekJobs = normalizeScheduleList<JobLike>(weekJobs);
  const normalizedUnscheduledJobs = normalizeScheduleList<JobLike>(unscheduledJobs);
  // Counted the same way the day cells count, so the header and the grid can
  // never disagree: canceled work is history, not scheduled work.
  const activeWeekJobs   = normalizedWeekJobs.filter((j) => j.status !== "canceled");
  const totalWeekJobs    = activeWeekJobs.length;
  const completedCount   = activeWeekJobs.filter((j) => j.status === "completed").length;
  const unscheduledCount = normalizedUnscheduledJobs.length;
  const isCurrentWeek    = weekOffset === 0;

  const isMonthView    = view === "month";
  const monthLabel     = format(new Date(monthCursor.year, monthCursor.month, 1), "MMMM yyyy");
  const isCurrentMonth = monthCursor.year === today.getFullYear()
    && monthCursor.month === today.getMonth();

  return (
    <Layout>

      {/* ══════════════════════════════════════════════════════════════
           STICKY CONTROL BAR
      ══════════════════════════════════════════════════════════════ */}
      <div className="sticky top-14 z-10 bg-slate-50 -mx-4 px-4 md:-mx-8 md:px-8 pb-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">

          {/* Left: title + period nav */}
          <div className="flex items-center gap-3 flex-1">
            <h1 className="text-lg font-bold text-slate-900 hidden sm:block">Schedule</h1>

            {/* Week / Month toggle */}
            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-0.5">
              {(["week", "month"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setView(option)}
                  aria-pressed={view === option}
                  className={`h-8 px-3 rounded-lg text-xs font-bold capitalize transition-colors
                    ${view === option ? "bg-primary text-white" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {option}
                </button>
              ))}
            </div>

            {/* Period navigation — one step means one week or one month,
                whichever the grid is showing. */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => isMonthView
                  ? setMonthCursor((c) => shiftMonth(c.year, c.month, -1))
                  : setWeekOffset((o) => o - 1)}
                aria-label={isMonthView ? "Previous month" : "Previous week"}
                className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white
                           text-slate-600 hover:border-slate-300 hover:bg-slate-50 active:scale-[.97] transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1.5 px-3 h-9 rounded-xl bg-white border border-slate-200">
                <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-sm font-semibold text-slate-800 whitespace-nowrap">
                  {isMonthView ? monthLabel : (
                    <>
                      <span className="hidden sm:inline">{weekLabelFull}</span>
                      <span className="sm:hidden">{weekLabelShort}</span>
                    </>
                  )}
                </span>
              </div>
              <button
                onClick={() => isMonthView
                  ? setMonthCursor((c) => shiftMonth(c.year, c.month, 1))
                  : setWeekOffset((o) => o + 1)}
                aria-label={isMonthView ? "Next month" : "Next week"}
                className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white
                           text-slate-600 hover:border-slate-300 hover:bg-slate-50 active:scale-[.97] transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {(isMonthView ? !isCurrentMonth : !isCurrentWeek) && (
                <button
                  onClick={() => isMonthView
                    ? setMonthCursor({ year: today.getFullYear(), month: today.getMonth() })
                    : setWeekOffset(0)}
                  className="h-9 px-3 rounded-xl bg-primary text-white text-xs font-bold
                             hover:bg-primary/90 active:scale-[.97] transition-all"
                >
                  Today
                </button>
              )}
            </div>
          </div>

          {/* Right: New Job + metrics */}
          <div className="flex items-center gap-2 flex-wrap">
            {canManageSchedule && <Button
              size="sm"
              className="rounded-xl shadow-sm shadow-primary/20 h-9 gap-1.5"
              onClick={() => navigate("/jobs/new")}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Job</span>
              <span className="sm:hidden">New</span>
            </Button>}
            {dueCount > 0 && (
              <button
                onClick={() => setShowDue((s) => !s)}
                className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span className="text-xs font-bold">{dueCount} due</span>
                {showDue ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
            {/* Week counts, hidden in month view — the month grid carries its
                own totals, and "0 this week" beside a full month misreads. */}
            {!isMonthView && (
              <div className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-white border border-slate-200">
                <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-semibold text-slate-700">
                  <span className="text-slate-900 font-bold">{totalWeekJobs}</span> this week
                </span>
              </div>
            )}
            {!isMonthView && completedCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-emerald-50 border border-emerald-100">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-xs font-semibold text-emerald-700">
                  {completedCount} done
                </span>
              </div>
            )}
            {unscheduledCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-amber-50 border border-amber-200 animate-pulse-subtle">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-bold text-amber-700">
                  {unscheduledCount} unscheduled
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {estimateAppointments.length > 0 && (
        <section className="mb-4 rounded-2xl border border-sky-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><CalendarDays className="h-4 w-4 text-sky-600" /> Estimate appointments</h2>
            <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">{estimateAppointments.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {estimateAppointments.map((appointment) => (
              <button key={appointment.id} onClick={() => navigate(`/quotes/${appointment.quoteId}`)} className="rounded-xl border border-sky-100 p-3 text-left hover:bg-sky-50">
                <div className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{appointment.customerName}</strong><span className="text-[10px] font-bold uppercase text-sky-700">Estimate</span></div>
                <p className="mt-1 text-xs text-slate-500">{format(new Date(appointment.startsAt), "EEE, MMM d · h:mm a")} · {appointment.durationMinutes} min</p>
                <p className="mt-1 text-xs text-slate-400">{appointment.employeeName || "Unassigned"} · {appointment.quoteNumber}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════
           DUE-FOR-SERVICE PANEL
      ══════════════════════════════════════════════════════════════ */}
      {showDue && dueCount > 0 && (
        <div className="mb-5 bg-rose-50 border border-rose-200 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-2.5 px-4 py-3 border-b border-rose-200">
            <div className="flex items-center gap-2.5">
              <RefreshCw className="w-4 h-4 text-rose-500 shrink-0" />
              <h2 className="font-bold text-rose-800 text-sm">Due for Service</h2>
              <span className="bg-rose-200 text-rose-800 text-xs font-bold px-2 py-0.5 rounded-full">
                {dueCount}
              </span>
              <p className="text-xs text-rose-600 hidden sm:block ml-1">
                Recurring plans due within 30 days — schedule a job to clear them.
              </p>
            </div>
            <button
              onClick={() => setShowDue(false)}
              className="text-xs text-rose-400 hover:text-rose-600 transition-colors"
            >
              Hide
            </button>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {duePlans.map((plan) => {
              const isOverdue  = plan.dueStatus === "overdue";
              const isDueToday = plan.dueStatus === "due_today";
              return (
                <div
                  key={plan.id}
                  className={`bg-white rounded-xl border p-3 flex flex-col gap-2 ${
                    isOverdue ? "border-red-200" : isDueToday ? "border-amber-200" : "border-rose-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 text-sm truncate">{plan.customerName}</p>
                      <p className="text-xs text-slate-500 truncate">{plan.serviceType ?? plan.name}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                      isOverdue  ? "bg-red-100 text-red-700" :
                      isDueToday ? "bg-amber-100 text-amber-700" :
                                   "bg-rose-100 text-rose-700"
                    }`}>
                      {isOverdue  ? `${Math.abs(plan.daysUntilDue)}d overdue` :
                       isDueToday ? "Due today" :
                       `Due in ${plan.daysUntilDue}d`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-slate-400">{plan.nextRunDate}</p>
                     {canManageSchedule && <button
                      onClick={() => navigate(`/jobs/new?customerId=${plan.customerId}&recurringPlanId=${plan.id}&date=${plan.nextRunDate ?? ""}`)}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      Schedule →
                     </button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
           UNSCHEDULED JOBS — HIGH PRIORITY SECTION
      ══════════════════════════════════════════════════════════════ */}
      {!loadingUnscheduled && unscheduledCount > 0 && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          {/* Section header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
            <h2 className="font-bold text-amber-800 text-sm">Needs Scheduling</h2>
            <span className="bg-amber-200 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full">
              {unscheduledCount}
            </span>
            <p className="text-xs text-amber-600 hidden sm:block ml-1">
              These jobs have no date assigned yet.
            </p>
          </div>

          {/* Cards grid */}
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {normalizedUnscheduledJobs.map((job) => (
              <UnscheduledCard
                key={job.id}
                job={job as JobLike}
                onSchedule={setRescheduleJob}
                canManageSchedule={canManageSchedule}
              />
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
           GRID — month or week
      ══════════════════════════════════════════════════════════════ */}
      {isMonthView ? (
        <MonthCalendar
          year={monthCursor.year}
          month={monthCursor.month}
          weekStartsOn={DEFAULT_WEEK_START}
          onOpenJob={(jobId) => navigate(`/jobs/${jobId}`)}
        />
      ) : loadingWeek ? (
        <ScheduleSkeleton />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          {days.map((day) => {
            const key     = format(day, "yyyy-MM-dd");
            const dayJobs = jobsByDay.get(key) ?? [];
            return (
              <DaySection
                key={key}
                day={day}
                jobs={dayJobs}
                onReschedule={setRescheduleJob}
                canManageSchedule={canManageSchedule}
              />
            );
          })}
        </div>
      )}

      {/* ── Empty state — the month grid carries its own ──────────── */}
      {!isMonthView && !loadingWeek && totalWeekJobs === 0 && unscheduledCount === 0 && (
        <div className="mt-6 py-16 text-center bg-white rounded-2xl border border-dashed border-slate-200">
          <CalendarDays className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-600 font-bold mb-1">{emptyStateCopy.title}</p>
          <p className="text-slate-400 text-sm">{emptyStateCopy.description}</p>
        </div>
      )}

      {/* Reschedule modal */}
      {canManageSchedule && rescheduleJob && (
        <RescheduleModal
          job={rescheduleJob}
          onClose={() => setRescheduleJob(null)}
        />
      )}
    </Layout>
  );
}
