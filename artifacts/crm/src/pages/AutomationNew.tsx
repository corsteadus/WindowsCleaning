import { useState } from "react";
import { Layout } from "@/components/Layout";
import { ArrowLeft, Eye } from "lucide-react";
import {
  useCreateAutomation,
  getListAutomationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { nextSelectValue } from "@/lib/select-guards";

// ─── Config ───────────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  {
    value: "days_after_last_service",
    label: "Days After Last Service",
    desc: "Runs daily — emails customers N days after their last completed job",
    vars: ["{{first_name}}", "{{full_name}}", "{{company_name}}", "{{service_type}}", "{{last_service_date}}"],
    defaultBody: "Hi {{first_name}}, it's been a while since your last window cleaning. We'd love to schedule your next service — reply to this email or call us to book.",
    defaultSubject: "Time for Your Next Window Cleaning?",
    scheduled: true,
    defaultDelayDays: 90,
  },
  {
    value: "inactive_customer",
    label: "Inactive Customer (No Recent Service)",
    desc: "Runs daily — re-engages customers with no service in N days",
    vars: ["{{first_name}}", "{{full_name}}", "{{company_name}}", "{{service_type}}", "{{last_service_date}}"],
    defaultBody: "Hi {{first_name}}, we noticed it's been a while since we last served you. We'd love to reconnect — reach out to schedule your next window cleaning today.",
    defaultSubject: "We Miss You — Let's Get Your Windows Sparkling Again",
    scheduled: true,
    defaultDelayDays: 180,
  },
  {
    value: "job_created",
    label: "Job Created",
    desc: "Fires when a new job is scheduled",
    vars: ["{{customerName}}", "{{jobNumber}}", "{{scheduledDate}}", "{{serviceType}}"],
    defaultBody: "Hi {{customerName}}, your {{serviceType}} has been scheduled for {{scheduledDate}}. Job #{{jobNumber}}. We'll be in touch with more details.",
    defaultSubject: "Job Confirmed — {{serviceType}} on {{scheduledDate}}",
    scheduled: false,
    defaultDelayDays: null,
  },
  {
    value: "job_tomorrow",
    label: "Job Tomorrow",
    desc: "Reminder sent the day before a job",
    vars: ["{{customerName}}", "{{jobNumber}}", "{{scheduledDate}}", "{{serviceType}}"],
    defaultBody: "Hi {{customerName}}, this is a reminder that your {{serviceType}} is scheduled for tomorrow, {{scheduledDate}}. Job #{{jobNumber}}.",
    defaultSubject: "Reminder: {{serviceType}} Tomorrow",
    scheduled: false,
    defaultDelayDays: null,
  },
  {
    value: "job_completed",
    label: "Job Completed",
    desc: "Thank-you message after a job is marked complete",
    vars: ["{{customerName}}", "{{jobNumber}}", "{{completedAt}}", "{{serviceType}}"],
    defaultBody: "Hi {{customerName}}, thank you for choosing us! Your {{serviceType}} (Job #{{jobNumber}}) was completed today. We hope everything looks great!",
    defaultSubject: "Thank You — Job #{{jobNumber}} Complete",
    scheduled: false,
    defaultDelayDays: null,
  },
  {
    value: "invoice_overdue",
    label: "Invoice Overdue",
    desc: "Reminder for past-due invoices",
    vars: ["{{customerName}}", "{{invoiceNumber}}", "{{amount}}", "{{dueDate}}"],
    defaultBody: "Hi {{customerName}}, Invoice #{{invoiceNumber}} for ${{amount}} was due on {{dueDate}} and remains unpaid. Please contact us to arrange payment.",
    defaultSubject: "Payment Reminder — Invoice #{{invoiceNumber}} Overdue",
    scheduled: false,
    defaultDelayDays: null,
  },
  {
    value: "recurring_plan_due",
    label: "Recurring Plan Due",
    desc: "Internal alert when a plan run date is approaching",
    vars: ["{{customerName}}", "{{planName}}", "{{nextRunDate}}", "{{serviceType}}", "{{estimatedAmount}}"],
    defaultBody: "Recurring plan '{{planName}}' for {{customerName}} is due on {{nextRunDate}}. Service: {{serviceType}}. Est. amount: ${{estimatedAmount}}. Remember to generate the job.",
    defaultSubject: null,
    scheduled: false,
    defaultDelayDays: null,
  },
];

const CHANNEL_OPTIONS = [
  { value: "internal", label: "Internal (always logged)", desc: "Creates an internal notification record — no external send" },
  { value: "email", label: "Email", desc: "Logged as sent; real delivery requires email integration" },
  { value: "sms", label: "SMS", desc: "Logged as sent; real delivery requires SMS integration" },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AutomationNew() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("");
  const [channel, setChannel] = useState("email");
  const [active, setActive] = useState(true);
  const [templateSubject, setTemplateSubject] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [delayDays, setDelayDays] = useState<string>("");
  const [preview, setPreview] = useState(false);

  const selectedTrigger = TRIGGER_OPTIONS.find((t) => t.value === triggerType);

  const handleTriggerChange = (incoming: string) => {
    // Guarded functional transition — Radix bubble-input noise ("",
    // whitespace, literal "undefined"/"null") keeps the current trigger
    // instead of wiping it (see select-guards.ts).  Functional update so the
    // guard never compares against a stale render closure.
    setTriggerType((prev) => nextSelectValue(prev, incoming));
    // Template defaults key off the *incoming* value: junk matches no
    // trigger option, so the defaults no-op in exactly the cases the guard
    // rejects, and apply in exactly the cases it accepts.
    const trig = TRIGGER_OPTIONS.find((t) => t.value === incoming);
    if (trig) {
      if (!templateBody) setTemplateBody(trig.defaultBody);
      if (!templateSubject && trig.defaultSubject) setTemplateSubject(trig.defaultSubject);
      if (trig.scheduled && trig.defaultDelayDays != null && !delayDays) {
        setDelayDays(String(trig.defaultDelayDays));
      }
      if (trig.scheduled) setChannel("email");
    }
  };

  const previewBody = templateBody
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

  const previewSubject = templateSubject
    .replace(/\{\{customerName\}\}/g, "Jane Smith")
    .replace(/\{\{jobNumber\}\}/g, "JOB-1234")
    .replace(/\{\{scheduledDate\}\}/g, "March 29, 2026")
    .replace(/\{\{serviceType\}\}/g, "Window Cleaning")
    .replace(/\{\{invoiceNumber\}\}/g, "INV-100")
    .replace(/\{\{amount\}\}/g, "350.00")
    .replace(/\{\{dueDate\}\}/g, "March 15, 2026")
    .replace(/\{\{planName\}\}/g, "Quarterly Service")
    .replace(/\{\{nextRunDate\}\}/g, "March 30, 2026");

  const createMutation = useCreateAutomation({
    mutation: {
      onSuccess: (rule) => {
        queryClient.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
        toast({ title: "Automation created!" });
        navigate(`/automations/${(rule as { id: number }).id}`);
      },
      onError: () => toast({ title: "Failed to create automation", variant: "destructive" }),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !triggerType || !channel || !templateBody) {
      toast({ title: "Name, trigger, channel, and message body are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      data: {
        name,
        triggerType,
        channel,
        active,
        templateSubject: (channel !== "internal" && templateSubject) ? templateSubject : undefined,
        templateBody,
        delayDays: (selectedTrigger?.scheduled && delayDays) ? parseInt(delayDays, 10) : undefined,
      } as Parameters<typeof createMutation.mutate>[0]["data"],
    });
  };

  return (
    <Layout>
      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Button type="button" variant="ghost" size="icon" onClick={() => navigate("/automations")} className="rounded-xl h-9 w-9">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900">New Automation Rule</h1>
            <p className="text-sm text-muted-foreground">Define a trigger and the message to send.</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Basics */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-slate-900">Basics</h2>
            <div className="space-y-1.5">
              <Label>Rule Name <span className="text-red-500">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Send job reminder the day before"
                className="rounded-xl"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-700">Active</p>
                <p className="text-xs text-slate-400">Enable this rule immediately after creation</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>

          {/* Trigger & Channel */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-slate-900">Trigger & Channel</h2>
            <div className="space-y-1.5">
              <Label>When this happens… <span className="text-red-500">*</span></Label>
              <Select value={triggerType} onValueChange={handleTriggerChange}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select trigger…" />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="font-medium">{t.label}</span>
                      <span className="text-slate-400 ml-1.5 text-xs">{t.desc}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTrigger && (
                <p className="text-xs text-slate-400 mt-1">{selectedTrigger.desc}</p>
              )}
            </div>
            {selectedTrigger?.scheduled && (
              <div className="space-y-1.5">
                <Label>Days Threshold <span className="text-red-500">*</span></Label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={delayDays}
                    onChange={(e) => setDelayDays(e.target.value)}
                    placeholder="90"
                    className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="text-sm text-slate-500">days after last service</span>
                </div>
                <p className="text-xs text-slate-400">Customers who haven't had a job completed in this many days will receive this email (checked daily, once per customer per run).</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Send via <span className="text-red-500">*</span></Label>
              <div className="grid gap-2">
                {CHANNEL_OPTIONS.map((ch) => (
                  <button
                    key={ch.value}
                    type="button"
                    onClick={() => setChannel(ch.value)}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                      channel === ch.value
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-slate-100 bg-white hover:border-slate-200"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex-shrink-0 ${channel === ch.value ? "border-primary bg-primary" : "border-slate-300"}`} />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{ch.label}</p>
                      <p className="text-xs text-slate-400">{ch.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Message Template */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Message Template</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-xl text-slate-500 gap-1.5"
                onClick={() => setPreview(!preview)}
              >
                <Eye className="w-3.5 h-3.5" />
                {preview ? "Edit" : "Preview"}
              </Button>
            </div>

            {selectedTrigger && (
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-slate-500 mb-1.5">Available variables:</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedTrigger.vars.map((v) => (
                    <code
                      key={v}
                      className="text-xs bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-md cursor-pointer hover:bg-primary/5 hover:border-primary/30"
                      onClick={() => {
                        const el = document.getElementById("templateBody") as HTMLTextAreaElement | null;
                        if (el) {
                          const start = el.selectionStart;
                          const end = el.selectionEnd;
                          const newBody = templateBody.substring(0, start) + v + templateBody.substring(end);
                          setTemplateBody(newBody);
                        } else {
                          setTemplateBody((b) => b + v);
                        }
                      }}
                    >
                      {v}
                    </code>
                  ))}
                </div>
              </div>
            )}

            {channel !== "internal" && (
              <div className="space-y-1.5">
                <Label>Subject Line</Label>
                {preview ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700 min-h-[40px]">{previewSubject || "—"}</div>
                ) : (
                  <Input
                    value={templateSubject}
                    onChange={(e) => setTemplateSubject(e.target.value)}
                    placeholder="e.g. Reminder: {{serviceType}} Tomorrow"
                    className="rounded-xl"
                  />
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Message Body <span className="text-red-500">*</span></Label>
              {preview ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 min-h-[100px] whitespace-pre-line">{previewBody || "—"}</div>
              ) : (
                <Textarea
                  id="templateBody"
                  value={templateBody}
                  onChange={(e) => setTemplateBody(e.target.value)}
                  placeholder="Write your message. Click variables above to insert them."
                  className="rounded-xl resize-none min-h-[100px]"
                  rows={5}
                />
              )}
              <p className="text-xs text-slate-400">Use <code className="bg-slate-100 px-1 rounded">{"{{variableName}}"}</code> placeholders — they're replaced with real data at send time.</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pb-8">
            <Button
              type="submit"
              className="flex-1 h-11 rounded-xl shadow-md shadow-primary/20 text-base font-semibold"
              disabled={createMutation.isPending || !name || !triggerType || !templateBody}
            >
              {createMutation.isPending ? "Creating…" : "Create Rule"}
            </Button>
            <Button type="button" variant="outline" className="rounded-xl px-6" onClick={() => navigate("/automations")}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Layout>
  );
}
