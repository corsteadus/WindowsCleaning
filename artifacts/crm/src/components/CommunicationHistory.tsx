/**
 * A profile's one communication history — A6 (Kyle, Video 8): "we can see what
 * the communication has been for this customer. We can actually click on a
 * link, and a screen pops up that shows the actual email we sent out."
 * Every email, text and letter once, newest first: what, to whom, who sent it,
 * the estimate or invoice it was about. Filter by type or words; View opens it
 * (Resend an email, print a letter again). The owner and admins can delete one
 * or many, after a confirm; Corstead records who removed them and when.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Mail, MessageSquare, Printer, RotateCcw, Search, Trash2 } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";
import { estimateCall } from "@/lib/estimate-actions";
import {
  deleteQuestion, FILTERS, keepSelection, relatedHref, statusLabel, statusTone,
  type HistoryDetail, type HistoryFilter, type HistoryItem, type HistoryResponse,
} from "@/lib/communication-history";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const PAGE = 50;
const ICON = { email: Mail, text: MessageSquare, letter: FileText } as const;
const TONE = { good: "bg-emerald-50 text-emerald-700", bad: "bg-red-50 text-red-700", wait: "bg-amber-50 text-amber-700", plain: "bg-slate-100 text-slate-500" };
// The business's time, as everything else on the profile.
const when = (iso: string) => new Date(iso).toLocaleString("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
});

export function CommunicationHistory({ apiBase, customerId, onResend }: {
  apiBase: string;
  customerId: number;
  /** Opens the profile's composer with this email in it; absent without permission to send. */
  onResend?: (email: { to: string; subject: string; bodyHtml: string }) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const path = `${apiBase.replace(/^\/api/, "")}/${customerId}/communications`;
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => { setShown(PAGE); }, [filter, q]);

  const list = useQuery({
    queryKey: authScopedQueryKey(user, ["communication-history", path, filter, q]),
    queryFn: () => estimateCall<HistoryResponse>(`${path}?${new URLSearchParams({ ...(filter !== "all" ? { type: filter } : {}), ...(q ? { q } : {}) })}`),
    placeholderData: (previous) => previous,
  });
  const items = list.data?.items ?? [];
  const canDelete = list.data?.canDelete === true;
  useEffect(() => { setSelected((current) => keepSelection(current, items)); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const one = useQuery({
    queryKey: authScopedQueryKey(user, ["communication-entry", path, openKey]),
    queryFn: () => estimateCall<HistoryDetail>(`${path}/${encodeURIComponent(openKey!)}`),
    enabled: openKey != null,
  });

  const remove = useMutation({
    mutationFn: (keys: string[]) => estimateCall<{ deleted: number; alreadyDeleted: number }>(`${path}/delete`, { method: "POST", body: JSON.stringify({ keys }) }),
    onSuccess: async (result) => {
      setConfirm(null); setSelected(new Set()); setOpenKey(null);
      setMessage(`${result.deleted + result.alreadyDeleted} ${result.deleted + result.alreadyDeleted === 1 ? "entry" : "entries"} deleted.`);
      await queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["communication-history", path]) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["profile-emails"]) });
    },
    onError: (e: Error) => { setConfirm(null); setMessage(e.message); },
  });

  const printAgain = useMutation({
    mutationFn: async (key: string) => {
      const tab = window.open("", "_blank");
      const res = await protectedFetch(`${BASE}/api${path}/${encodeURIComponent(key)}/pdf`, { credentials: "include" });
      if (!res.ok) { tab?.close(); throw new Error("The letter could not be opened"); }
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url; else window.location.assign(url);
    },
  });

  const visible = items.slice(0, shown);
  const allTicked = visible.length > 0 && visible.every((item) => selected.has(item.key));
  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="space-y-3" data-testid="communication-history">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {FILTERS.map(({ key, label }) => (
            <button key={key} type="button" data-testid={`history-filter-${key}`} onClick={() => setFilter(key)} aria-pressed={filter === key}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === key ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {label} <span className="opacity-70">{list.data?.counts[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input data-testid="history-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subject, address, sender…"
            aria-label="Search the history" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm" />
        </label>
      </div>

      {canDelete && items.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-slate-600">
            <input type="checkbox" className="h-4 w-4 accent-primary" data-testid="history-select-all" checked={allTicked}
              onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((i) => i.key)) : new Set())} />
            Select all shown
          </label>
          {selected.size > 0 && (
            <button type="button" data-testid="history-delete-selected" onClick={() => setConfirm([...selected])}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" /> Delete {selected.size}
            </button>
          )}
        </div>
      )}

      {message && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="history-message">{message}</p>}
      {list.isLoading && <p className="text-xs text-slate-400">Loading the history…</p>}
      {list.isError && <p className="text-xs text-red-600">The history could not be loaded.</p>}
      {list.data && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400" data-testid="history-empty">
          {q || filter !== "all" ? "Nothing matches." : "Nothing has been sent to this profile yet."}
        </p>
      )}

      <ol className="space-y-2">
        {visible.map((item) => {
          const Icon = ICON[item.type];
          return (
            <li key={item.key} data-testid="history-row" data-key={item.key}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 hover:border-slate-300">
              {canDelete && (
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" aria-label={`Select ${item.title}`}
                  checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
              )}
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenKey(item.key)}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{item.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${TONE[statusTone(item.status)]}`}>{statusLabel(item.status)}</span>
                  {item.template && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{item.template}</span>}
                </span>
                <span className="mt-0.5 block break-all text-xs text-slate-500">
                  {when(item.at)}{item.to ? ` · to ${item.to}` : ""} · {item.by ?? "Sender not recorded"}
                </span>
              </button>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {item.related && (
                  <Link href={relatedHref(item.related)} className="text-[11px] font-semibold text-primary hover:underline">{item.related.label}</Link>
                )}
                <button type="button" onClick={() => setOpenKey(item.key)} className="text-xs font-semibold text-primary">View</button>
              </span>
            </li>
          );
        })}
      </ol>
      {items.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full rounded-xl border border-slate-200 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Show {Math.min(PAGE, items.length - shown)} more of {items.length - shown}
        </button>
      )}

      {/* ── One entry, as it was sent ──────────────────────────────────── */}
      <Dialog open={openKey != null} onOpenChange={(open) => { if (!open) setOpenKey(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl" data-testid="history-view">
          <DialogHeader>
            <DialogTitle>{one.data?.title ?? "Message"}</DialogTitle>
            <DialogDescription className="sr-only">What was sent, to whom, and by whom.</DialogDescription>
          </DialogHeader>
          {one.isFetching && <p className="py-6 text-center text-sm text-slate-400">Loading…</p>}
          {one.data && !one.isFetching && (
            <>
              <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <dt className="text-slate-400">{one.data.type === "letter" ? "Printed" : "Sent"}</dt><dd className="text-slate-800">{when(one.data.at)}</dd>
                <dt className="text-slate-400">To</dt><dd className="text-slate-800">{one.data.to ?? "—"}</dd>
                <dt className="text-slate-400">By</dt><dd className="text-slate-800">{one.data.by ?? "Not recorded"}</dd>
                <dt className="text-slate-400">Status</dt><dd className="text-slate-800">{statusLabel(one.data.status)}{one.data.error ? ` — ${one.data.error}` : ""}</dd>
                {one.data.related && (<><dt className="text-slate-400">About</dt><dd><Link href={relatedHref(one.data.related)} className="font-semibold text-primary hover:underline">{one.data.related.label}</Link></dd></>)}
              </dl>
              {one.data.bodyHtml != null && (
                // A sandboxed frame with no permissions: no script in an email body can run inside Corstead.
                <iframe title="Email content" data-testid="history-email-body" sandbox="" srcDoc={one.data.bodyHtml}
                  className="h-80 w-full rounded-xl border border-slate-200 bg-white" />
              )}
              {one.data.type === "letter" && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800" data-testid="history-letter-body">
                  <div className="mb-3">{(one.data.recipientLines ?? []).map((line, i) => <div key={i}>{line}</div>)}</div>
                  {one.data.subject && <p className="mb-2 font-semibold">Re: {one.data.subject}</p>}
                  <div className="whitespace-pre-wrap">{one.data.body}</div>
                </div>
              )}
              {one.data.type === "text" && (
                <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
                  {one.data.body ?? "The words of this text were not kept (only the fact it was sent)."}
                </p>
              )}
              {one.data.type === "email" && one.data.bodyHtml == null && (
                <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">The words of this email were not kept (only the fact it was sent).</p>
              )}
            </>
          )}
          {one.isError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{(one.error as Error).message}</p>}
          <DialogFooter className="gap-2">
            {canDelete && one.data && (
              <button type="button" data-testid="history-delete-one" onClick={() => setConfirm([one.data!.key])}
                className="mr-auto inline-flex h-9 items-center gap-1.5 rounded-xl border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            )}
            <button type="button" onClick={() => setOpenKey(null)} className="h-9 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">Close</button>
            {one.data?.type === "letter" && (
              <button type="button" data-testid="history-print-again" disabled={printAgain.isPending} onClick={() => printAgain.mutate(one.data!.key)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90">
                <Printer className="h-3.5 w-3.5" /> Print again
              </button>
            )}
            {onResend && one.data?.bodyHtml != null && one.data.address && (
              <button type="button" data-testid="history-resend"
                onClick={() => { const email = one.data!; setOpenKey(null); onResend({ to: email.address!, subject: email.title, bodyHtml: email.bodyHtml! }); }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90">
                <RotateCcw className="h-3.5 w-3.5" /> Resend
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete, after a confirm ────────────────────────────────────── */}
      <Dialog open={confirm != null} onOpenChange={(open) => { if (!open && !remove.isPending) setConfirm(null); }}>
        <DialogContent className="max-w-md rounded-2xl" data-testid="history-delete-confirm">
          <DialogHeader>
            <DialogTitle>{deleteQuestion(confirm?.length ?? 0)}</DialogTitle>
            <DialogDescription>
              It disappears from this profile's history for everyone. Corstead keeps a note of who deleted it and when.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button type="button" disabled={remove.isPending} onClick={() => setConfirm(null)}
              className="h-9 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">Keep</button>
            <button type="button" data-testid="history-delete-yes" disabled={remove.isPending} onClick={() => remove.mutate(confirm!)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
