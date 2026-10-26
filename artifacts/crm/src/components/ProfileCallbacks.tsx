/**
 * The Callbacks section under the profile — phase 4, Kyle's Video 4. The calls
 * still to make (soonest first, overdue marked), scheduling one, and the calls
 * made with what happened.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneCall, Plus, X } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { TimeSelect } from "@/components/TimeSelect";
import { CallbackDialog, useCallbackAssignees } from "@/components/CallbackDialog";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { estimateCall } from "@/lib/estimate-actions";
import {
  BUCKET_LABELS, callbackDueAt, defaultNextCallback, dueBucket, outcomeLabel, whenLabel,
  type Callback, type CallbackProfile,
} from "@/lib/callbacks";

const FIELD = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm";
const BUCKET_STYLE = { overdue: "bg-red-50 text-red-700", today: "bg-amber-50 text-amber-700", upcoming: "bg-slate-100 text-slate-600" };

export function ProfileCallbacks({ profile, estimates, canManage, onBook, onEmail }: {
  profile: CallbackProfile;
  estimates: string[];
  canManage: boolean;
  onBook?: () => void;
  onEmail?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const profilePath = `/${profile.list === "prospect" ? "prospects" : "customers"}/${profile.id}`;
  const list = useQuery({
    queryKey: authScopedQueryKey(user, ["profile-callbacks", profilePath]),
    queryFn: () => estimateCall<{ open: Callback[]; history: Callback[] }>(`${profilePath}/callbacks`),
  });
  const assignees = useCallbackAssignees();
  const [calling, setCalling] = useState<Callback | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(() => ({ ...defaultNextCallback(new Date()), assignedUserId: "", reason: "" }));
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["profile-callbacks"]) }),
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["callbacks"]) }),
  ]);

  const create = useMutation({
    mutationFn: () => {
      const dueAt = callbackDueAt(draft.date, draft.time);
      if (!dueAt) throw new Error("Choose a date and time");
      return estimateCall(`${profilePath}/callbacks`, {
        method: "POST", body: JSON.stringify({ dueAt, assignedUserId: draft.assignedUserId || null, reason: draft.reason }),
      });
    },
    onSuccess: async () => {
      setAdding(false);
      setDraft({ ...defaultNextCallback(new Date()), assignedUserId: "", reason: "" });
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: number) => estimateCall(`${profilePath}/callbacks/${id}/cancel`, { method: "POST" }),
    onSuccess: refresh,
  });

  const now = new Date();
  const open = list.data?.open ?? [];
  const history = list.data?.history ?? [];

  return (
    <div className="space-y-4" data-testid="profile-callbacks">
      {list.isLoading && <p className="text-xs text-slate-400">Loading callbacks…</p>}
      {list.isError && <p className="text-xs text-red-600">The callbacks could not be loaded.</p>}

      {list.data && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">To call</p>
            {canManage && !adding && (
              <button type="button" data-testid="callback-add" onClick={() => setAdding(true)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <Plus className="h-3.5 w-3.5" /> Schedule a callback
              </button>
            )}
          </div>

          {adding && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="callback-add-form">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr]">
                <input type="date" aria-label="Callback date" className={FIELD} value={draft.date}
                  onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
                <TimeSelect aria-label="Callback time" value={draft.time} onChange={(time) => setDraft((d) => ({ ...d, time }))} className={FIELD} />
                <select aria-label="Callback by" className={FIELD} value={draft.assignedUserId}
                  onChange={(e) => setDraft((d) => ({ ...d, assignedUserId: e.target.value }))}>
                  <option value="">Anyone in the office</option>
                  {(assignees.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <input aria-label="Callback reason" className={`${FIELD} w-full`} placeholder="Reason, e.g. follow up on the estimate"
                value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />
              {create.isError && <p className="text-xs text-red-600">{(create.error as Error).message}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAdding(false)} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600">Cancel</button>
                <button type="button" data-testid="callback-add-save" disabled={create.isPending} onClick={() => create.mutate()}
                  className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50">Save callback</button>
              </div>
            </div>
          )}

          {open.length === 0 && !adding && <p className="text-xs text-slate-400">No callbacks scheduled.</p>}
          {open.map((callback) => {
            const bucket = dueBucket(callback.dueAt, now);
            return (
              <div key={callback.id} data-testid="callback-row" className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <PhoneCall className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{whenLabel(callback.dueAt)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${BUCKET_STYLE[bucket]}`}>{BUCKET_LABELS[bucket]}</span>
                  </span>
                  <span className="block text-xs text-slate-500">
                    {[callback.assignedTo ?? "Anyone in the office", callback.reason].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {canManage && (
                  <span className="flex gap-2">
                    <button type="button" data-testid="callback-call" onClick={() => setCalling(callback)}
                      className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700">Call</button>
                    <button type="button" aria-label="Cancel this callback" title="Cancel this callback" data-testid="callback-cancel"
                      onClick={() => { if (window.confirm("Cancel this callback?")) cancel.mutate(callback.id); }}
                      className="h-8 rounded-lg border border-slate-200 px-2 text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Calls made</p>
          {history.map((callback) => (
            <div key={callback.id} data-testid="callback-history-row" className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-800">
                {outcomeLabel(callback.status === "cancelled" ? null : callback.outcome)}
                <span className="font-normal text-slate-500"> · {whenLabel(callback.completedAt ?? callback.createdAt)}{callback.completedBy ? ` · ${callback.completedBy}` : ""}</span>
              </p>
              {callback.outcomeNote && <p className="text-xs text-slate-600">{callback.outcomeNote}</p>}
            </div>
          ))}
        </div>
      )}

      {calling && (
        <CallbackDialog profile={profile} callback={calling} estimates={estimates} open={calling != null}
          onOpenChange={(value) => { if (!value) setCalling(null); }}
          onSaved={() => setCalling(null)}
          onBook={onBook} onEmail={onEmail ? () => { setCalling(null); onEmail(); } : undefined} />
      )}
    </div>
  );
}
