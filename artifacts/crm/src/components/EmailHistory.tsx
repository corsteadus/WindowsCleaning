/**
 * The emails sent to a profile, each one openable and resendable — phase 2,
 * Kyle's Video 4: "you can see the date and time, what we emailed, and who sent
 * the email. We can open the email and view its content … if we need to look
 * back at an earlier email or resend that same email, we can easily find it."
 * The server reads them from the email log (api-server routes/profile-emails.ts).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, RotateCcw } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { estimateCall } from "@/lib/estimate-actions";

export interface EmailHistoryEntry {
  id: number; subject: string; to: string; toName: string | null; status: string;
  at: string; sender: string | null; origin: "manual" | "automation" | "campaign"; error: string | null;
}

// The business's time, as everything else on the profile.
const when = (iso: string) => new Date(iso).toLocaleString("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
});
const STATUS_STYLE: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700", failed: "bg-red-50 text-red-700", pending: "bg-amber-50 text-amber-700",
};

export function EmailHistory({ apiBase, customerId, onResend }: {
  apiBase: string;
  customerId: number;
  /** Opens the profile's composer with this email in it; absent without permission to send. */
  onResend?: (email: { to: string; subject: string; bodyHtml: string }) => void;
}) {
  const { user } = useAuth();
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery({
    queryKey: authScopedQueryKey(user, ["profile-emails", apiBase, customerId]),
    queryFn: () => estimateCall<EmailHistoryEntry[]>(`${apiBase.replace(/^\/api/, "")}/${customerId}/emails`),
  });
  const one = useQuery({
    queryKey: authScopedQueryKey(user, ["profile-email", apiBase, customerId, openId]),
    queryFn: () => estimateCall<EmailHistoryEntry & { bodyHtml: string }>(`${apiBase.replace(/^\/api/, "")}/${customerId}/emails/${openId}`),
    enabled: openId != null,
  });

  return (
    <div className="space-y-2" data-testid="email-history">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Emails sent</p>
      {list.isLoading && <p className="text-xs text-slate-400">Loading emails…</p>}
      {list.isError && <p className="text-xs text-red-600">The email history could not be loaded.</p>}
      {list.data && list.data.length === 0 && <p className="text-xs text-slate-400">No emails have been sent to this profile yet.</p>}
      {(list.data ?? []).map((email) => (
        <button key={email.id} type="button" data-testid="email-history-row" onClick={() => setOpenId(email.id)}
          className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-300 hover:bg-slate-50">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-900">{email.subject}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[email.status] ?? "bg-slate-100 text-slate-500"}`}>{email.status}</span>
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {when(email.at)} · to {email.toName ? `${email.toName} <${email.to}>` : email.to} · {email.sender ?? "Sender not recorded"}
            </span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-primary">View</span>
        </button>
      ))}

      <Dialog open={openId != null} onOpenChange={(open) => { if (!open) setOpenId(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl" data-testid="email-view">
          <DialogHeader><DialogTitle>{one.data?.subject ?? "Email"}</DialogTitle></DialogHeader>
          {one.isFetching && <p className="py-6 text-center text-sm text-slate-400">Loading…</p>}
          {one.data && !one.isFetching && (
            <>
              <dl className="grid grid-cols-[70px_1fr] gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <dt className="text-slate-400">Sent</dt><dd className="text-slate-800">{when(one.data.at)}</dd>
                <dt className="text-slate-400">To</dt><dd className="text-slate-800">{one.data.toName ? `${one.data.toName} <${one.data.to}>` : one.data.to}</dd>
                <dt className="text-slate-400">By</dt><dd className="text-slate-800">{one.data.sender ?? "Not recorded"}</dd>
                <dt className="text-slate-400">Status</dt><dd className="text-slate-800 capitalize">{one.data.status}{one.data.error ? ` — ${one.data.error}` : ""}</dd>
              </dl>
              {/* The message as it was sent. A sandboxed frame with no permissions:
                  no script in an email body can run inside Corstead. */}
              <iframe title="Email content" data-testid="email-body" sandbox="" srcDoc={one.data.bodyHtml}
                className="h-80 w-full rounded-xl border border-slate-200 bg-white" />
            </>
          )}
          {one.isError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{(one.error as Error).message}</p>}
          <DialogFooter>
            <button type="button" onClick={() => setOpenId(null)} className="h-9 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">Close</button>
            {onResend && one.data && (
              <button type="button" data-testid="email-resend"
                onClick={() => { const email = one.data!; setOpenId(null); onResend({ to: email.to, subject: email.subject, bodyHtml: email.bodyHtml }); }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90">
                <RotateCcw className="h-3.5 w-3.5" /> Resend
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
