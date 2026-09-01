import { useState, useMemo } from "react";
import { Layout } from "@/components/Layout";
import {
  Clock, MapPin, AlertCircle, Sun,
  CalendarRange, List, Plus, CalendarDays,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/utils";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { hasClientCapability } from "@/lib/rbac";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";
import { format, parseISO, isToday, addDays } from "date-fns";

// ─── Types & config ───────────────────────────────────────────────────────────

type ViewFilter   = "today" | "upcoming" | "all";
type StatusFilter = "all" | "scheduled" | "in_progress" | "completed" | "canceled";

const STATUS_CFG: Record<string, {
  label: string;
  badgeBg: string;
  badgeText: string;
  border: string;
  dot: string;
}> = {
  scheduled:   { label: "Scheduled",   badgeBg: "bg-blue-50",    badgeText: "text-blue-700",    border: "border-l-blue-400",    dot: "bg-blue-400" },
  in_progress: { label: "In Progress", badgeBg: "bg-amber-50",   badgeText: "text-amber-700",   border: "border-l-amber-400",   dot: "bg-amber-400" },
  completed:   { label: "Completed",   badgeBg: "bg-emerald-50", badgeText: "text-emerald-700", border: "border-l-emerald-400", dot: "bg-emerald-400" },
  canceled:    { label: "Canceled",    badgeBg: "bg-red-50",     badgeText: "text-red-600",     border: "border-l-red-400",     dot: "bg-red-400" },
};

const VIEW_TABS: Array<{ key: ViewFilter; label: string; icon: React.ElementType }> = [
  { key: "today",    label: "Today",    icon: Sun },
  { key: "upcoming", label: "Upcoming", icon: CalendarRange },
  { key: "all",      label: "All Jobs", icon: List },
];

const STATUS_KEYS: StatusFilter[] = ["all", "scheduled", "in_progress", "completed", "canceled"];
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All", scheduled: "Scheduled", in_progress: "In Progress",
  completed: "Completed", canceled: "Canceled",
};

const PAGE_SIZE = 50;
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ─── Job type ─────────────────────────────────────────────────────────────────

interface Job {
  id: number;
  jobNumber: string;
  status: string;
  customerId: number;
  customerName?: string;
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  totalAmount: number;
  propertyName?: string | null;
  propertyAddress?: string | null;
  isRecurring?: boolean;
}

interface PaginatedJobsResponse {
  data: Job[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().split("T")[0]; }
function dateStr(d: Date) { return d.toISOString().split("T")[0]; }

function useJobsToday(user: Parameters<typeof authScopedQueryKey>[0]) {
  return useQuery<Job[]>({
    queryKey: authScopedQueryKey(user, ["jobs", "today"]),
    queryFn: () =>
      protectedFetch(`${BASE}/api/jobs?view=today`)
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to load jobs (${r.status})`);
          return r.json();
        }),
    staleTime: 30_000,
  });
}

function useJobsUpcoming(user: Parameters<typeof authScopedQueryKey>[0]) {
  const start = todayStr();
  const end   = dateStr(addDays(new Date(), 30));
  return useQuery<Job[]>({
    queryKey: authScopedQueryKey(user, ["jobs", "upcoming", start, end]),
    queryFn: () =>
      protectedFetch(`${BASE}/api/jobs?start=${start}&end=${end}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to load jobs (${r.status})`);
          return r.json();
        }),
    staleTime: 30_000,
  });
}

function useJobsAll(statusFilter: StatusFilter, page: number, user: Parameters<typeof authScopedQueryKey>[0]) {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (statusFilter !== "all") params.set("status", statusFilter);
  return useQuery<PaginatedJobsResponse>({
    queryKey: authScopedQueryKey(user, ["jobs", "all", statusFilter, page]),
    queryFn: () =>
      protectedFetch(`${BASE}/api/jobs?${params}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to load jobs (${r.status})`);
          return r.json();
        }),
    staleTime: 30_000,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(date?: string | null) {
  if (!date) return null;
  try {
    if (isToday(parseISO(date))) return "Today";
    return format(parseISO(date), "EEE, MMM d");
  } catch { return date; }
}

function fmtTime(t?: string | null) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${ampm}`;
}

// ─── JobCard ─────────────────────────────────────────────────────────────────

function JobCard({ job, onClick, showAmount }: { job: Job; onClick: () => void; showAmount: boolean }) {
  const status   = job.status ?? "scheduled";
  const cfg      = STATUS_CFG[status] ?? STATUS_CFG.scheduled;
  const name     = job.customerName ?? `Customer #${job.customerId}`;
  const property = job.propertyName ?? job.propertyAddress ?? null;
  const dateStr_ = fmtDate(job.scheduledDate);
  const startT   = fmtTime(job.scheduledStartTime);
  const endT     = fmtTime(job.scheduledEndTime);
  const amount   = Number(job.totalAmount ?? 0);
  const isToday_ = job.scheduledDate ? isToday(parseISO(job.scheduledDate)) : false;
  const isDone   = status === "completed" || status === "canceled";

  return (
    <div
      onClick={onClick}
      className={`
        group relative bg-white rounded-xl border border-l-4 border-slate-200
        ${cfg.border}
        hover:border-slate-300 hover:shadow-md active:scale-[.99]
        transition-all duration-150 cursor-pointer overflow-hidden
        ${isDone ? "opacity-70" : ""}
      `}
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-semibold ${cfg.badgeBg} ${cfg.badgeText}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
            {isToday_ && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary">
                <Sun className="w-3 h-3" /> Today
              </span>
            )}
            {job.isRecurring && (
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">AUTO</span>
            )}
          </div>
          {showAmount && <span className="text-sm font-bold text-slate-800">{formatCurrency(amount)}</span>}
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-slate-900 text-sm truncate">{name}</p>
            {property && (
              <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5 truncate">
                <MapPin className="w-3 h-3 shrink-0" />{property}
              </p>
            )}
          </div>

          <div className="shrink-0 text-right">
            {dateStr_ && (
              <div className="flex items-center gap-1 text-xs font-semibold text-slate-700 justify-end">
                <CalendarDays className="w-3.5 h-3.5 text-slate-400" />{dateStr_}
              </div>
            )}
            {(startT || endT) && (
              <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5 justify-end">
                <Clock className="w-3 h-3 shrink-0" />
                {startT}{endT ? ` – ${endT}` : ""}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-slate-100">
          <span className="text-[11px] font-mono text-slate-400">{String(job.jobNumber ?? "")}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function JobSkeleton() {
  return (
    <div className="space-y-3 mt-1">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white rounded-xl border border-l-4 border-slate-200 border-l-slate-200 h-[116px] animate-pulse" />
      ))}
    </div>
  );
}

// ─── Today / Upcoming tabs (client-side status filter) ────────────────────────

function BoundedJobList({
  jobs,
  isLoading,
  statusFilter,
  viewFilter,
  onNavigate,
  canSchedule,
  showAmounts,
}: {
  jobs: Job[];
  isLoading: boolean;
  statusFilter: StatusFilter;
  viewFilter: "today" | "upcoming";
  onNavigate: (path: string) => void;
  canSchedule: boolean;
  showAmounts: boolean;
}) {
  const filtered = statusFilter === "all" ? jobs : jobs.filter((j) => j.status === statusFilter);

  if (isLoading) return <JobSkeleton />;

  if (filtered.length === 0) {
    return (
      <div className="mt-2 py-16 flex flex-col items-center justify-center text-center bg-white rounded-xl border border-dashed border-slate-200">
        {viewFilter === "today" ? (
          <>
            <Sun className="w-10 h-10 mb-3 text-slate-200" />
            <h3 className="font-bold text-slate-700 mb-1">No jobs today</h3>
            <p className="text-slate-400 text-sm mb-3">Nothing scheduled for today.</p>
            <div className="flex gap-2">
              <button onClick={() => onNavigate("/schedule")}
                className="text-xs font-semibold text-primary border border-primary/30 hover:bg-primary/5 px-3 py-1.5 rounded-lg transition-colors">
                View Schedule
              </button>
              {canSchedule && <button onClick={() => onNavigate("/jobs/new")}
                className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors">
                Create Job
              </button>}
            </div>
          </>
        ) : (
          <>
            <CalendarRange className="w-10 h-10 mb-3 text-slate-200" />
            <h3 className="font-bold text-slate-700 mb-1">No upcoming jobs</h3>
            <p className="text-slate-400 text-sm mb-3">Nothing scheduled in the next 30 days.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 mt-1">
      {filtered.map((job) => (
        <JobCard key={job.id} job={job} showAmount={showAmounts} onClick={() => onNavigate(`/jobs/${job.id}`)} />
      ))}
    </div>
  );
}

// ─── All Jobs tab (server-side paginated) ─────────────────────────────────────

function AllJobsList({
  statusFilter,
  page,
  onPageChange,
  onNavigate,
  showAmounts,
  user,
}: {
  statusFilter: StatusFilter;
  page: number;
  onPageChange: (p: number) => void;
  onNavigate: (path: string) => void;
  showAmounts: boolean;
  user: Parameters<typeof authScopedQueryKey>[0];
}) {
  const { data, isLoading, isFetching } = useJobsAll(statusFilter, page, user);

  if (isLoading) return <JobSkeleton />;

  const jobs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  if (jobs.length === 0) {
    return (
      <div className="mt-2 py-16 flex flex-col items-center justify-center text-center bg-white rounded-xl border border-dashed border-slate-200">
        <CalendarDays className="w-10 h-10 mb-3 text-slate-200" />
        <h3 className="font-bold text-slate-700 mb-1">No jobs match this filter</h3>
        <p className="text-slate-400 text-sm">Try adjusting your status filter.</p>
      </div>
    );
  }

  return (
    <>
      <div className={`space-y-2.5 mt-1 transition-opacity ${isFetching ? "opacity-60" : "opacity-100"}`}>
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} showAmount={showAmounts} onClick={() => onNavigate(`/jobs/${job.id}`)} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100">
          <p className="text-xs text-slate-400">
            {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()} jobs
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200
                         text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>
            <span className="flex items-center px-3 py-1.5 text-xs text-slate-500">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200
                         text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Jobs() {
  const [viewFilter,   setViewFilter]   = useState<ViewFilter>("today");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [allPage,      setAllPage]      = useState(1);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const canSchedule = hasClientCapability(user, "schedule.manage");
  const showAmounts = hasClientCapability(user, "invoices.view");

  const todayQ    = useJobsToday(user);
  const upcomingQ = useJobsUpcoming(user);

  const todayJobs    = (todayQ.data    ?? []) as Job[];
  const upcomingJobs = (upcomingQ.data ?? []) as Job[];

  const todayCount = todayJobs.length;

  // Status counts for today/upcoming tabs (client-side, bounded set)
  const boundedJobs = viewFilter === "today" ? todayJobs : upcomingJobs;
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: boundedJobs.length };
    for (const j of boundedJobs) {
      const s = j.status ?? "scheduled";
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [boundedJobs]);

  const handleViewChange = (v: ViewFilter) => {
    setViewFilter(v);
    setStatusFilter("all");
    setAllPage(1);
  };

  const handleStatusChange = (s: StatusFilter) => {
    setStatusFilter(s);
    setAllPage(1);
  };

  return (
    <Layout>
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Jobs</h1>
          <p className="text-xs text-slate-400 mt-0.5">Field operations and daily work</p>
        </div>
        {canSchedule && <button
          onClick={() => navigate("/jobs/new")}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 active:scale-[.98]
                     text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-sm
                     shadow-primary/20 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Create Job</span>
          <span className="sm:hidden">New</span>
        </button>}
      </div>

      {/* ── Sticky filter wrapper ────────────────────────────── */}
      <div className="sticky top-14 z-10 bg-slate-50 pb-3 -mx-4 px-4 md:-mx-8 md:px-8">

        {/* View tabs */}
        <div className="flex gap-1.5 mb-2.5">
          {VIEW_TABS.map(({ key, label, icon: Icon }) => {
            const isActive = viewFilter === key;
            const count = key === "today" ? todayCount : undefined;
            return (
              <button
                key={key}
                onClick={() => handleViewChange(key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold
                            transition-all shrink-0
                            ${isActive
                              ? "bg-primary text-white shadow-sm shadow-primary/25"
                              : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"
                            }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
                {count !== undefined && count > 0 && (
                  <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none
                    ${isActive ? "bg-white/25 text-white" : "bg-primary/10 text-primary"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Status filter pills — only for today/upcoming (counts are client-side) */}
        {viewFilter !== "all" && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {STATUS_KEYS.map((key) => {
              const isActive = statusFilter === key;
              const count = statusCounts[key] ?? 0;
              return (
                <button
                  key={key}
                  onClick={() => handleStatusChange(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                              shrink-0 transition-all
                              ${isActive
                                ? "bg-slate-800 text-white"
                                : "bg-white border border-slate-200 text-slate-500 hover:border-slate-300"
                              }`}
                >
                  {STATUS_LABELS[key]}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none
                    ${isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Status filter pills for "all" — server-side, resets page */}
        {viewFilter === "all" && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {STATUS_KEYS.map((key) => {
              const isActive = statusFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => handleStatusChange(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                              shrink-0 transition-all
                              ${isActive
                                ? "bg-slate-800 text-white"
                                : "bg-white border border-slate-200 text-slate-500 hover:border-slate-300"
                              }`}
                >
                  {STATUS_LABELS[key]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Unscheduled warning (today/upcoming only, defer count to today data) ── */}
      {viewFilter === "today" && !todayQ.isLoading && (
        (() => {
          const unscheduled = todayJobs.filter((j) => !j.scheduledDate && j.status !== "completed" && j.status !== "canceled").length;
          return unscheduled > 0 ? (
            <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                <p className="text-sm font-medium text-amber-800">
                  <strong>{unscheduled}</strong> unscheduled job{unscheduled !== 1 ? "s" : ""}
                </p>
              </div>
              <button onClick={() => navigate("/schedule")}
                className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                Go to Schedule
              </button>
            </div>
          ) : null;
        })()
      )}

      {/* ── Content ─────────────────────────────────────────── */}
      {viewFilter === "today" && (
        <BoundedJobList
          jobs={todayJobs}
          isLoading={todayQ.isLoading}
          statusFilter={statusFilter}
          viewFilter="today"
          onNavigate={navigate}
          canSchedule={canSchedule}
          showAmounts={showAmounts}
        />
      )}

      {viewFilter === "upcoming" && (
        <BoundedJobList
          jobs={upcomingJobs}
          isLoading={upcomingQ.isLoading}
          statusFilter={statusFilter}
          viewFilter="upcoming"
          onNavigate={navigate}
          canSchedule={canSchedule}
          showAmounts={showAmounts}
        />
      )}

      {viewFilter === "all" && (
        <AllJobsList
          statusFilter={statusFilter}
          page={allPage}
          onPageChange={setAllPage}
          onNavigate={navigate}
          showAmounts={showAmounts}
          user={user}
        />
      )}
    </Layout>
  );
}
