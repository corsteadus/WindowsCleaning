/**
 * What a customer sees, and is emailed, after accepting an estimate online —
 * Videos 7 and 9. Kyle: the business "can edit this form and customize the
 * message … the customer sees after acceptance", and the customer gets a short
 * email thanking them and saying the business will be in touch. Blank boxes use
 * Corstead's short default wording, shown as the placeholder.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PartyPopper } from "lucide-react";
import { estimateCall } from "@/lib/estimate-actions";

const FIELD = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";

interface Settings {
  acceptanceMessage: string | null;
  acceptanceEmailEnabled: boolean;
  acceptanceEmailSubject: string | null;
  acceptanceEmailBody: string | null;
  openNotificationEnabled?: boolean;
  acceptanceDefaults: { message: string; subject: string; body: string; tags: string[] };
}
type Draft = { message: string; enabled: boolean; subject: string; body: string; opens: boolean };
type Box = "message" | "subject" | "body";

export function AcceptanceSettingsCard({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["quote-settings"], queryFn: () => estimateCall<Settings>("/quote-settings") });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [lastBox, setLastBox] = useState<Box>("message");
  const boxes = { message: useRef<HTMLTextAreaElement>(null), subject: useRef<HTMLInputElement>(null), body: useRef<HTMLTextAreaElement>(null) };

  useEffect(() => {
    if (!settings.data) return;
    setDraft({
      message: settings.data.acceptanceMessage ?? "", enabled: settings.data.acceptanceEmailEnabled,
      subject: settings.data.acceptanceEmailSubject ?? "", body: settings.data.acceptanceEmailBody ?? "",
      opens: settings.data.openNotificationEnabled ?? true,
    });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => estimateCall("/quote-settings/acceptance", {
      method: "PUT",
      body: JSON.stringify({
        acceptanceMessage: draft!.message, acceptanceEmailEnabled: draft!.enabled,
        acceptanceEmailSubject: draft!.subject, acceptanceEmailBody: draft!.body,
        openNotificationEnabled: draft!.opens,
      }),
    }),
    onSuccess: async () => { setMessage({ kind: "ok", text: "Saved. It applies from the next customer." }); await queryClient.invalidateQueries({ queryKey: ["quote-settings"] }); },
    onError: (cause: Error) => setMessage({ kind: "error", text: cause.message }),
  });

  if (!canManage) return null;
  const defaults = settings.data?.acceptanceDefaults;
  const set = (patch: Partial<Draft>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setMessage(null); };

  /** Puts the tag where the cursor was, in the box last used. */
  const insertTag = (tag: string) => {
    if (!draft) return;
    const el = boxes[lastBox].current;
    const text = draft[lastBox];
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    set({ [lastBox]: `${text.slice(0, at)}{{${tag}}}${text.slice(end)}` } as Partial<Draft>);
    requestAnimationFrame(() => { el?.focus(); const caret = at + tag.length + 4; el?.setSelectionRange(caret, caret); });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="acceptance-settings-card">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><PartyPopper className="w-4 h-4" /></div>
        <div>
          <h2 className="text-base font-bold text-slate-900">When a customer opens or accepts</h2>
          <p className="text-xs text-slate-500 mt-0.5">Whether the office hears when an estimate is opened; the thank-you a customer sees when they accept online, and the email they get. Not sent when the office converts an estimate itself.</p>
        </div>
      </div>
      {!draft || !defaults ? <p className="p-5 text-sm text-slate-400">Loading…</p> : (
        <div className="p-5 space-y-4">
          {/* A2, Video 7 (must-have): the business hears when its estimate is opened. */}
          <label className="flex items-start gap-2 border-b border-slate-100 pb-4 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" data-testid="open-notification-enabled" checked={draft.opens} onChange={(e) => set({ opens: e.target.checked })} />
            <span>Email the office when a customer opens an estimate or an invoice
              <span className="block text-[11px] text-slate-400">The first time each address opens it, then at most once a day. Opens by your own team are not counted.</span></span>
          </label>

          <div className="flex flex-wrap items-center gap-1.5" aria-label="Insert a tag">
            <span className="text-xs font-semibold text-slate-500 mr-1">Insert:</span>
            {defaults.tags.map((tag) => (
              <button key={tag} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertTag(tag)}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600 hover:bg-slate-100">{`{{${tag}}}`}</button>
            ))}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-500">Thank-you message on the estimate page</span>
            <textarea ref={boxes.message} aria-label="Thank-you message" data-testid="acceptance-message" rows={3} maxLength={4000}
              className={FIELD} placeholder={defaults.message} value={draft.message}
              onFocus={() => setLastBox("message")} onChange={(e) => set({ message: e.target.value })} />
            <span className="block text-[11px] text-slate-400">Below it the customer sees the services they accepted and any notes they wrote.</span>
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" data-testid="acceptance-email-enabled" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span>Email the customer a thank-you when they accept</span>
          </label>
          {draft.enabled && (
            <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-500">Subject</span>
                <input ref={boxes.subject} aria-label="Thank-you email subject" data-testid="acceptance-subject" maxLength={300}
                  className={`${FIELD} h-9`} placeholder={defaults.subject} value={draft.subject}
                  onFocus={() => setLastBox("subject")} onChange={(e) => set({ subject: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-500">Message</span>
                <textarea ref={boxes.body} aria-label="Thank-you email message" data-testid="acceptance-body" rows={8} maxLength={10000}
                  className={FIELD} placeholder={defaults.body} value={draft.body}
                  onFocus={() => setLastBox("body")} onChange={(e) => set({ body: e.target.value })} />
              </label>
            </div>
          )}

          {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`} data-testid="acceptance-settings-message">{message.text}</p>}
          <div className="flex justify-end">
            <button type="button" data-testid="acceptance-save" disabled={save.isPending} onClick={() => save.mutate()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
