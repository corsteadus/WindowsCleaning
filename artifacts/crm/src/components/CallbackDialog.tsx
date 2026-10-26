/**
 * The call screen — phase 4, Kyle's Video 4: "a screen pops up with general
 * information, including how to call and email the person … options to indicate
 * whether we actually spoke to the prospect, left a message, or neither, and …
 * for scheduling a callback", the estimate up above, the notes to hand, and — if
 * they say yes — straight into booking the work.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Loader2, Mail, Phone } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TimeSelect } from "@/components/TimeSelect";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { estimateCall } from "@/lib/estimate-actions";
import { formatPhoneAsTyped } from "@/lib/phone-format";
import {
  CALLBACK_OUTCOMES, callbackDueAt, defaultNextCallback, whenLabel,
  type Callback, type CallbackAssignee, type CallbackOutcome, type CallbackProfile,
} from "@/lib/callbacks";

const FIELD = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-slate-400";

interface NoteEntry { id: number; kind: string; body: string; createdAt: string; createdBy: string | null }

export function useCallbackAssignees() {
  const { user } = useAuth();
  return useQuery({
    queryKey: authScopedQueryKey(user, ["callback-assignees"]),
    queryFn: () => estimateCall<CallbackAssignee[]>("/callbacks/assignees"),
    staleTime: 60_000,
  });
}

export function CallbackDialog({ profile, callback, estimates = [], open, onOpenChange, onBook, onEmail, onSaved }: {
  profile: CallbackProfile;
  callback: Callback;
  /** One line per estimate, e.g. "Estimate #12 · $450.00 · Home". */
  estimates?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** They said yes: book the work. Absent where booking is not allowed. */
  onBook?: () => void;
  /** Opens the profile's composer; without it, the mail app. */
  onEmail?: () => void;
  onSaved?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const profilePath = `/${profile.list === "prospect" ? "prospects" : "customers"}/${profile.id}`;
  const assignees = useCallbackAssignees();
  const notes = useQuery({
    queryKey: authScopedQueryKey(user, ["profile-notes", profilePath]),
    queryFn: () => estimateCall<NoteEntry[]>(`${profilePath}/notes`),
    enabled: open,
  });

  const [outcome, setOutcome] = useState<CallbackOutcome | null>(null);
  const [note, setNote] = useState("");
  const [specificNote, setSpecificNote] = useState("");
  const [scheduleNext, setScheduleNext] = useState(true);
  const [nextTouched, setNextTouched] = useState(false);
  const [next, setNext] = useState(() => ({ ...defaultNextCallback(new Date()), assignedUserId: callback.assignedUserId ?? "" }));
  useEffect(() => {
    if (!open) return;
    setOutcome(null); setNote(""); setSpecificNote(""); setScheduleNext(true); setNextTouched(false);
    setNext({ ...defaultNextCallback(new Date()), assignedUserId: callback.assignedUserId ?? "" });
  }, [open, callback.id, callback.assignedUserId]);
  // Spoke with them: usually nothing more to chase, unless the caller says so.
  useEffect(() => { if (!nextTouched) setScheduleNext(outcome !== "spoke"); }, [outcome, nextTouched]);

  const save = useMutation({
    mutationFn: async ({ chosen, withNext }: { chosen: CallbackOutcome; withNext: boolean }) => {
      const dueAt = withNext ? callbackDueAt(next.date, next.time) : null;
      if (withNext && !dueAt) throw new Error("Choose a date and time for the next callback");
      if (specificNote.trim()) {
        await estimateCall(`${profilePath}/notes`, { method: "POST", body: JSON.stringify({ kind: "specific", body: specificNote }) });
      }
      return estimateCall(`${profilePath}/callbacks/${callback.id}/outcome`, {
        method: "POST",
        body: JSON.stringify({
          outcome: chosen, note,
          next: withNext ? { dueAt, assignedUserId: next.assignedUserId || null } : undefined,
        }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["callbacks"]) }),
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["profile-callbacks"]) }),
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["profile-notes"]) }),
      ]);
      onSaved?.();
    },
  });

  const recentNotes = (notes.data ?? []).slice(0, 4);

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!save.isPending) onOpenChange(value); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl" data-testid="callback-dialog">
        <DialogHeader>
          <DialogTitle>Call {profile.name}</DialogTitle>
          <p className="text-sm text-slate-500">
            Due {whenLabel(callback.dueAt)}{callback.assignedTo ? ` · ${callback.assignedTo}` : ""}{callback.reason ? ` · ${callback.reason}` : ""}
          </p>
        </DialogHeader>

        {/* How to reach them */}
        <div className="flex flex-wrap gap-2">
          {profile.phone ? (
            <a href={`tel:${profile.phone}`} data-testid="callback-phone"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
              <Phone className="h-4 w-4" /> {formatPhoneAsTyped(profile.phone)}
            </a>
          ) : <span className="text-sm text-amber-700">No phone number on this profile</span>}
          {profile.email && (onEmail ? (
            <button type="button" onClick={onEmail} data-testid="callback-email"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50">
              <Mail className="h-4 w-4" /> Email
            </button>
          ) : (
            <a href={`mailto:${profile.email}`} data-testid="callback-email"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50">
              <Mail className="h-4 w-4" /> {profile.email}
            </a>
          ))}
        </div>

        {/* The estimate up above, so the caller can talk about it */}
        {estimates.length > 0 && (
          <div className="space-y-1 rounded-xl bg-slate-50 px-4 py-3" data-testid="callback-estimates">
            <p className={LABEL}>Estimates</p>
            {estimates.map((line) => <p key={line} className="text-sm text-slate-700">{line}</p>)}
          </div>
        )}

        {recentNotes.length > 0 && (
          <div className="space-y-1.5" data-testid="callback-recent-notes">
            <p className={LABEL}>Recent notes</p>
            {recentNotes.map((entry) => (
              <p key={entry.id} className="text-xs text-slate-600">
                <span className="font-semibold capitalize text-slate-500">{entry.kind}</span> · {whenLabel(entry.createdAt)}{entry.createdBy ? ` · ${entry.createdBy}` : ""} — {entry.body}
              </p>
            ))}
          </div>
        )}

        {/* What happened */}
        <div className="space-y-2">
          <p className={LABEL}>How did the call go?</p>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Call outcome">
            {CALLBACK_OUTCOMES.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={outcome === option.id} data-testid={`callback-outcome-${option.id}`}
                onClick={() => setOutcome(option.id)}
                className={`h-10 rounded-xl border px-3 text-sm font-semibold transition ${outcome === option.id
                  ? "border-primary bg-primary text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                {option.label}
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">What was said <span className="font-normal text-slate-400">— goes to the callback notes</span></span>
            <textarea data-testid="callback-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">About them or the property <span className="font-normal text-slate-400">— goes to the specific notes, optional</span></span>
            <textarea data-testid="callback-specific-note" value={specificNote} onChange={(e) => setSpecificNote(e.target.value)} rows={2}
              placeholder="e.g. dog in the back yard, prefers texts"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        {/* The next try */}
        <div className="space-y-2 rounded-xl border border-slate-200 px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" data-testid="callback-schedule-next" checked={scheduleNext}
              onChange={(e) => { setNextTouched(true); setScheduleNext(e.target.checked); }} />
            Schedule the next callback
          </label>
          {scheduleNext && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr]">
              <input type="date" aria-label="Next callback date" data-testid="callback-next-date" className={FIELD}
                value={next.date} onChange={(e) => setNext((n) => ({ ...n, date: e.target.value }))} />
              <TimeSelect aria-label="Next callback time" value={next.time} onChange={(time) => setNext((n) => ({ ...n, time }))} className={FIELD} />
              <select aria-label="Next callback by" data-testid="callback-next-assignee" className={FIELD}
                value={next.assignedUserId} onChange={(e) => setNext((n) => ({ ...n, assignedUserId: e.target.value }))}>
                <option value="">Anyone in the office</option>
                {(assignees.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {save.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="callback-error">{(save.error as Error).message}</p>}

        <DialogFooter className="gap-2 sm:justify-between">
          {onBook ? (
            <button type="button" data-testid="callback-book" disabled={save.isPending}
              onClick={() => save.mutate({ chosen: "spoke", withNext: false }, { onSuccess: () => onBook() })}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-300 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
              <CalendarCheck className="h-4 w-4" /> They want to go ahead — book it
            </button>
          ) : <span />}
          <span className="flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} disabled={save.isPending}
              className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="button" data-testid="callback-save" disabled={!outcome || save.isPending}
              onClick={() => outcome && save.mutate({ chosen: outcome, withNext: scheduleNext })}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save the call
            </button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
