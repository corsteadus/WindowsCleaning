import { Layout } from "@/components/Layout";
import { useListRecurringPlans } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus, RefreshCw, Calendar, User, MapPin, ChevronRight,
  PlayCircle, PauseCircle, XCircle, Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import { format, parseISO, isPast, isToday, differenceInDays } from "date-fns";

// ─── Config ───────────────────────────────────────────────────────────────────

const FREQ_LABEL: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 Weeks",
  monthly: "Monthly",
  bi_monthly: "Every 2 Months",
  bimonthly: "Every 2 Months",
  quarterly: "Quarterly",
  semi_annual: "Semi-Annual",
  semiannual: "Semi-Annual",
  annual: "Annual",
  custom: "Custom",
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; dot: string; icon: typeof PlayCircle }> = {
  active:   { label: "Active",   color: "text-emerald-700", bg: "bg-emerald-50",  dot: "bg-emerald-500",  icon: PlayCircle },
  paused:   { label: "Paused",   color: "text-amber-700",   bg: "bg-amber-50",    dot: "bg-amber-400",    icon: PauseCircle },
  canceled:  { label: "Canceled",  color: "text-red-600",    bg: "bg-red-50",      dot: "bg-red-400",      icon: XCircle },
  cancelled: { label: "Canceled",  color: "text-red-600",    bg: "bg-red-50",      dot: "bg-red-400",      icon: XCircle },
  seasonal: { label: "Seasonal", color: "text-blue-700",   bg: "bg-blue-50",     dot: "bg-blue-500",     icon: PlayCircle },
};

function nextRunLabel(dateStr?: string | null) {
  if (!dateStr) return { text: "Not set", overdue: false };
  try {
    const d = parseISO(dateStr);
    const overdue = isPast(d) && !isToday(d);
    const text = format(d, "EEE, MMM d, yyyy");
    return { text, overdue };
  } catch {
    return { text: dateStr, overdue: false };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function RecurringPlans() {
  const [, navigate] = useLocation();
  const { data: plans = [], isLoading } = useListRecurringPlans();

  const allPlans = plans as unknown as Array<{
    id: number; name: string; status: string; frequencyType: string;
    nextRunDate?: string | null; lastGeneratedDate?: string | null;
    customerName?: string | null; propertyAddress?: string | null; propertyName?: string | null;
    customerId: number; serviceType?: string | null; estimatedAmount?: string | null;
    autoGenerateJobs?: boolean;
  }>;

  function getDueStatus(dateStr?: string | null): { label: string; cls: string } | null {
    if (!dateStr) return null;
    try {
      const d = parseISO(dateStr);
      const days = differenceInDays(d, new Date());
      if (isPast(d) && !isToday(d)) return { label: "Overdue", cls: "bg-red-100 text-red-700" };
      if (isToday(d))               return { label: "Due Today", cls: "bg-amber-100 text-amber-700" };
      if (days <= 14)               return { label: `Due in ${days}d`, cls: "bg-rose-100 text-rose-700" };
      return null;
    } catch { return null; }
  }

  const activeCt  = allPlans.filter((p) => p.status === "active").length;
  const pausedCt  = allPlans.filter((p) => p.status === "paused").length;

  return (
    <Layout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900">Recurring Plans</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage repeat service agreements and generate jobs.</p>
        </div>
        <Button className="rounded-xl shadow-lg shadow-primary/20" onClick={() => navigate("/recurring-plans/new")}>
          <Plus className="w-4 h-4 mr-2" /> New Plan
        </Button>
      </div>

      {/* Summary strip */}
      {allPlans.length > 0 && (
        <div className="flex gap-3 mb-5 overflow-x-auto pb-1">
          {[
            { label: "Total", count: allPlans.length, color: "text-slate-700" },
            { label: "Active", count: activeCt, color: "text-emerald-700" },
            { label: "Paused", count: pausedCt, color: "text-amber-700" },
          ].map(({ label, count, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-100 px-4 py-2.5 shrink-0">
              <p className="text-xs text-slate-400 font-medium">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{count}</p>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-white rounded-2xl border border-slate-100 animate-pulse" />)}
        </div>
      ) : allPlans.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center bg-white rounded-2xl border border-dashed border-slate-200">
          <RefreshCw className="w-12 h-12 text-slate-200 mb-3" />
          <h3 className="font-bold text-slate-700 mb-1">No recurring plans yet</h3>
          <p className="text-slate-400 text-sm max-w-xs mb-4">Create plans for your regular customers to keep repeat jobs on schedule.</p>
          <Button onClick={() => navigate("/recurring-plans/new")} variant="outline" className="rounded-xl">
            <Plus className="w-4 h-4 mr-1" /> Create First Plan
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {allPlans.map((plan) => {
            const cfg = STATUS_CFG[plan.status] ?? STATUS_CFG.active;
            const { text: nextText, overdue } = nextRunLabel(plan.nextRunDate);
            const location = plan.propertyName || plan.propertyAddress;
            const dueStatus = getDueStatus(plan.nextRunDate);

            return (
              <div
                key={plan.id}
                onClick={() => navigate(`/recurring-plans/${plan.id}`)}
                className="bg-white rounded-2xl border border-slate-100 hover:border-slate-200 hover:shadow-md active:scale-[.99] transition-all cursor-pointer group overflow-hidden flex"
              >
                {/* Status bar */}
                <div className={`w-1.5 shrink-0 ${cfg.dot}`} />

                <div className="flex-1 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base leading-snug">{plan.name}</h3>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        <Badge
                          variant="outline"
                          className={`border-none text-xs ${cfg.bg} ${cfg.color}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${cfg.dot}`} />
                          {cfg.label}
                        </Badge>
                        {dueStatus && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${dueStatus.cls}`}>
                            {dueStatus.label}
                          </span>
                        )}
                        {plan.autoGenerateJobs && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5" /> Auto
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 mt-1 shrink-0" />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    {plan.customerName && (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="text-sm text-slate-600 truncate">{plan.customerName}</span>
                      </div>
                    )}
                    {location && (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="text-sm text-slate-600 truncate">{location}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-50">
                    <div className="flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-xs text-slate-500">{FREQ_LABEL[plan.frequencyType] ?? plan.frequencyType}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span className={`text-xs font-medium ${overdue ? "text-red-600" : "text-slate-600"}`}>
                        {overdue ? "⚠ " : ""}{nextText}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
