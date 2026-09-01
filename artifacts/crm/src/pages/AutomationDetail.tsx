import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import {
  ArrowLeft, Save, X, Pencil, Trash2, Eye, CheckCircle2, XCircle,
  Clock, SkipForward, Zap, CalendarClock, FileWarning, RefreshCw,
} from "lucide-react";
import {
  useGetAutomation,
  useUpdateAutomation,
  useDeleteAutomation,
  useListMessageLogs,
  getListAutomationsQueryKey,
  getListMessageLogsQueryKey,
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useParams } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { format } from "date-fns";

// ─── Config ───────────────────────────────────────────────────────────────────

const TRIGGER_CFG: Record<string, { label: string; vars: string[]; icon: typeof Zap; scheduled?: boolean }> = {
  days_after_last_service: { label: "Days After Last Service", vars: ["{{first_name}}", "{{full_name}}", "{{company_name}}", "{{service_type}}", "{{last_service_date}}"], icon: CalendarClock, scheduled: true },
  inactive_customer:       { label: "Inactive Customer (No Service)",   vars: ["{{first_name}}", "{{full_name}}", "{{company_name}}", "{{service_type}}", "{{last_service_date}}"], icon: Clock, scheduled: true },
  job_created:             { label: "Job Created",             vars: ["{{customerName}}", "{{jobNumber}}", "{{scheduledDate}}", "{{serviceType}}"],                     icon: Zap },
  job_tomorrow:            { label: "Job Tomorrow",            vars: ["{{customerName}}", "{{jobNumber}}", "{{scheduledDate}}", "{{serviceType}}"],                     icon: CalendarClock },
  job_completed:           { label: "Job Completed",           vars: ["{{customerName}}", "{{jobNumber}}", "{{completedAt}}", "{{serviceType}}"],                       icon: CheckCircle2 },
  invoice_overdue:         { label: "Invoice Overdue",         vars: ["{{customerName}}", "{{invoiceNumber}}", "{{amount}}", "{{dueDate}}"],                            icon: FileWarning },
  recurring_plan_due:      { label: "Recurring Plan Due",      vars: ["{{customerName}}", "{{planName}}", "{{nextRunDate}}", "{{serviceType}}", "{{estimatedAmount}}"], icon: RefreshCw },
};

const STATUS_CFG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  sent:    { icon: CheckCircle2, color: "text-emerald-600", label: "Sent" },
  pending: { icon: Clock,        color: "text-amber-500",   label: "Pending" },
  skipped: { icon: SkipForward,  color: "text-slate-400",   label: "Skipped" },
  failed:  { icon: XCircle,      color: "text-red-500",     label: "Failed" },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AutomationDetail() {
  const { id } = useParams<{ id: string }>();
  const ruleId = parseInt(id, 10);
  const [, navigate] = useLocation();
  const { goBack, backLabel } = useBackNavigation("/automations");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({});

  const { data: rule, isLoading } = useGetAutomation(ruleId);
  const { data: allLogs = [] } = useListMessageLogs({ limit: 200 });

  // Filter logs for this trigger type
  const ruleLogs = (allLogs as Array<{
    id: number; channel: string; triggerType: string; relatedType?: string | null;
    relatedId?: number | null; recipient?: string | null; body: string;
    status: string; createdAt: string; runDate?: string | null;
  }>).filter((l) => l.triggerType === rule?.triggerType);

  useEffect(() => {
    if (rule && !editing) {
      setForm({
        name:            rule.name,
        triggerType:     rule.triggerType,
        active:          rule.active,
        channel:         rule.channel,
        templateSubject: rule.templateSubject ?? "",
        templateBody:    rule.templateBody,
        delayDays:       String((rule as { delayDays?: number | null }).delayDays ?? ""),
      });
    }
  }, [rule, editing]);

  const updateMutation = useUpdateAutomation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
        toast({ title: "Automation updated" });
        setEditing(false);
      },
      onError: () => toast({ title: "Failed to update", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteAutomation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
        navigate("/automations");
        toast({ title: "Automation deleted" });
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  const saveEdit = () => {
    const delayDaysStr = String(form.delayDays ?? "").trim();
    updateMutation.mutate({
      id: ruleId,
      data: {
        name:            String(form.name),
        triggerType:     String(form.triggerType),
        active:          Boolean(form.active),
        channel:         String(form.channel),
        templateSubject: (String(form.channel) !== "internal" && form.templateSubject) ? String(form.templateSubject) : undefined,
        templateBody:    String(form.templateBody),
        delayDays:       delayDaysStr ? parseInt(delayDaysStr, 10) : undefined,
      } as Parameters<typeof updateMutation.mutate>[0]["data"],
    });
  };

  const toggleActive = () => {
    updateMutation.mutate({
      id: ruleId,
      data: { active: !rule?.active } as Parameters<typeof updateMutation.mutate>[0]["data"],
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!rule) {
    return <Layout><div className="text-center py-20 text-slate-500">Automation not found.</div></Layout>;
  }

  const trig = TRIGGER_CFG[rule.triggerType];
  const TrigIcon = trig?.icon ?? Zap;
  const sf = (k: string) => String(form[k] ?? "");

  const previewText = (text: string) =>
    text
      .replace(/\{\{customerName\}\}/g, "Jane Smith")
      .replace(/\{\{jobNumber\}\}/g, "JOB-1234")
      .replace(/\{\{scheduledDate\}\}/g, "March 29, 2026")
      .replace(/\{\{serviceType\}\}/g, "Window Cleaning")
      .replace(/\{\{invoiceNumber\}\}/g, "INV-100")
      .replace(/\{\{amount\}\}/g, "350.00")
      .replace(/\{\{dueDate\}\}/g, "March 15, 2026")
      .replace(/\{\{planName\}\}/g, "Quarterly Service")
      .replace(/\{\{nextRunDate\}\}/g, "March 30, 2026")
      .replace(/\{\{estimatedAmount\}\}/g, "350.00")
      .replace(/\{\{completedAt\}\}/g, "March 28, 2026");

  const sentCount    = ruleLogs.filter((l) => l.status === "sent").length;
  const skippedCount = ruleLogs.filter((l) => l.status === "skipped").length;

  return (
    <Layout>
      <div className="max-w-3xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={goBack} className="rounded-xl h-9 w-9 mt-0.5 shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-display font-bold text-slate-900">{rule.name}</h1>
                <Badge variant="outline" className={`border-none ${rule.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${rule.active ? "bg-emerald-500" : "bg-slate-400"}`} />
                  {rule.active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {trig?.label ?? rule.triggerType} · {rule.channel}
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <Switch checked={rule.active} onCheckedChange={toggleActive} />
            {editing ? (
              <>
                <Button size="sm" className="rounded-xl" onClick={saveEdit} disabled={updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-1" />
                  {updateMutation.isPending ? "Saving…" : "Save"}
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setEditing(false)}>
                  <X className="w-4 h-4 mr-1" /> Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setEditing(true)}>
                  <Pencil className="w-4 h-4 mr-1" /> Edit
                </Button>
                <Button
                  variant="outline" size="sm"
                  className="rounded-xl border-red-200 text-red-600 hover:bg-red-50"
                  onClick={() => { if (confirm("Delete this automation rule?")) deleteMutation.mutate({ id: ruleId }); }}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Main — template editor */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Message Template</h2>
                {editing && (
                  <Button type="button" variant="ghost" size="sm" className="rounded-xl text-slate-500 gap-1.5" onClick={() => setPreview(!preview)}>
                    <Eye className="w-3.5 h-3.5" />
                    {preview ? "Edit" : "Preview"}
                  </Button>
                )}
              </div>

              {editing && trig && (
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-slate-500 mb-1.5">Available variables:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {trig.vars.map((v) => (
                      <code
                        key={v}
                        className="text-xs bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-md cursor-pointer hover:bg-primary/5 hover:border-primary/30"
                        onClick={() => setForm((f) => ({ ...f, templateBody: sf("templateBody") + v }))}
                      >
                        {v}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {editing ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Rule Name</Label>
                    <Input value={sf("name")} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl" />
                  </div>
                  {TRIGGER_CFG[sf("triggerType")]?.scheduled && (
                    <div className="space-y-1.5">
                      <Label>Days Threshold</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={sf("delayDays")}
                          onChange={(e) => setForm({ ...form, delayDays: e.target.value })}
                          className="rounded-xl w-24"
                          placeholder="90"
                        />
                        <span className="text-sm text-slate-500">days after last service</span>
                      </div>
                      <p className="text-xs text-slate-400">The automation runs daily and targets customers who haven't had service in this many days.</p>
                    </div>
                  )}
                  {sf("channel") !== "internal" && (
                    <div className="space-y-1.5">
                      <Label>Subject Line</Label>
                      {preview ? (
                        <div className="rounded-xl border bg-slate-50 px-3 py-2 text-sm text-slate-700">{previewText(sf("templateSubject"))}</div>
                      ) : (
                        <Input value={sf("templateSubject")} onChange={(e) => setForm({ ...form, templateSubject: e.target.value })} className="rounded-xl" placeholder="e.g. Reminder: {{serviceType}} Tomorrow" />
                      )}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>Message Body</Label>
                    {preview ? (
                      <div className="rounded-xl border bg-slate-50 px-3 py-2.5 text-sm text-slate-700 min-h-[100px] whitespace-pre-line">{previewText(sf("templateBody"))}</div>
                    ) : (
                      <Textarea
                        value={sf("templateBody")}
                        onChange={(e) => setForm({ ...form, templateBody: e.target.value })}
                        className="rounded-xl resize-none min-h-[120px]"
                        rows={6}
                      />
                    )}
                  </div>
                </>
              ) : (
                <>
                  {trig?.scheduled && (rule as { delayDays?: number | null }).delayDays != null && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Days Threshold</p>
                      <p className="text-sm text-slate-700">{(rule as { delayDays?: number | null }).delayDays} days after last service</p>
                    </div>
                  )}
                  {rule.templateSubject && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Subject</p>
                      <p className="text-sm text-slate-700">{rule.templateSubject}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Message</p>
                    <p className="text-sm text-slate-700 whitespace-pre-line">{rule.templateBody}</p>
                  </div>
                </>
              )}

              {/* Mobile edit buttons */}
              <div className="sm:hidden flex gap-2 pt-2 border-t">
                {editing ? (
                  <>
                    <Button className="flex-1 rounded-xl" onClick={saveEdit} disabled={updateMutation.isPending}>
                      <Save className="w-4 h-4 mr-1" />
                      {updateMutation.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                    <Button variant="outline" className="rounded-xl" onClick={() => setEditing(false)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setEditing(true)}>
                      <Pencil className="w-4 h-4 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-xl border-red-200 text-red-600"
                      onClick={() => { if (confirm("Delete this automation?")) deleteMutation.mutate({ id: ruleId }); }}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Recent logs for this rule */}
            {ruleLogs.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h2 className="font-semibold text-slate-900 mb-4">Message History</h2>
                <div className="space-y-1.5">
                  {ruleLogs.slice(0, 20).map((log) => {
                    const st = STATUS_CFG[log.status] ?? STATUS_CFG.pending;
                    const StIcon = st.icon;
                    return (
                      <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                        <StIcon className={`w-4 h-4 mt-0.5 shrink-0 ${st.color}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-slate-500">
                            {log.relatedType} #{log.relatedId} · {log.channel}
                            {log.recipient ? ` → ${log.recipient}` : ""}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5 truncate">{log.body}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={`text-[10px] font-medium ${st.color}`}>{st.label}</span>
                          <p className="text-[10px] text-slate-300">{format(new Date(log.createdAt), "MMM d")}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Stats */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">Stats</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Total runs</span>
                  <span className="font-bold text-slate-900">{ruleLogs.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Sent</span>
                  <span className="font-bold text-emerald-700">{sentCount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Skipped</span>
                  <span className="font-bold text-slate-400">{skippedCount}</span>
                </div>
              </div>
            </div>

            {/* Config summary */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">Configuration</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-slate-400">Trigger</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <TrigIcon className="w-3.5 h-3.5 text-primary" />
                    <p className="text-sm font-medium text-slate-700">{trig?.label ?? rule.triggerType}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Channel</p>
                  <p className="text-sm font-medium text-slate-700 capitalize">{rule.channel}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Status</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`w-2 h-2 rounded-full ${rule.active ? "bg-emerald-500" : "bg-slate-300"}`} />
                    <p className="text-sm font-medium text-slate-700">{rule.active ? "Active" : "Inactive"}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Created</p>
                  <p className="text-sm text-slate-600">{rule.createdAt ? format(new Date(rule.createdAt), "MMM d, yyyy") : "—"}</p>
                </div>
              </div>
            </div>

            <div className="sm:hidden">
              <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-100 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-700">Rule {rule.active ? "active" : "inactive"}</p>
                  <p className="text-xs text-slate-400">Toggle to {rule.active ? "pause" : "activate"} this rule</p>
                </div>
                <Switch checked={rule.active} onCheckedChange={toggleActive} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
