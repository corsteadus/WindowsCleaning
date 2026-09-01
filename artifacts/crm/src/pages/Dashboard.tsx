import { useState } from "react";
import { useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import {
  AlertCircle, ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CalendarClock,
  CheckCircle2, ChevronRight, CircleDollarSign, Clock, FileCheck2, FileX2,
  Gauge, MapPin, Receipt, Sparkles, TriangleAlert, WalletCards,
  Plus,
} from "lucide-react";
import {
  DashboardPeriod,
  getGetDashboardStatsQueryKey,
  type DashboardComparedMetric,
  useGetDashboardStats,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { hasClientCapability } from "@/lib/rbac";
import { Layout } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import { authScopedQueryKey } from "@/lib/auth-scope";

const PERIODS = [
  [DashboardPeriod.today, "Today"],
  [DashboardPeriod.last_7_days, "Last 7 Days"],
  [DashboardPeriod.last_month, "Last Month"],
  [DashboardPeriod.last_quarter, "Last Quarter"],
  [DashboardPeriod.this_year, "This Year"],
] as const;

function fmtTime(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")}${hours >= 12 ? "pm" : "am"}`;
}

function Comparison({ metric, suffix = "" }: { metric: DashboardComparedMetric; suffix?: string }) {
  if (metric.percentChange === null) {
    return <span className="text-xs text-slate-400">New vs prior period</span>;
  }
  const up = metric.percentChange > 0;
  const Icon = up ? ArrowUpRight : metric.percentChange < 0 ? ArrowDownRight : Gauge;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
      up ? "text-emerald-600" : metric.percentChange < 0 ? "text-rose-600" : "text-slate-400"
    }`}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(metric.percentChange)}% vs prior {suffix}
    </span>
  );
}

function Kpi({
  title, value, metric, icon: Icon, tint = "blue", help,
}: {
  title: string;
  value: string;
  metric?: DashboardComparedMetric;
  icon: React.ElementType;
  tint?: "blue" | "green" | "amber" | "rose";
  help?: string;
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    green: "bg-emerald-50 text-emerald-600 border-emerald-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100",
    rose: "bg-rose-50 text-rose-600 border-rose-100",
  }[tint];
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-slate-500">{title}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-xl border p-2.5 ${colors}`}><Icon className="h-5 w-5" /></div>
      </div>
      <div className="mt-4 min-h-5">{metric ? <Comparison metric={metric} /> : <span className="text-xs text-slate-400">{help}</span>}</div>
    </article>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState<DashboardPeriod>(DashboardPeriod.last_7_days);
  const { user } = useAuth();
  const canReport = hasClientCapability(user, "dashboard.view")
    && hasClientCapability(user, "invoices.view")
    && hasClientCapability(user, "payments.view");
  const canCreateJob = hasClientCapability(user, "schedule.manage");
  const { data, isLoading, isError, refetch } = useGetDashboardStats(
    { period },
    { query: { queryKey: authScopedQueryKey(user, getGetDashboardStatsQueryKey({ period })), enabled: canReport } },
  );
  const [, navigate] = useLocation();
  const operational = data?.operational ?? {
    jobsToday: 0,
    unscheduledJobs: 0,
    unpaidInvoices: 0,
    todayJobsList: [],
    pastDueInvoicesList: [],
  };

  return (
    <Layout>
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-slate-950 px-5 py-6 text-white shadow-xl sm:px-7">
        <div className="absolute -right-12 -top-24 h-56 w-56 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sky-300">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-[0.18em]">Business pulse</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Know where the business stands.</h1>
            <p className="mt-2 text-sm text-slate-300">
              Decisions, cash collected, and receivables—without counting the same dollar twice.
            </p>
            {canCreateJob && <button onClick={() => navigate("/jobs/new")} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-50">
              <Plus className="h-4 w-4" /><span>Create Job</span>
            </button>}
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-white/10 p-1" aria-label="Reporting period">
            {PERIODS.map(([value, label]) => (
              <button key={value} onClick={() => setPeriod(value)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold transition ${
                  period === value ? "bg-white text-slate-950 shadow" : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {data && (
          <p className="relative mt-5 text-xs text-slate-400">
            {format(parseISO(data.window.start), "MMM d, yyyy")} – {format(parseISO(data.window.end), "MMM d, yyyy")}
            <span className="mx-2">·</span>
            compared with {format(parseISO(data.previousWindow.start), "MMM d")} – {format(parseISO(data.previousWindow.end), "MMM d, yyyy")}
          </p>
        )}
      </header>

      {!canReport ? (
        <div className="flex min-h-[42vh] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 text-center">
          <div className="mb-4 rounded-2xl bg-slate-100 p-3"><Receipt className="h-7 w-7 text-slate-500" /></div>
          <h2 className="text-lg font-bold text-slate-900">Business reporting isn’t available for this role</h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">An owner or office administrator can grant the invoice and payment visibility required for this overview.</p>
        </div>
      ) : isError ? (
        <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-center">
          <AlertCircle className="mb-3 h-10 w-10 text-rose-500" />
          <h2 className="text-lg font-bold text-slate-900">The overview couldn’t load</h2>
          <button onClick={() => refetch()} className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">Try again</button>
        </div>
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
      ) : (
        <>
          <section aria-labelledby="estimate-performance">
            <h2 id="estimate-performance" className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Estimate performance</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi title="Accepted" value={String(data.metrics.acceptedEstimates.value)} metric={data.metrics.acceptedEstimates} icon={FileCheck2} tint="green" />
              <Kpi title="Declined" value={String(data.metrics.declinedEstimates.value)} metric={data.metrics.declinedEstimates} icon={FileX2} tint="rose" />
              <Kpi title="Close rate" value={`${data.metrics.closeRate.value}%`} metric={data.metrics.closeRate} icon={Gauge} tint="blue" />
              <Kpi title="Converted to jobs" value={String(data.metrics.estimatesConverted.value)} metric={data.metrics.estimatesConverted} icon={BriefcaseBusiness} tint="amber" />
            </div>
          </section>

          <section className="mt-7" aria-labelledby="financial-health">
            <h2 id="financial-health" className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Financial health</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi title="Period sales" value={formatCurrency(data.metrics.periodSales.value)} metric={data.metrics.periodSales} icon={CircleDollarSign} tint="green" />
              <Kpi title="Month to date" value={formatCurrency(data.metrics.monthlySales)} icon={WalletCards} help="Posted payments this month" />
              <Kpi title="Year to date" value={formatCurrency(data.metrics.ytdSales)} icon={WalletCards} help="Posted payments this year" />
              <Kpi title="Outstanding" value={formatCurrency(data.metrics.totalOutstanding)} icon={Receipt} tint={data.metrics.totalOutstanding > 0 ? "amber" : "green"} help={`${data.metrics.pastDueCount} past due · ${formatCurrency(data.metrics.pastDueValue)}`} />
            </div>
          </section>

          <section className="mt-7 grid grid-cols-1 gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2"><TriangleAlert className="h-4 w-4 text-amber-500" /><h2 className="font-bold text-slate-900">Needs attention</h2></div>
              <div className="space-y-2">
                {[
                  [operational.unscheduledJobs, "Unscheduled jobs", "/schedule"],
                  [data.metrics.pastDueCount, "Past-due invoices", "/invoices"],
                  [operational.unpaidInvoices, "Invoices with a balance", "/invoices"],
                ].map(([count, label, href]) => (
                  <button key={String(label)} onClick={() => navigate(String(href))} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-left hover:bg-slate-100">
                    <span className="text-sm font-semibold text-slate-700">{label}</span>
                    <span className="flex items-center gap-2 font-black text-slate-950">{count}<ChevronRight className="h-4 w-4 text-slate-400" /></span>
                  </button>
                ))}
              </div>
              {!operational.unscheduledJobs && !data.metrics.pastDueCount && !operational.unpaidInvoices && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />All caught up</div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <div><h2 className="font-bold text-slate-900">Today’s work</h2><p className="text-xs text-slate-400">{operational.jobsToday} scheduled</p></div>
                <button onClick={() => navigate("/schedule")} className="text-xs font-bold text-primary hover:underline">Open schedule</button>
              </div>
              {operational.todayJobsList.length ? (
                <div className="divide-y divide-slate-100">
                  {operational.todayJobsList.map((job) => (
                    <button key={job.id} onClick={() => navigate(`/jobs/${job.id}`)} className="flex w-full items-center justify-between gap-3 py-3 text-left">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{job.customerName}</p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" />{fmtTime(job.scheduledStartTime) ?? "Time not set"} <MapPin className="ml-2 h-3 w-3" />{job.jobNumber}</p>
                      </div>
                      <StatusBadge status={job.status} />
                    </button>
                  ))}
                </div>
              ) : <div className="py-8 text-center text-sm text-slate-400"><CalendarClock className="mx-auto mb-2 h-8 w-8 text-slate-200" />No jobs scheduled today</div>}
            </div>
          </section>
          <p className="mt-5 text-center text-[11px] text-slate-400" title={Object.values(data.definitions).join(" ")}>
            Sales = posted payments. Close rate excludes open and undated legacy estimates. Past due means due before today.
          </p>
        </>
      )}
    </Layout>
  );
}