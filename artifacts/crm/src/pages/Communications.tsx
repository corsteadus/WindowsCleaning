import { useState, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { protectedFetch } from "@/lib/auth-scope";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Recipient {
  id: number;
  entityType: "customer" | "lead";
  firstName: string;
  lastName: string;
  email: string | null;
  companyName: string | null;
  clientType: string | null;
  status: string | null;
  city: string | null;
  state: string | null;
  lastServiceDate: string | null;
  lastServiceType: string | null;
  tags: string | null;
}

interface BulkFilters {
  entityTypes: "customer" | "lead" | "both";
  clientType: string;
  status: string;
  city: string;
  state: string;
  serviceType: string;
  noServiceDays: string;
  lastServiceBefore: string;
  lastServiceAfter: string;
  tags: string;
  hasEmail: boolean;
}

const BLANK_FILTERS: BulkFilters = {
  entityTypes: "both",
  clientType: "",
  status: "",
  city: "",
  state: "",
  serviceType: "",
  noServiceDays: "",
  lastServiceBefore: "",
  lastServiceAfter: "",
  tags: "",
  hasEmail: true,
};

type BulkStep = "filter" | "select" | "template" | "preview" | "result";

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await protectedFetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

// ─── Template variable pills ──────────────────────────────────────────────────

const TEMPLATE_VARS = [
  "{{first_name}}",
  "{{full_name}}",
  "{{company_name}}",
  "{{service_type}}",
  "{{last_service_date}}",
];

// ─── Template Editor Dialog ───────────────────────────────────────────────────

function TemplateEditorDialog({
  template,
  onClose,
}: {
  template: EmailTemplate | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName]         = useState(template?.name ?? "");
  const [subject, setSubject]   = useState(template?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(template?.bodyHtml ?? "");
  const [bodyText, setBodyText] = useState(template?.bodyText ?? "");
  const [view, setView]         = useState<"edit" | "preview">("edit");
  const [preview, setPreview]   = useState<{ subject: string; bodyHtml: string } | null>(null);
  const [saving, setSaving]     = useState(false);

  const insertVar = useCallback((v: string, field: "subject" | "body") => {
    if (field === "subject") setSubject((s) => s + v);
    else setBodyHtml((b) => b + v);
  }, []);

  async function handleSave() {
    if (!name.trim() || !subject.trim() || !bodyHtml.trim()) {
      toast({ title: "Name, subject, and body are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (template?.id) {
        await apiFetch(`/email-templates/${template.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name, subject, bodyHtml, bodyText }),
        });
        toast({ title: "Template updated" });
      } else {
        await apiFetch("/email-templates", {
          method: "POST",
          body: JSON.stringify({ name, subject, bodyHtml, bodyText }),
        });
        toast({ title: "Template created" });
      }
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      onClose();
    } catch (e: unknown) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    try {
      const data = await apiFetch<{ subject: string; bodyHtml: string }>("/emails/preview", {
        method: "POST",
        body: JSON.stringify({ subject, bodyHtml }),
      });
      setPreview(data);
      setView("preview");
    } catch {
      toast({ title: "Preview failed", variant: "destructive" });
    }
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template?.id ? "Edit Template" : "New Template"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Template Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring Cleaning Outreach" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between mb-1">
              <Label>Subject Line</Label>
              <div className="flex gap-1 flex-wrap justify-end">
                {TEMPLATE_VARS.map((v) => (
                  <button key={v} type="button" onClick={() => insertVar(v, "subject")}
                    className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-100 font-mono">
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hi {{first_name}}, time to get your windows sparkling!" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-3">
                <Label>Email Body (HTML)</Label>
                <button type="button" onClick={() => view === "edit" ? handlePreview() : setView("edit")}
                  className="text-xs text-blue-600 hover:underline">
                  {view === "edit" ? "Preview with sample data" : "← Back to editor"}
                </button>
              </div>
              <div className="flex gap-1 flex-wrap justify-end">
                {TEMPLATE_VARS.map((v) => (
                  <button key={v} type="button" onClick={() => insertVar(v, "body")}
                    className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-100 font-mono">
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {view === "edit" ? (
              <Textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)}
                rows={12} className="font-mono text-sm"
                placeholder={"<p>Hi {{first_name}},</p>\n<p>Your message here...</p>"} />
            ) : (
              <div className="border rounded-lg p-5 min-h-[200px] bg-white">
                {preview ? (
                  <div dangerouslySetInnerHTML={{ __html: preview.bodyHtml }} className="prose prose-sm max-w-none" />
                ) : (
                  <div className="text-slate-400 text-sm italic">Loading preview…</div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label>Plain Text Fallback <span className="text-slate-400 font-normal text-xs">(optional)</span></Label>
            <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={3} placeholder="Plain text version of your email…" />
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-600 mb-2">Template variable reference</p>
            <div className="grid grid-cols-2 gap-1">
              {[
                ["{{first_name}}", "Customer's first name"],
                ["{{full_name}}", "First + last name"],
                ["{{company_name}}", "Business / company name"],
                ["{{service_type}}", "Most recent service type"],
                ["{{last_service_date}}", "Date of last completed job"],
              ].map(([v, label]) => (
                <div key={v} className="text-[11px] text-slate-600">
                  <span className="font-mono bg-slate-100 px-1 rounded text-slate-700">{v}</span>
                  <span className="text-slate-400 ml-1">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : template?.id ? "Save Changes" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing]     = useState<EmailTemplate | null | undefined>(undefined); // undefined = closed
  const [deleting, setDeleting]   = useState<EmailTemplate | null>(null);
  const [previewTpl, setPreviewTpl] = useState<{ name: string; html: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["email-templates"],
    queryFn: () => apiFetch<{ templates: EmailTemplate[] }>("/email-templates"),
  });
  const templates = data?.templates ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/email-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      toast({ title: "Template deleted" });
      setDeleting(null);
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  async function handlePreview(t: EmailTemplate) {
    try {
      const data = await apiFetch<{ bodyHtml: string }>("/emails/preview", {
        method: "POST",
        body: JSON.stringify({ templateId: t.id }),
      });
      setPreviewTpl({ name: t.name, html: data.bodyHtml });
    } catch {
      toast({ title: "Preview failed", variant: "destructive" });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Email Templates</h2>
          <p className="text-sm text-slate-500 mt-0.5">Reusable templates with variable substitution for personalized outreach</p>
        </div>
        <Button onClick={() => setEditing(null)} className="gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Template
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-xl">
          <svg className="w-10 h-10 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
          <p className="text-slate-500 font-medium">No templates yet</p>
          <Button onClick={() => setEditing(null)} variant="outline" className="mt-4">Create Template</Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map((t) => (
            <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-4 hover:border-slate-300 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-slate-800 truncate">{t.name}</span>
                  {t.isDefault && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                </div>
                <p className="text-sm text-slate-500 truncate font-mono">{t.subject}</p>
                <p className="text-xs text-slate-400 mt-1.5">Updated {new Date(t.updatedAt).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => handlePreview(t)}>Preview</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button>
                <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setDeleting(t)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== undefined && (
        <TemplateEditorDialog template={editing} onClose={() => setEditing(undefined)} />
      )}

      {deleting && (
        <Dialog open onOpenChange={() => setDeleting(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Delete Template</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-600">Delete <strong>"{deleting.name}"</strong>? This cannot be undone.</p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => deleteMut.mutate(deleting.id)} disabled={deleteMut.isPending}>
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {previewTpl && (
        <Dialog open onOpenChange={() => setPreviewTpl(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Preview — {previewTpl.name}</DialogTitle></DialogHeader>
            <div className="border rounded-lg p-5 bg-white">
              <div dangerouslySetInnerHTML={{ __html: previewTpl.html }} className="prose prose-sm max-w-none" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreviewTpl(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Bulk Email Wizard ────────────────────────────────────────────────────────

function BulkEmailTab() {
  const { toast } = useToast();
  const [step, setStep]             = useState<BulkStep>("filter");
  const [filters, setFilters]       = useState<BulkFilters>(BLANK_FILTERS);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selected, setSelected]     = useState<Set<number>>(new Set());
  const [loading, setLoading]       = useState(false);
  const [chosenTemplate, setChosenTemplate] = useState<EmailTemplate | null | undefined>(undefined);
  const [manualSubject, setManualSubject]   = useState("");
  const [manualBodyHtml, setManualBodyHtml] = useState("");
  const [preview, setPreview]       = useState<{ subject: string; bodyHtml: string } | null>(null);
  const [sending, setSending]       = useState(false);
  const [sendResult, setSendResult] = useState<{ campaignId: number; queued: number; skipped: number } | null>(null);

  const { data: tplData } = useQuery({
    queryKey: ["email-templates"],
    queryFn: () => apiFetch<{ templates: EmailTemplate[] }>("/email-templates"),
  });
  const templates = tplData?.templates ?? [];

  const recipientsWithEmail = recipients.filter((r) => r.email);
  const selectedWithEmail   = recipients.filter((r) => selected.has(r.id) && r.email);
  const noEmailCount        = recipients.filter((r) => !r.email).length;

  function buildQs() {
    const p = new URLSearchParams();
    p.set("entityTypes", filters.entityTypes);
    if (filters.clientType)       p.set("clientType",         filters.clientType);
    if (filters.status)           p.set("status",             filters.status);
    if (filters.city)             p.set("city",               filters.city);
    if (filters.state)            p.set("state",              filters.state);
    if (filters.serviceType)      p.set("serviceType",        filters.serviceType);
    if (filters.noServiceDays)    p.set("noServiceDays",      filters.noServiceDays);
    if (filters.lastServiceBefore) p.set("lastServiceBefore", filters.lastServiceBefore);
    if (filters.lastServiceAfter)  p.set("lastServiceAfter",  filters.lastServiceAfter);
    if (filters.tags)             p.set("tags",               filters.tags);
    if (filters.hasEmail)         p.set("hasEmail",           "true");
    return p.toString();
  }

  async function handleFilter() {
    setLoading(true);
    try {
      const data = await apiFetch<{ recipients: Recipient[] }>(`/emails/recipients?${buildQs()}`);
      setRecipients(data.recipients);
      setSelected(new Set(data.recipients.filter((r) => r.email).map((r) => r.id)));
      setStep("select");
    } catch (e: unknown) {
      toast({ title: "Filter failed", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview() {
    const id      = chosenTemplate?.id;
    const subject = chosenTemplate?.subject  ?? manualSubject;
    const body    = chosenTemplate?.bodyHtml ?? manualBodyHtml;
    try {
      const data = await apiFetch<{ subject: string; bodyHtml: string }>("/emails/preview", {
        method: "POST",
        body: JSON.stringify({ templateId: id, subject, bodyHtml: body }),
      });
      setPreview(data);
      setStep("preview");
    } catch (e: unknown) {
      toast({ title: "Preview failed", description: String(e), variant: "destructive" });
    }
  }

  async function handleSend() {
    setSending(true);
    try {
      const data = await apiFetch<{ campaignId: number; queued: number; skipped: number; status: string }>("/emails/send", {
        method: "POST",
        body: JSON.stringify({
          recipients: selectedWithEmail.map((r) => ({
            id: r.id, entityType: r.entityType, email: r.email,
            firstName: r.firstName, lastName: r.lastName,
            companyName: r.companyName, lastServiceDate: r.lastServiceDate,
            lastServiceType: r.lastServiceType,
          })),
          templateId:   chosenTemplate?.id,
          subject:      chosenTemplate ? undefined : manualSubject,
          bodyHtml:     chosenTemplate ? undefined : manualBodyHtml,
          classification: "marketing",
          campaignName: chosenTemplate?.name ?? undefined,
        }),
      });
      setSendResult({ campaignId: data.campaignId, queued: data.queued, skipped: data.skipped });
      setStep("result");
    } catch (e: unknown) {
      toast({ title: "Send failed", description: String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setStep("filter"); setFilters(BLANK_FILTERS); setRecipients([]); setSelected(new Set());
    setChosenTemplate(undefined); setManualSubject(""); setManualBodyHtml(""); setPreview(null); setSendResult(null);
  }

  // ── Step breadcrumb ─────────────────────────────────────────────────────────
  const STEPS: { key: BulkStep; label: string }[] = [
    { key: "filter",   label: "Filter" },
    { key: "select",   label: "Select" },
    { key: "template", label: "Template" },
    { key: "preview",  label: "Preview" },
    { key: "result",   label: "Done" },
  ];
  const stepIdx = STEPS.findIndex((s) => s.key === step);

  const StepBar = () => (
    <div className="flex items-center gap-0 mb-7">
      {STEPS.map((s, i) => {
        const done    = i < stepIdx;
        const current = i === stepIdx;
        return (
          <div key={s.key} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
              current ? "bg-primary text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
            }`}>
              {done ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
              )}
              {s.label}
            </div>
            {i < STEPS.length - 1 && <div className="w-6 h-px bg-slate-200 mx-0.5" />}
          </div>
        );
      })}
    </div>
  );

  // ── Step 1: Filter ──────────────────────────────────────────────────────────
  if (step === "filter") return (
    <div className="max-w-2xl">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-800">Bulk Email Campaigns</h2>
        <p className="text-sm text-slate-500 mt-0.5">Define your audience, choose a template, preview, and send.</p>
      </div>
      <StepBar />

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Send To</Label>
            <Select value={filters.entityTypes} onValueChange={(v) => setFilters((f) => ({ ...f, entityTypes: v as BulkFilters["entityTypes"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Customers &amp; Leads</SelectItem>
                <SelectItem value="customer">Customers Only</SelectItem>
                <SelectItem value="lead">Leads Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Client Type</Label>
            <Select value={filters.clientType || "any"} onValueChange={(v) => setFilters((f) => ({ ...f, clientType: v === "any" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="residential">Residential</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={filters.status || "any"} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "any" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>No Service In Last…</Label>
            <Select value={filters.noServiceDays || "any"} onValueChange={(v) => setFilters((f) => ({ ...f, noServiceDays: v === "any" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="120">120 days</SelectItem>
                <SelectItem value="180">6 months</SelectItem>
                <SelectItem value="365">12 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>City</Label>
            <Input value={filters.city} onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))} placeholder="Any city" />
          </div>
          <div className="space-y-1">
            <Label>State</Label>
            <Input value={filters.state} onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))} placeholder="FL, TX…" />
          </div>
          <div className="space-y-1">
            <Label>Service Type</Label>
            <Input value={filters.serviceType} onChange={(e) => setFilters((f) => ({ ...f, serviceType: e.target.value }))} placeholder="Window cleaning, gutters…" />
          </div>
          <div className="space-y-1">
            <Label>Tags</Label>
            <Input value={filters.tags} onChange={(e) => setFilters((f) => ({ ...f, tags: e.target.value }))} placeholder="vip, referral, HOA…" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Last Service Before</Label>
            <Input type="date" value={filters.lastServiceBefore} onChange={(e) => setFilters((f) => ({ ...f, lastServiceBefore: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Last Service After</Label>
            <Input type="date" value={filters.lastServiceAfter} onChange={(e) => setFilters((f) => ({ ...f, lastServiceAfter: e.target.value }))} />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input type="checkbox" checked={filters.hasEmail} onChange={(e) => setFilters((f) => ({ ...f, hasEmail: e.target.checked }))}
            className="w-4 h-4 rounded border-slate-300 accent-primary" />
          <span className="text-sm text-slate-700">Only include records with an email address</span>
        </label>
      </div>

      <div className="flex justify-end mt-4">
        <Button onClick={handleFilter} disabled={loading} className="gap-2">
          {loading ? "Searching…" : "Find Recipients →"}
        </Button>
      </div>
    </div>
  );

  // ── Step 2: Select ──────────────────────────────────────────────────────────
  if (step === "select") return (
    <div>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-800">Select Recipients</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {recipients.length} found
          · <strong>{selectedWithEmail.length}</strong> selected with email
          {noEmailCount > 0 && <span className="text-amber-600"> · {noEmailCount} have no email (skipped)</span>}
        </p>
      </div>
      <StepBar />

      <div className="flex gap-2 mb-3">
        <Button variant="outline" size="sm" onClick={() => setStep("filter")}>← Adjust Filters</Button>
        <Button size="sm" onClick={() => setSelected(new Set(recipientsWithEmail.map((r) => r.id)))}>Select All ({recipientsWithEmail.length})</Button>
        <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Deselect All</Button>
      </div>

      {recipients.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-xl">
          <p className="text-slate-500 font-medium">No records match your filters</p>
          <Button variant="outline" className="mt-4" onClick={() => setStep("filter")}>← Adjust Filters</Button>
        </div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 text-left w-8">
                    <input type="checkbox"
                      checked={selectedWithEmail.length === recipientsWithEmail.length && recipientsWithEmail.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelected(new Set(recipientsWithEmail.map((r) => r.id)));
                        else setSelected(new Set());
                      }}
                      className="w-4 h-4 rounded border-slate-300 accent-primary"
                    />
                  </th>
                  <th className="py-2.5 px-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Name</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Email</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Type</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">City</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Last Service</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recipients.map((r) => (
                  <tr key={`${r.entityType}-${r.id}`} className={`transition-colors ${!r.email ? "opacity-40" : "hover:bg-slate-50"}`}>
                    <td className="py-2.5 px-3">
                      <input type="checkbox" disabled={!r.email}
                        checked={selected.has(r.id) && !!r.email}
                        onChange={(e) => {
                          const next = new Set(selected);
                          e.target.checked ? next.add(r.id) : next.delete(r.id);
                          setSelected(next);
                        }}
                        className="w-4 h-4 rounded border-slate-300 accent-primary"
                      />
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-800">
                      {r.firstName} {r.lastName}
                      {r.companyName && <span className="text-slate-400 text-xs font-normal ml-1">({r.companyName})</span>}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 text-xs">{r.email ?? <span className="text-amber-500 italic">No email</span>}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex gap-1">
                        <Badge variant="outline" className="text-[10px] py-0">{r.entityType}</Badge>
                        {r.clientType && <Badge variant="outline" className="text-[10px] py-0">{r.clientType}</Badge>}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 text-xs">{r.city ?? "—"}</td>
                    <td className="py-2.5 px-3 text-slate-500 text-xs">
                      {r.lastServiceDate ? new Date(r.lastServiceDate).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setStep("template")} disabled={selectedWithEmail.length === 0} className="gap-2">
              Continue with {selectedWithEmail.length} recipients →
            </Button>
          </div>
        </>
      )}
    </div>
  );

  // ── Step 3: Template ────────────────────────────────────────────────────────
  if (step === "template") return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Choose a Template</h2>
          <p className="text-sm text-slate-500 mt-0.5">Sending to {selectedWithEmail.length} recipients</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setStep("select")}>← Back</Button>
      </div>
      <StepBar />

      <div className="grid gap-3 mb-5">
        {templates.map((t) => (
          <div key={t.id} onClick={() => setChosenTemplate(t)}
            className={`bg-white border-2 rounded-xl p-4 cursor-pointer transition-all ${
              chosenTemplate?.id === t.id ? "border-primary bg-primary/5" : "border-slate-200 hover:border-slate-300"
            }`}>
            <div className="flex items-center gap-2.5">
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                chosenTemplate?.id === t.id ? "border-primary" : "border-slate-300"
              }`}>
                {chosenTemplate?.id === t.id && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <span className="font-semibold text-slate-800">{t.name}</span>
              {t.isDefault && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
            </div>
            <p className="text-sm text-slate-500 mt-1 ml-6.5 truncate font-mono">{t.subject}</p>
          </div>
        ))}

        <div onClick={() => setChosenTemplate(null)}
          className={`bg-white border-2 rounded-xl p-4 cursor-pointer transition-all ${
            chosenTemplate === null ? "border-primary bg-primary/5" : "border-dashed border-slate-300 hover:border-slate-400"
          }`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${chosenTemplate === null ? "border-primary" : "border-slate-300"}`}>
              {chosenTemplate === null && <div className="w-2 h-2 rounded-full bg-primary" />}
            </div>
            <span className="font-semibold text-slate-700">Write a custom message</span>
          </div>
        </div>
      </div>

      {chosenTemplate === null && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 mb-4">
          <div className="space-y-1">
            <Label>Subject</Label>
            <Input value={manualSubject} onChange={(e) => setManualSubject(e.target.value)} placeholder="Your subject line — use {{first_name}} for personalization" />
          </div>
          <div className="space-y-1">
            <Label>Body (HTML)</Label>
            <Textarea value={manualBodyHtml} onChange={(e) => setManualBodyHtml(e.target.value)} rows={8}
              placeholder={"<p>Hi {{first_name}},</p>\n<p>Your message here...</p>"} className="font-mono text-sm" />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handlePreview}
          disabled={chosenTemplate === undefined || (chosenTemplate === null && (!manualSubject || !manualBodyHtml))}
          className="gap-2">
          Preview →
        </Button>
      </div>
    </div>
  );

  // ── Step 4: Preview ─────────────────────────────────────────────────────────
  if (step === "preview") return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Email Preview</h2>
          <p className="text-sm text-slate-500 mt-0.5">Rendered with sample data. Ready to send to <strong>{selectedWithEmail.length}</strong> recipients.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setStep("template")}>← Back</Button>
      </div>
      <StepBar />

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5 space-y-4">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Subject</p>
          <p className="text-slate-800 font-semibold">{preview?.subject}</p>
        </div>
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Body (sample recipient: John Smith)</p>
          <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: preview?.bodyHtml ?? "" }} />
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
        <div className="flex gap-3">
          <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="font-semibold text-amber-800 text-sm">Confirm before sending</p>
            <p className="text-amber-700 text-sm mt-0.5">
              You are about to send <strong>{selectedWithEmail.length} emails</strong>. Each recipient gets a personalized copy. This cannot be undone.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSend} disabled={sending} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
          {sending ? "Sending…" : `Send ${selectedWithEmail.length} Emails`}
        </Button>
      </div>
    </div>
  );

  // ── Step 5: Result — live campaign status ───────────────────────────────────
  return <CampaignStatusView campaignId={sendResult!.campaignId} queued={sendResult!.queued} skipped={sendResult!.skipped} onReset={reset} />;
}

// ─── Campaign interfaces ──────────────────────────────────────────────────────

interface Campaign {
  id: number;
  name: string;
  status: string;
  totalRecipients: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  permanentlyFailedCount: number;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  automationRuleId: number | null;
}

// ─── Campaign Status Card ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  queued:           "bg-sky-100 text-sky-700 border-sky-300",
  processing:       "bg-amber-100 text-amber-700 border-amber-300",
  completed:        "bg-emerald-100 text-emerald-700 border-emerald-300",
  partially_failed: "bg-orange-100 text-orange-700 border-orange-300",
  failed:           "bg-red-100 text-red-700 border-red-300",
  cancelled:        "bg-slate-100 text-slate-500 border-slate-300",
};

function CampaignBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block border rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-500 border-slate-300"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Campaign Status View (after send) ───────────────────────────────────────

function CampaignStatusView({ campaignId, queued, skipped, onReset }: {
  campaignId: number;
  queued: number;
  skipped: number;
  onReset: () => void;
}) {
  const { data, refetch } = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => apiFetch<{ campaign: Campaign }>(`/campaigns/${campaignId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.campaign?.status;
      return !status || ["queued","processing"].includes(status) ? 5000 : false;
    },
  });

  const campaign = data?.campaign;
  const isDone = campaign && !["queued","processing"].includes(campaign.status);

  const handleCancel = async () => {
    try {
      await apiFetch(`/campaigns/${campaignId}/cancel`, { method: "POST" });
      refetch();
    } catch (e: unknown) {
      alert(String(e));
    }
  };

  const total = campaign?.totalRecipients ?? queued;
  const sent  = campaign?.sentCount ?? 0;
  const failed = (campaign?.failedCount ?? 0) + (campaign?.permanentlyFailedCount ?? 0);
  const remaining = campaign?.queuedCount ?? queued;
  const pct = total > 0 ? Math.round(((sent + failed) / total) * 100) : 0;

  return (
    <div className="max-w-lg mx-auto py-8">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
        <div className="mb-5">
          {isDone ? (
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-sky-100 flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-sky-500 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36-6.36-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707" />
              </svg>
            </div>
          )}
        </div>

        <h2 className="text-xl font-bold text-slate-800 mb-1">
          {isDone ? "Campaign Complete" : "Campaign Queued"}
        </h2>

        {campaign && <div className="mb-3"><CampaignBadge status={campaign.status} /></div>}

        <p className="text-sm text-slate-500 mb-5">
          {!isDone
            ? `Sending to ${total.toLocaleString()} recipients in batches. This page updates automatically every 5 seconds.`
            : `Finished processing ${total.toLocaleString()} recipients.`}
        </p>

        {/* Progress bar */}
        <div className="mb-5">
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
            <div
              className="h-2 bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">{pct}% processed</p>
        </div>

        <div className="flex justify-center gap-8 mb-5">
          <div>
            <p className="text-2xl font-bold text-emerald-600">{sent.toLocaleString()}</p>
            <p className="text-xs text-slate-500">Sent</p>
          </div>
          {remaining > 0 && (
            <div>
              <p className="text-2xl font-bold text-sky-500">{remaining.toLocaleString()}</p>
              <p className="text-xs text-slate-500">Queued</p>
            </div>
          )}
          {failed > 0 && (
            <div>
              <p className="text-2xl font-bold text-red-500">{failed.toLocaleString()}</p>
              <p className="text-xs text-slate-500">Failed</p>
            </div>
          )}
          {skipped > 0 && (
            <div>
              <p className="text-2xl font-bold text-slate-400">{skipped.toLocaleString()}</p>
              <p className="text-xs text-slate-500">Skipped (no email)</p>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 mb-6">Campaign ID #{campaignId} — deliveries are logged to each recipient's activity timeline.</p>

        <div className="flex gap-3 justify-center">
          {!isDone && (
            <Button variant="outline" size="sm" onClick={handleCancel} className="text-red-600 border-red-200 hover:bg-red-50">
              Cancel Campaign
            </Button>
          )}
          <Button onClick={onReset} variant={isDone ? "default" : "outline"} size="sm">
            Send Another Campaign
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Campaigns History Tab ────────────────────────────────────────────────────

function CampaignsTab() {
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => apiFetch<{ campaigns: Campaign[]; total: number }>("/campaigns"),
    refetchInterval: 10000,
  });

  const campaigns = data?.campaigns ?? [];

  const handleRetry = async (id: number) => {
    try {
      await apiFetch(`/campaigns/${id}/retry-failed`, { method: "POST" });
      refetch();
    } catch (e: unknown) {
      alert(String(e));
    }
  };

  const handleCancel = async (id: number) => {
    try {
      await apiFetch(`/campaigns/${id}/cancel`, { method: "POST" });
      refetch();
    } catch (e: unknown) {
      alert(String(e));
    }
  };

  if (isLoading) return <p className="text-slate-500 text-sm py-4">Loading…</p>;

  if (campaigns.length === 0) return (
    <div className="text-center py-16 text-slate-400">
      <p className="text-lg font-medium mb-2">No campaigns yet</p>
      <p className="text-sm">Bulk sends appear here once you launch one.</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">{data?.total ?? 0} total campaigns — page refreshes every 10 seconds</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Refresh</Button>
      </div>
      <div className="space-y-3">
        {campaigns.map((c) => {
          const inProgress = ["queued","processing"].includes(c.status);
          const total = c.totalRecipients;
          const pct = total > 0 ? Math.round(((c.sentCount + c.failedCount + c.permanentlyFailedCount) / total) * 100) : 0;
          return (
            <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-slate-800 text-sm truncate">{c.name}</p>
                    <CampaignBadge status={c.status} />
                    {c.automationRuleId && (
                      <span className="text-[10px] bg-violet-100 text-violet-700 border border-violet-200 rounded-full px-1.5 py-0.5 font-medium">Auto</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    #{c.id} · {new Date(c.createdAt).toLocaleString()}
                    {c.completedAt && ` · Done ${new Date(c.completedAt).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {inProgress && (
                    <Button variant="outline" size="sm" onClick={() => handleCancel(c.id)} className="text-xs text-red-600 border-red-200 hover:bg-red-50">
                      Cancel
                    </Button>
                  )}
                  {c.permanentlyFailedCount > 0 && !inProgress && (
                    <Button variant="outline" size="sm" onClick={() => handleRetry(c.id)} className="text-xs">
                      Retry {c.permanentlyFailedCount} failed
                    </Button>
                  )}
                </div>
              </div>

              {/* Progress */}
              <div className="mt-3">
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
                  <div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex gap-5 text-xs text-slate-500">
                  <span><strong className="text-slate-800">{total.toLocaleString()}</strong> total</span>
                  <span><strong className="text-emerald-600">{c.sentCount.toLocaleString()}</strong> sent</span>
                  {c.queuedCount > 0 && <span><strong className="text-sky-600">{c.queuedCount.toLocaleString()}</strong> queued</span>}
                  {c.failedCount > 0 && <span><strong className="text-amber-600">{c.failedCount.toLocaleString()}</strong> retrying</span>}
                  {c.permanentlyFailedCount > 0 && <span><strong className="text-red-600">{c.permanentlyFailedCount.toLocaleString()}</strong> permanently failed</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type CommTab = "templates" | "bulk" | "campaigns";

const TAB_LABELS: Record<CommTab, string> = {
  templates: "Email Templates",
  bulk:      "Bulk Email",
  campaigns: "Campaign History",
};

export default function Communications() {
  const [tab, setTab] = useState<CommTab>("templates");

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Communications</h1>
          <p className="text-slate-500 text-sm mt-1">
            Manage email templates, send targeted campaigns, and track delivery status
          </p>
        </div>

        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit mb-6">
          {(["templates", "bulk", "campaigns"] as CommTab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                tab === t ? "bg-white shadow-sm text-slate-900" : "text-slate-600 hover:text-slate-900"
              }`}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {tab === "templates" && <TemplatesTab />}
        {tab === "bulk"      && <BulkEmailTab />}
        {tab === "campaigns" && <CampaignsTab />}
      </div>
    </Layout>
  );
}
