/**
 * Moving a whole day's work.
 *
 * Spec V1 #11 and the third prototype test. Rain moves a day, and the office
 * should not reschedule twenty-five jobs one at a time.
 *
 * It shows what it will do before it does it: the same planner answers the
 * preview and the move, so this screen cannot promise one thing and perform
 * another. What it cannot move — completed and invoiced work — is named here,
 * not discovered afterwards.
 *
 * **Nobody is told.** Phase 11's rule is that nothing reaches a customer
 * without somebody answering a prompt, and a prompt asked twenty-five times is
 * not an answer. The dialog says how many customers have work on the day so the
 * office can decide in one go.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CalendarClock, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { protectedFetch } from "@/lib/auth-scope";
import { formatDateOnly } from "@/lib/quote-settings-form";
import { readableBlockMessage } from "@/lib/calendar-block-conflicts";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface DayMovePlan {
  from: string;
  to: string;
  moving: number[];
  skipped: Array<{ id: number; label: string; reason: string; message: string }>;
  customersAffected: number;
  summary: string;
  applied: boolean;
}

async function moveDay(body: { from: string; to: string; preview?: boolean }): Promise<DayMovePlan> {
  const response = await protectedFetch(`${BASE}/api/calendar/move-day`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((parsed as { error?: string })?.error ?? "The day could not be moved");
  return parsed as DayMovePlan;
}

/** The day after a given YYYY-MM-DD, as the first suggestion. */
function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, 12)).toISOString().slice(0, 10);
}

/**
 * Why a job is staying put. The planner has three reasons, not two: the day
 * being moved to can refuse it as well. Guessing between the first two printed
 * "completed" over a blocked job, which sent people looking at the wrong one.
 */
function skipReason(job: { reason: string; message: string }): string {
  if (job.reason === "blocked") return readableBlockMessage(job.message);
  return job.reason === "invoiced" ? "invoiced" : "completed";
}

export function MoveDayDialog({
  from, onClose, onMoved,
}: {
  /** The day being moved, or null when the dialog is closed. */
  from: string | null;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [plan, setPlan] = useState<DayMovePlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setTo(from ? nextDay(from) : "");
    setPlan(null);
    setProblem(null);
  }, [from]);

  const preview = useMutation({
    mutationFn: () => moveDay({ from: from!, to, preview: true }),
    onSuccess: (result) => { setPlan(result); setProblem(null); },
    onError: (error) => { setPlan(null); setProblem(error instanceof Error ? error.message : null); },
  });

  // Ask what it would do whenever the target date is a usable one.
  useEffect(() => {
    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to === from) {
      setPlan(null);
      setProblem(to === from && from ? "The day is already on that date" : null);
      return;
    }
    preview.mutate();
    // The mutation identity is stable enough; re-previewing on every render is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const apply = useMutation({
    mutationFn: () => moveDay({ from: from!, to }),
    onSuccess: (result) => {
      onMoved();
      onClose();
      toast({ title: "Day moved", description: result.summary });
    },
    onError: (error) => toast({
      title: "Could not move the day",
      description: error instanceof Error ? error.message : undefined,
      variant: "destructive",
    }),
  });

  if (!from) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-2xl" data-testid="move-day-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-primary" />
            Move {formatDateOnly(from)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="move-day-to" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Move everything to
            </Label>
            <Input
              id="move-day-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="rounded-xl"
            />
          </div>

          {preview.isPending && (
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Working out what would move…
            </p>
          )}

          {problem && <p className="text-xs font-semibold text-red-600">{problem}</p>}

          {plan && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="move-day-plan">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                {plan.moving.length} {plan.moving.length === 1 ? "job" : "jobs"}
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                {formatDateOnly(plan.to)}
              </p>

              {plan.skipped.length > 0 && (
                <div className="space-y-1">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Staying on {formatDateOnly(plan.from)}
                  </p>
                  <ul className="space-y-0.5 pl-5 text-xs text-slate-600">
                    {plan.skipped.map((job) => (
                      <li key={job.id} className="list-disc">
                        {job.label} — {skipReason(job)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* The office decides about telling people, once, rather than
                  being asked twenty-five times. */}
              <p className="border-t border-slate-200 pt-2 text-[11px] text-slate-500">
                {plan.customersAffected} {plan.customersAffected === 1 ? "customer has" : "customers have"} work
                on this day. <strong>Nobody will be told automatically</strong> — tell them yourself if the
                change affects them.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => apply.mutate()}
            disabled={!plan || plan.moving.length === 0 || apply.isPending}
            className="h-9 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-40"
          >
            {apply.isPending ? "Moving…" : `Move ${plan?.moving.length ?? 0} ${plan?.moving.length === 1 ? "job" : "jobs"}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
