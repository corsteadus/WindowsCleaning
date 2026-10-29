/**
 * Email the invoice — A3 (Kyle, Video 7), the way an estimate is sent: any of the
 * profile's addresses (a new one is saved to the profile), the message with tags,
 * a link to the customer's own invoice page as the standard and the PDF as an
 * option, and a preview first. Each address gets its own link, so the office
 * sees which address opened it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, Loader2, Paperclip, Plus, Send } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { protectedFetch } from "@/lib/auth-scope";
import { estimateCall } from "@/lib/estimate-actions";
import { DEFAULT_INVOICE_TEXT, invoiceTextToHtml, reachesInvoice } from "@/lib/invoice-email";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const FIELD = "w-full rounded-lg border border-slate-200 bg-white px-3 text-sm";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-slate-400";

interface Draft {
  recipients: Array<{ email: string; name: string; primary: boolean }>;
  subject: string;
  tags: Array<{ tag: string; label: string }>;
  closed: string | null;
  pdfFilename: string;
  profilePath: string;
}

export function SendInvoiceDialog({ invoiceId, open, onOpenChange, onSent }: {
  invoiceId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (result: { sent: number; problems: string | null }) => void;
}) {
  const draft = useQuery({
    queryKey: ["invoice-email-draft", invoiceId],
    queryFn: () => estimateCall<Draft>(`/invoices/${invoiceId}/email-draft`),
    enabled: open,
  });
  const [to, setTo] = useState<Set<string>>(new Set());
  const [newAddress, setNewAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState(DEFAULT_INVOICE_TEXT);
  const [attachPdf, setAttachPdf] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; bodyHtml: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) { setSubject(""); setTo(new Set()); return; }
    idempotencyKey.current = crypto.randomUUID();
    setPreview(null); setError(null); setAttachPdf(false); setNewAddress(""); setText(DEFAULT_INVOICE_TEXT);
  }, [open]);
  useEffect(() => {
    if (!open || !draft.data) return;
    setSubject((current) => current || draft.data.subject);
    setTo((current) => current.size ? current : new Set(draft.data.recipients.filter((r) => r.primary).slice(0, 1).map((r) => r.email)));
  }, [open, draft.data]);

  const bodyHtml = useMemo(() => invoiceTextToHtml(text), [text]);
  const reaches = reachesInvoice(text, attachPdf);

  const insertTag = (tag: string) => {
    const box = textRef.current;
    if (!box) { setText((t) => `${t}${tag}`); return; }
    const start = box.selectionStart ?? text.length;
    const end = box.selectionEnd ?? text.length;
    setText(text.slice(0, start) + tag + text.slice(end));
    requestAnimationFrame(() => { box.focus(); box.setSelectionRange(start + tag.length, start + tag.length); });
  };

  const saveAddress = useMutation({
    mutationFn: async () => {
      const value = newAddress.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("That is not an email address");
      await estimateCall(`${draft.data!.profilePath}/channels`, { method: "POST", body: JSON.stringify({ channelType: "email", value, purposes: ["general"] }) });
      return value.toLowerCase();
    },
    onSuccess: async (email) => {
      setNewAddress(""); setError(null);
      await draft.refetch();
      setTo((current) => new Set([...current, email]));
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const showPreview = useMutation({
    mutationFn: () => estimateCall<{ subject: string; bodyHtml: string }>(`/invoices/${invoiceId}/email-preview`, {
      method: "POST", body: JSON.stringify({ subject, bodyHtml, attachPdf }),
    }),
    onSuccess: (result) => { setPreview(result); setError(null); },
    onError: (cause: Error) => setError(cause.message),
  });

  const send = useMutation({
    mutationFn: async () => {
      const response = await protectedFetch(`${BASE}/api/invoices/${invoiceId}/send-email`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({ to: [...to], subject, bodyHtml, attachPdf }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "The invoice could not be sent");
      return body as { sent: number; failed?: Array<{ email: string; error: string }>; skipped?: Array<{ email: string; reason: string }> };
    },
    onSuccess: (result) => {
      const problems = [
        ...(result.failed ?? []).map((f) => `${f.email}: not sent (${f.error})`),
        ...(result.skipped ?? []).map((s) => `${s.email}: skipped (${s.reason.replaceAll("_", " ")})`),
      ].join(" · ");
      onSent({ sent: result.sent ?? 0, problems: problems || null });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const recipients = draft.data?.recipients ?? [];
  const blocked = draft.data?.closed ?? null;
  const canSend = !blocked && to.size > 0 && subject.trim() && text.trim() && reaches && !send.isPending;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!send.isPending) onOpenChange(value); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl" data-testid="send-invoice-dialog">
        <DialogHeader><DialogTitle>Email the invoice</DialogTitle></DialogHeader>
        {draft.isLoading && <p className="py-8 text-center text-sm text-slate-400">Loading…</p>}
        {draft.isError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{(draft.error as Error).message}</p>}
        {draft.data && (
          <div className="space-y-4">
            {blocked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="send-invoice-blocked">{blocked}</p>}

            <div className="space-y-2">
              <p className={LABEL}>To</p>
              {recipients.length === 0 && <p className="text-sm text-slate-500">This profile has no email address yet. Add one below.</p>}
              <div className="flex flex-wrap gap-2">
                {recipients.map((r) => {
                  const on = to.has(r.email);
                  return (
                    <label key={r.email} data-testid="send-invoice-recipient"
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${on ? "border-primary bg-primary/5" : "border-slate-200"}`}>
                      <input type="checkbox" checked={on} onChange={(e) => setTo((current) => {
                        const next = new Set(current);
                        if (e.target.checked) next.add(r.email); else next.delete(r.email);
                        return next;
                      })} />
                      <span><span className="font-semibold text-slate-800">{r.name || r.email}</span>{r.name && <span className="text-slate-500"> · {r.email}</span>}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input aria-label="Add an email address" data-testid="send-invoice-new-address" className={`${FIELD} h-9 flex-1`} placeholder="Another address — saved to this profile"
                  value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
                <button type="button" disabled={!newAddress.trim() || saveAddress.isPending} onClick={() => saveAddress.mutate()}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  <Plus className="h-3.5 w-3.5" /> Save &amp; add
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className={LABEL}>Message</p>
              <input aria-label="Subject" data-testid="send-invoice-subject" className={`${FIELD} h-10`} value={subject}
                onChange={(e) => { setSubject(e.target.value); setPreview(null); }} />
              <textarea ref={textRef} aria-label="Message" data-testid="send-invoice-text" rows={9} className={`${FIELD} py-2 leading-relaxed`} value={text}
                onChange={(e) => { setText(e.target.value); setPreview(null); }} />
              <div className="flex flex-wrap gap-1.5" aria-label="Insert a tag">
                {draft.data.tags.map((t) => (
                  <button key={t.tag} type="button" title={t.tag} onClick={() => insertTag(t.tag)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100">
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
              <input type="checkbox" data-testid="send-invoice-attach-pdf" checked={attachPdf} onChange={(e) => { setAttachPdf(e.target.checked); setPreview(null); }} />
              <Paperclip className="h-4 w-4 text-slate-400" />
              Attach the invoice as a PDF <span className="text-slate-400">({draft.data.pdfFilename})</span>
            </label>
            {!reaches && (
              <p className="text-xs text-amber-700" data-testid="send-invoice-no-link">Add the invoice link to the message, or attach the PDF, so the customer can see the invoice.</p>
            )}

            {preview && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid="send-invoice-preview">
                <p className="text-xs text-slate-500">Subject: <span className="font-semibold text-slate-800">{preview.subject}</span></p>
                <iframe title="Email preview" sandbox="" srcDoc={preview.bodyHtml} className="h-56 w-full rounded-lg border border-slate-100 bg-white" />
                <p className="text-[11px] text-slate-400">The link is made when the email is sent; each address gets its own.</p>
              </div>
            )}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="send-invoice-error">{error}</p>}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <button type="button" data-testid="send-invoice-preview-button" disabled={!draft.data || showPreview.isPending} onClick={() => showPreview.mutate()}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <Eye className="h-4 w-4" /> Preview
          </button>
          <span className="flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} disabled={send.isPending}
              className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600">Cancel</button>
            <button type="button" data-testid="send-invoice-send" disabled={!canSend} onClick={() => send.mutate()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send to {to.size || "…"}
            </button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
