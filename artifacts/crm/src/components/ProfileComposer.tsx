/**
 * Write to a profile — A5 (Kyle, Video 8): "you can send a personalized email,
 * you can send a text message, or you can print a letter", each from a saved
 * template or from scratch. One dialog, three tabs; on the right, the message
 * exactly as this customer will get it (the server fills the tags from the
 * record). Templates are used, saved, changed and deleted right here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, FileText, Loader2, Mail, MessageSquare, Printer, Save, Send, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { protectedFetch } from "@/lib/auth-scope";
import { estimateCall } from "@/lib/estimate-actions";
import { formatPhoneAsTyped } from "@/lib/phone-format";
import {
  CHANNEL_LABEL, differsFromTemplate, groupTags, insertTag, smsLengthLabel, templateText,
  type MessageChannel, type MessagePreview, type MessageTemplate, type ProfileTagInfo,
} from "@/lib/profile-messages";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const FIELD = "w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";
const LABEL = "block text-[11px] font-semibold uppercase tracking-wide text-slate-400";
const BUTTON = "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50";

const STARTERS: Record<MessageChannel, { subject: string; body: string }> = {
  email: { subject: "", body: "Hi {{first_name}},\n\n\n\nThank you,\n{{sender_name}}\n{{business_name}}" },
  sms: { subject: "", body: "Hi {{first_name}}, this is {{sender_name}} with {{business_name}}. " },
  letter: { subject: "", body: "Dear {{salutation}},\n\n\n\nSincerely,\n\n\n{{sender_name}}\n{{business_name}}" },
};
const ICON = { email: Mail, sms: MessageSquare, letter: FileText } as const;

export interface ComposerProfile {
  id: number;
  firstName: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export function ProfileComposer({ open, onOpenChange, profile, channel: initialChannel, emailTo, initial, canManageTemplates, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: ComposerProfile;
  channel: MessageChannel;
  /** Which of the profile's addresses the email goes to. */
  emailTo?: string | null;
  /** Resend: an earlier email's subject and text. */
  initial?: { subject: string; body: string } | null;
  canManageTemplates: boolean;
  onDone: (what: { channel: MessageChannel; message: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<MessageChannel>(initialChannel);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastField = useRef<"subject" | "body">("body");
  const sendKey = useRef("");

  const reset = (next: MessageChannel, start?: { subject: string; body: string } | null) => {
    setChannel(next);
    setSubject(start?.subject ?? STARTERS[next].subject);
    setBody(start?.body ?? STARTERS[next].body);
    setTemplate(null); setSaveName(null); setConfirmDelete(false); setError(null); setNotice(null);
  };
  useEffect(() => { if (open) reset(initialChannel, initial); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new key whenever the message changes: a double click sends once, an edited retry is a new email.
  useEffect(() => { sendKey.current = crypto.randomUUID(); }, [subject, body, emailTo, channel]);

  const tags = useQuery({
    queryKey: ["message-tags"],
    queryFn: () => estimateCall<{ profileTags: ProfileTagInfo[] }>("/email-templates/tags").then((r) => r.profileTags),
    enabled: open, staleTime: Infinity,
  });
  const templates = useQuery({
    queryKey: ["message-templates", channel],
    queryFn: () => estimateCall<{ templates: MessageTemplate[] }>(`/email-templates?channel=${channel}`).then((r) => r.templates),
    enabled: open,
  });

  // What the customer will get, filled by the server; a short pause after typing.
  const [debounced, setDebounced] = useState({ subject, body, channel });
  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ subject, body, channel }), 350);
    return () => clearTimeout(timer);
  }, [subject, body, channel]);
  const preview = useQuery({
    queryKey: ["message-preview", profile.id, debounced],
    queryFn: () => estimateCall<MessagePreview>(`/profile-messages/${profile.id}/preview`, {
      method: "POST", body: JSON.stringify({ channel: debounced.channel, subject: debounced.subject, body: debounced.body }),
    }),
    enabled: open && debounced.body.trim().length > 0,
    retry: false,
    placeholderData: (previous) => previous,
  });
  const previewError = preview.error instanceof Error ? preview.error.message : null;
  const typing = debounced.subject !== subject || debounced.body !== body || debounced.channel !== channel;

  const chooseTemplate = (id: string) => {
    if (!id) { reset(channel); return; }
    const chosen = templates.data?.find((t) => String(t.id) === id);
    if (!chosen) return;
    setTemplate(chosen);
    setSubject(chosen.subject);
    setBody(templateText(chosen));
    setSaveName(null); setConfirmDelete(false); setError(null); setNotice(null);
  };

  const putTag = (tag: string) => {
    if (!tag) return;
    const intoSubject = lastField.current === "subject" && channel !== "sms";
    const box = intoSubject ? subjectRef.current : bodyRef.current;
    const value = intoSubject ? subject : body;
    const start = box?.selectionStart ?? value.length;
    const end = box?.selectionEnd ?? value.length;
    const next = insertTag(value, start, end, tag);
    if (intoSubject) setSubject(next.text); else setBody(next.text);
    requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(next.cursor, next.cursor); });
  };

  // A6: what was just sent or printed shows in the profile's communication history at once.
  const refreshHistory = () => queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes("communication-history") });
  const refreshTemplates = () => queryClient.invalidateQueries({ queryKey: ["message-templates", channel] });
  const saveTemplate = useMutation({
    mutationFn: (mode: "new" | "update") => estimateCall<MessageTemplate>(
      mode === "new" ? "/email-templates" : `/email-templates/${template!.id}`,
      { method: mode === "new" ? "POST" : "PATCH", body: JSON.stringify({ channel, name: mode === "new" ? saveName : template!.name, subject, bodyText: body }) },
    ),
    onSuccess: async (saved, mode) => {
      await refreshTemplates();
      setTemplate(saved); setSaveName(null); setError(null);
      setNotice(mode === "new" ? `Saved as “${saved.name}”.` : `“${saved.name}” updated.`);
    },
    onError: (e: Error) => setError(e.message),
  });
  const deleteTemplate = useMutation({
    mutationFn: () => estimateCall(`/email-templates/${template!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      const name = template!.name;
      await refreshTemplates();
      setTemplate(null); setConfirmDelete(false); setNotice(`“${name}” deleted. What you wrote is still here.`);
    },
    onError: (e: Error) => { setConfirmDelete(false); setError(e.message); },
  });

  const sendEmail = useMutation({
    mutationFn: async () => {
      const res = await protectedFetch(`${BASE}/api/emails/send-one`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": sendKey.current },
        body: JSON.stringify({ entityType: "customer", entityId: profile.id, email: emailTo ?? profile.email, subject, bodyText: body, templateId: template?.id ?? null }),
      });
      const result = await res.json().catch(() => ({})) as { error?: string; reasonCode?: string; message?: string };
      if (!res.ok) {
        throw new Error(result.error ?? result.message
          ?? (result.reasonCode ? `Not sent: this customer's email settings do not allow it (${result.reasonCode.replace(/_/g, " ")}).` : "The email could not be sent"));
      }
    },
    onSuccess: () => {
      refreshHistory();
      onDone({ channel: "email", message: `Email sent to ${emailTo ?? profile.email}` });
    },
    onError: (e: Error) => setError(e.message),
  });

  const printLetter = useMutation({
    mutationFn: async () => {
      // Opened first, so the browser treats it as the click's own window.
      const tab = window.open("", "_blank");
      const res = await protectedFetch(`${BASE}/api/profile-messages/${profile.id}/letter`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, templateId: template?.id ?? null }),
      });
      if (!res.ok) {
        tab?.close();
        const result = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? "The letter could not be made");
      }
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url; else window.location.assign(url);
    },
    onSuccess: () => { refreshHistory(); setError(null); setNotice("The letter opened in a new tab — print it from there."); },
    onError: (e: Error) => setError(e.message),
  });

  const copyText = async () => {
    const text = preview.data?.text;
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setNotice("Copied — paste it into your phone's messages."); }
    catch { setError("The browser would not copy it. Select the preview and copy it by hand."); }
  };

  const changed = differsFromTemplate(template, subject, body);
  const groups = useMemo(() => groupTags(tags.data ?? []), [tags.data]);
  const Icon = ICON[channel];
  const busy = sendEmail.isPending || printLetter.isPending || saveTemplate.isPending || deleteTemplate.isPending;
  const blocked = !body.trim() || !!previewError || typing || preview.isFetching;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="profile-composer">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Icon className="w-4 h-4 text-primary" /> Write to {profile.name}</DialogTitle>
          <DialogDescription className="sr-only">An email, a text or a printed letter, from a saved template or written here.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit" role="tablist">
          {(["email", "sms", "letter"] as MessageChannel[]).map((c) => {
            const TabIcon = ICON[c];
            return (
              <button key={c} type="button" role="tab" aria-selected={channel === c} data-testid={`composer-tab-${c}`}
                disabled={busy}
                onClick={() => channel !== c && reset(c)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${channel === c ? "bg-white shadow-sm text-slate-900" : "text-slate-600 hover:text-slate-900"}`}>
                <TabIcon className="w-3.5 h-3.5" /> {CHANNEL_LABEL[c]}
              </button>
            );
          })}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {/* ── Left: what the office writes ─────────────────────────────── */}
          <div className="space-y-3 min-w-0">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600" data-testid="composer-to">
              {channel === "email" && <>To: <span className="font-semibold text-slate-800">{emailTo ?? profile.email ?? "no email on this profile"}</span></>}
              {channel === "sms" && <>To: <span className="font-semibold text-slate-800">{profile.phone ? formatPhoneAsTyped(profile.phone) : "no phone on this profile"}</span></>}
              {channel === "letter" && <>Printed and mailed to the profile's mailing address.</>}
            </div>

            <div className="space-y-1">
              <label className={LABEL} htmlFor="composer-template">Template</label>
              <div className="flex gap-2">
                <select id="composer-template" data-testid="composer-template" className={`${FIELD} h-9`} disabled={busy}
                  value={template ? String(template.id) : ""} onChange={(e) => chooseTemplate(e.target.value)}>
                  <option value="">{templates.isLoading ? "Loading…" : `Write from scratch${templates.data?.length ? "" : " (no saved templates yet)"}`}</option>
                  {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {canManageTemplates && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {template && changed && (
                    <button type="button" className={BUTTON} data-testid="composer-update-template" disabled={busy || !!previewError}
                      onClick={() => saveTemplate.mutate("update")}>
                      <Save className="w-3.5 h-3.5" /> Save changes to “{template.name}”
                    </button>
                  )}
                  {saveName === null ? (
                    <button type="button" className={BUTTON} data-testid="composer-save-new" disabled={busy || !body.trim()}
                      onClick={() => { setSaveName(template ? `${template.name} (copy)` : ""); setNotice(null); }}>
                      <Save className="w-3.5 h-3.5" /> Save as new template
                    </button>
                  ) : (
                    <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); saveTemplate.mutate("new"); }}>
                      <input autoFocus className={`${FIELD} h-8`} placeholder="Template name" value={saveName} maxLength={120}
                        data-testid="composer-template-name" onChange={(e) => setSaveName(e.target.value)} />
                      <button type="submit" className={BUTTON} disabled={busy || !saveName.trim()} data-testid="composer-template-save">Save</button>
                      <button type="button" className={BUTTON} onClick={() => setSaveName(null)}>Cancel</button>
                    </form>
                  )}
                  {template && (confirmDelete ? (
                    <span className="inline-flex items-center gap-2 text-xs text-red-700" data-testid="composer-delete-confirm">
                      Delete “{template.name}” for everyone?
                      <button type="button" className={`${BUTTON} border-red-200 text-red-700 hover:bg-red-50`} disabled={busy}
                        data-testid="composer-delete-yes" onClick={() => deleteTemplate.mutate()}>Delete</button>
                      <button type="button" className={BUTTON} onClick={() => setConfirmDelete(false)}>Keep</button>
                    </span>
                  ) : (
                    <button type="button" className={`${BUTTON} text-red-600`} data-testid="composer-delete-template" disabled={busy}
                      onClick={() => setConfirmDelete(true)}>
                      <Trash2 className="w-3.5 h-3.5" /> Delete template
                    </button>
                  ))}
                </div>
              )}
            </div>

            {channel !== "sms" && (
              <div className="space-y-1">
                <label className={LABEL} htmlFor="composer-subject">{channel === "letter" ? "Re: line (optional)" : "Subject"}</label>
                <input id="composer-subject" ref={subjectRef} data-testid="composer-subject" className={`${FIELD} h-9`} maxLength={300}
                  value={subject} onFocus={() => { lastField.current = "subject"; }} onChange={(e) => setSubject(e.target.value)}
                  placeholder={channel === "letter" ? "e.g. Your spring window cleaning" : "Subject line"} />
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-end justify-between gap-2">
                <label className={LABEL} htmlFor="composer-body">Message</label>
                <select aria-label="Insert a tag" data-testid="composer-insert-tag" className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600"
                  value="" onChange={(e) => putTag(e.target.value)}>
                  <option value="">Insert customer info…</option>
                  {groups.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.tags.map((t) => <option key={t.tag} value={t.tag}>{t.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <textarea id="composer-body" ref={bodyRef} data-testid="composer-body" rows={channel === "sms" ? 5 : 11}
                className={`${FIELD} py-2 resize-y`} value={body}
                onFocus={() => { lastField.current = "body"; }} onChange={(e) => setBody(e.target.value)} />
              <p className="text-[11px] text-slate-400">Customer info in {"{{double braces}}"} is filled in from this profile when it goes out.</p>
            </div>
          </div>

          {/* ── Right: exactly what the customer gets ─────────────────────── */}
          <div className="space-y-2 min-w-0">
            <div className="flex items-center justify-between">
              <span className={LABEL}>What {profile.firstName || "they"} will {channel === "letter" ? "receive" : "see"}</span>
              {(preview.isFetching || typing) && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
            </div>
            <div className={`rounded-xl border p-4 text-sm ${channel === "letter" ? "bg-white shadow-sm" : "bg-slate-50"} min-h-[220px]`} data-testid="composer-preview">
              {previewError ? (
                <p className="flex items-start gap-2 text-red-700" data-testid="composer-preview-error"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {previewError}</p>
              ) : !body.trim() ? (
                <p className="text-slate-400">Write a message, or start from a template.</p>
              ) : preview.data ? (
                <>
                  {channel === "letter" && preview.data.recipientLines && (
                    <div className="mb-4 text-slate-700" data-testid="composer-letter-address">
                      {preview.data.recipientLines.length < 2
                        ? <p className="text-amber-700">No mailing address on this profile yet.</p>
                        : preview.data.recipientLines.map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                  )}
                  {preview.data.subject && (
                    <p className="mb-3 font-semibold text-slate-900">{channel === "letter" ? `Re: ${preview.data.subject}` : preview.data.subject}</p>
                  )}
                  <div className="whitespace-pre-wrap break-words text-slate-800">{preview.data.text}</div>
                </>
              ) : null}
            </div>
            {preview.data && !previewError && preview.data.emptyTags.length > 0 && (
              <p className="text-xs text-amber-700" data-testid="composer-empty-tags">
                Blank on this profile: {preview.data.emptyTags.map((t) => `{{${t}}}`).join(", ")} — fill them in on the profile, or take them out.
              </p>
            )}
            {channel === "sms" && preview.data?.sms && !previewError && (
              <p className="text-xs text-slate-500" data-testid="composer-sms-length">{smsLengthLabel(preview.data.sms)}</p>
            )}
            {channel === "sms" && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="composer-sms-note">
                Texting from Corstead turns on once a text provider is connected. Until then, copy the message and send it from your phone.
              </p>
            )}
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="composer-error">{error}</p>}
        {notice && !error && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="composer-notice">{notice}</p>}

        <DialogFooter className="gap-2">
          <button type="button" className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            disabled={busy} onClick={() => onOpenChange(false)}>Close</button>
          {channel === "email" && (
            <button type="button" data-testid="composer-send-email"
              disabled={busy || blocked || !subject.trim() || !(emailTo ?? profile.email)}
              onClick={() => { setError(null); sendEmail.mutate(); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {sendEmail.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {sendEmail.isPending ? "Sending…" : "Send email"}
            </button>
          )}
          {channel === "sms" && (
            <>
              <button type="button" data-testid="composer-copy-sms" disabled={busy || blocked || !preview.data}
                onClick={copyText} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <Copy className="w-3.5 h-3.5" /> Copy text
              </button>
              <button type="button" disabled title="Waiting on a text provider" data-testid="composer-send-sms"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold opacity-50 cursor-not-allowed">
                <Send className="w-3.5 h-3.5" /> Send text
              </button>
            </>
          )}
          {channel === "letter" && (
            <button type="button" data-testid="composer-print-letter"
              disabled={busy || blocked || (preview.data?.recipientLines?.length ?? 0) < 2}
              onClick={() => { setError(null); printLetter.mutate(); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {printLetter.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              Open letter to print
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
