import { useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListAutomations,
  useUpdateAutomation,
  useDeleteAutomation,
  useListMessageLogs,
  useRunJobTomorrow,
  useRunInvoiceOverdue,
  useRunRecurringPlanDue,
  getListAutomationsQueryKey,
  getListMessageLogsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Plus, Play, Zap, Mail, MessageSquare, Bell, Trash2, Pencil,
  CheckCircle2, XCircle, Clock, AlertTriangle, SkipForward,
  CalendarClock, FileWarning, RefreshCw,
  Activity,
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { AUTOMATION_ROUTES } from "@/lib/automation-routes";

// ─── Config ───────────────────────────────────────────────────────────────────

const TRIGGER_CFG: Record<string, { label: string; desc: string; icon: typeof Zap; color: string }> = {
  days_after_last_service: { label: "Days After Last Service", desc: "Runs daily — emails customers N days after their last job",      icon: CalendarClock, color: "text-amber-600" },
  inactive_customer:       { label: "Inactive Customer",       desc: "Runs daily — re-engages customers with no recent service",        icon: Clock,         color: "text-rose-600" },
  job_created:             { label: "Job Created",             desc: "Fires when a new job is created",                                 icon: Zap,           color: "text-blue-600" },
  job_tomorrow:            { label: "Job Tomorrow",            desc: "Reminder for jobs scheduled the next day",                        icon: CalendarClock, color: "text-indigo-600" },
  job_completed:           { label: "Job Completed",           desc: "Fires when a job is marked complete",                             icon: CheckCircle2,  color: "text-emerald-600" },
  invoice_overdue:         { label: "Invoice Overdue",         desc: "Reminder for past-due invoices",                                  icon: FileWarning,   color: "text-red-600" },
  recurring_plan_due:      { label: "Recurring Plan Due",      desc: "Alert when a recurring plan run date is near",                    icon: RefreshCw,     color: "text-violet-600" },
};

const CHANNEL_CFG: Record<string, { label: string; icon: typeof Bell; color: string; bg: string }> = {
  internal: { label: "Internal",  icon: Bell,         color: "text-slate-700",   bg: "bg-slate-100" },
  email:    { label: "Email",     icon: Mail,         color: "text-blue-700",    bg: "bg-blue-50" },
  sms:      { label: "SMS",       icon: MessageSquare, color: "text-emerald-700", bg: "bg-emerald-50" },
};

const STATUS_CFG: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  sent:    { icon: CheckCircle2, color: "text-emerald-600" },
  pending: { icon: Clock,        color: "text-amber-500" },
  skipped: { icon: SkipForward,  color: "text-slate-400" },
  failed:  { icon: XCircle,      color: "text-red-500" },
};

// ─── Run Button Component ─────────────────────────────────────────────────────

function RunButton({
  label, desc, icon: Icon, onClick, loading,
}: {
  label: string; desc: string; icon: typeof Play;
  onClick: () => void; loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-100 bg-white hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm active:scale-[.99] transition-all text-left disabled:opacity-60"
    >
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900 text-sm">{label}</p>
        <p className="text-xs text-slate-500 truncate">{desc}</p>
      </div>
      <div className="shrink-0">
        {loading ? (
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        ) : (
          <Play className="w-4 h-4 text-slate-400" />
        )}
      </div>
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Automations() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [runningJob, setRunningJob] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useListAutomations();
  const { data: logs = [] } = useListMessageLogs({ limit: 40 });

  const updateMutation = useUpdateAutomation({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAutomationsQueryKey() }),
      onError: () => toast({ title: "Failed to update automation", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteAutomation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
        toast({ title: "Automation deleted" });
        setDeletingId(null);
      },
      onError: () => toast({ title: "Failed to delete automation", variant: "destructive" }),
    },
  });

  const runJobTomorrow = useRunJobTomorrow({
    mutation: {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: getListMessageLogsQueryKey() });
        toast({ title: "Done", description: (r as { message: string }).message });
        setRunningJob(null);
      },
      onError: () => { toast({ title: "Run failed", variant: "destructive" }); setRunningJob(null); },
    },
  });

  const runInvoiceOverdue = useRunInvoiceOverdue({
    mutation: {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: getListMessageLogsQueryKey() });
        toast({ title: "Done", description: (r as { message: string }).message });
        setRunningJob(null);
      },
      onError: () => { toast({ title: "Run failed", variant: "destructive" }); setRunningJob(null); },
    },
  });

  const runPlanDue = useRunRecurringPlanDue({
    mutation: {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: getListMessageLogsQueryKey() });
        toast({ title: "Done", description: (r as { message: string }).message });
        setRunningJob(null);
      },
      onError: () => { toast({ title: "Run failed", variant: "destructive" }); setRunningJob(null); },
    },
  });

  const toggleActive = (id: number, current: boolean) => {
    updateMutation.mutate({ id, data: { active: !current } as Parameters<typeof updateMutation.mutate>[0]["data"] });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this automation rule?")) return;
    setDeletingId(id);
    deleteMutation.mutate({ id });
  };

  const allRules = rules as Array<{
    id: number; name: string; triggerType: string; active: boolean;
    channel: string; templateBody: string; templateSubject?: string | null;
    createdAt: string;
  }>;

  const allLogs = logs as Array<{
    id: number; channel: string; triggerType: string; relatedType?: string | null;
    relatedId?: number | null; recipient?: string | null; body: string; status: string;
    createdAt: string; runDate?: string | null;
  }>;

  const activeCount = allRules.filter((r) => r.active).length;

  return (
    <Layout>
      <div className="max-w-5xl space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900">Automations</h1>
            <p className="text-slate-500 text-sm mt-0.5">Set up reminders and notifications triggered by business events.</p>
          </div>
           <div className="flex items-center gap-2">
             <Button variant="outline" className="rounded-xl shrink-0" onClick={() => navigate(AUTOMATION_ROUTES.health)}>
               <Activity className="w-4 h-4 mr-2" /> Health
             </Button>
             <Button className="rounded-xl shadow-md shadow-primary/20 shrink-0" onClick={() => navigate(AUTOMATION_ROUTES.new)}>
               <Plus className="w-4 h-4 mr-2" /> New Rule
             </Button>
           </div>
        </div>

        {/* Summary bar */}
        {allRules.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {[
              { label: "Total rules",   count: allRules.length,  color: "text-slate-700" },
              { label: "Active",        count: activeCount,       color: "text-emerald-700" },
              { label: "Inactive",      count: allRules.length - activeCount, color: "text-slate-400" },
              { label: "Messages sent", count: allLogs.filter((l) => l.status === "sent").length, color: "text-blue-700" },
            ].map(({ label, count, color }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-100 px-4 py-2.5 shrink-0">
                <p className="text-xs text-slate-400 font-medium">{label}</p>
                <p className={`text-xl font-bold ${color}`}>{count}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left column — Rules list */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Automation Rules</h2>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-white rounded-2xl border animate-pulse" />)}
              </div>
            ) : allRules.length === 0 ? (
              <div className="py-16 flex flex-col items-center text-center bg-white rounded-2xl border border-dashed border-slate-200">
                <Zap className="w-10 h-10 text-slate-200 mb-3" />
                <h3 className="font-bold text-slate-700 mb-1">No automation rules yet</h3>
                <p className="text-slate-400 text-sm max-w-xs mb-4">Create your first rule to start sending reminders automatically.</p>
                <Button onClick={() => navigate(AUTOMATION_ROUTES.new)} variant="outline" className="rounded-xl">
                  <Plus className="w-4 h-4 mr-1" /> Create First Rule
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {allRules.map((rule) => {
                  const trig = TRIGGER_CFG[rule.triggerType];
                  const ch = CHANNEL_CFG[rule.channel] ?? CHANNEL_CFG.internal;
                  const TrigIcon = trig?.icon ?? Zap;
                  const ChIcon = ch.icon;
                  return (
                    <div key={rule.id} className="bg-white rounded-2xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${rule.active ? "bg-primary/10" : "bg-slate-100"}`}>
                            <TrigIcon className={`w-4.5 h-4.5 ${rule.active ? trig?.color ?? "text-primary" : "text-slate-400"}`} />
                          </div>
                          <div className="min-w-0">
                            <p className={`font-semibold text-sm truncate ${rule.active ? "text-slate-900" : "text-slate-400"}`}>{rule.name}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-xs text-slate-400">{trig?.label ?? rule.triggerType}</span>
                              <span className="text-slate-200">·</span>
                              <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${ch.bg} ${ch.color}`}>
                                <ChIcon className="w-3 h-3" />
                                {ch.label}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Switch
                            checked={rule.active}
                            onCheckedChange={() => toggleActive(rule.id, rule.active)}
                          />
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-slate-400 hover:text-slate-700" onClick={() => navigate(`${AUTOMATION_ROUTES.index}/${rule.id}`)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 rounded-xl text-slate-300 hover:text-red-500"
                            onClick={() => handleDelete(rule.id)}
                            disabled={deletingId === rule.id}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right column — Run actions + recent logs */}
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">Manual Checks</h2>
              <div className="space-y-2">
                <RunButton
                  label="Tomorrow's Job Reminders"
                  desc="Find jobs scheduled for tomorrow and notify customers"
                  icon={CalendarClock}
                  loading={runningJob === "job-tomorrow"}
                  onClick={() => { setRunningJob("job-tomorrow"); runJobTomorrow.mutate(); }}
                />
                <RunButton
                  label="Overdue Invoice Reminders"
                  desc="Find past-due invoices and send payment reminders"
                  icon={FileWarning}
                  loading={runningJob === "invoice-overdue"}
                  onClick={() => { setRunningJob("invoice-overdue"); runInvoiceOverdue.mutate(); }}
                />
                <RunButton
                  label="Recurring Plan Due Alerts"
                  desc="Find plans due within 7 days and create internal alerts"
                  icon={RefreshCw}
                  loading={runningJob === "plan-due"}
                  onClick={() => { setRunningJob("plan-due"); runPlanDue.mutate(); }}
                />
              </div>
            </div>

            {/* Recent message log */}
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">Recent Activity</h2>
              {allLogs.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-slate-200 py-8 text-center">
                  <Clock className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">No messages yet.<br />Run a check to get started.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {allLogs.slice(0, 15).map((log) => {
                    const stCfg = STATUS_CFG[log.status] ?? STATUS_CFG.pending;
                    const StIcon = stCfg.icon;
                    const trig = TRIGGER_CFG[log.triggerType];
                    return (
                      <div key={log.id} className="bg-white rounded-xl border border-slate-100 p-3 flex items-start gap-2.5">
                        <StIcon className={`w-4 h-4 mt-0.5 shrink-0 ${stCfg.color}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-700 truncate">
                            {trig?.label ?? log.triggerType}
                            {log.relatedType && log.relatedId ? ` · ${log.relatedType} #${log.relatedId}` : ""}
                          </p>
                          <p className="text-xs text-slate-400 truncate">
                            {log.recipient ?? "No recipient"} · {log.channel}
                          </p>
                        </div>
                        <span className="text-[10px] text-slate-300 shrink-0 mt-0.5">
                          {format(new Date(log.createdAt), "MM/dd")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
