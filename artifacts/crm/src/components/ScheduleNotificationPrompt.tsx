/**
 * "Do you want to tell the customer?" — asked after a job is booked or moved.
 *
 * Kyle, 2026-09-24 #4: *"The prompt should ask whether the user wants to send a
 * scheduling notification to the customer. Nothing should be sent automatically
 * simply because a job was scheduled, dragged, moved, or edited."*
 *
 * The server decides whether there is anything to ask — it returns
 * `scheduleNotification` on the job update — so every screen asks the same
 * question on the same terms.
 *
 * It is mounted **once**, near the root, and screens simply call
 * `askAboutSchedule(...)`. Two reasons: the reschedule dialog on the Schedule
 * page closes itself the moment it saves, so a prompt owned by that component
 * would unmount before it could be answered; and `TOAST_LIMIT` is 1, which the
 * calendar's undo toast already occupies, so this has to be a dialog anyway.
 */
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { protectedFetch } from "@/lib/auth-scope";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface ScheduleNotificationDecision {
  prompt: boolean;
  kind: "scheduled" | "rescheduled" | "unscheduled" | "none";
  channels: Array<"email" | "sms">;
  reason: string;
  summary: string;
}

/** Whatever a job update returned; only `id` and `scheduleNotification` are read. */
export interface JobUpdateResult {
  id?: number;
  scheduleNotification?: ScheduleNotificationDecision | null;
}

interface Pending { jobId: number; decision: ScheduleNotificationDecision }

let listener: ((pending: Pending) => void) | null = null;

/**
 * Called by any screen that has just moved a job. Does nothing unless the server
 * said there is something to ask, so call sites need no rules of their own.
 */
export function askAboutSchedule(result: JobUpdateResult | null | undefined): void {
  const decision = result?.scheduleNotification;
  if (!decision?.prompt || typeof result?.id !== "number") return;
  listener?.({ jobId: result.id, decision });
}

const CHANNEL_WORD: Record<string, string> = { email: "email", sms: "text message" };
const readable = (channels: string[]) => channels.map((c) => CHANNEL_WORD[c] ?? c).join(" and ");

export function ScheduleNotificationPromptHost() {
  const { toast } = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listener = (next) => setPending(next);
    return () => { listener = null; };
  }, []);

  async function answer(send: boolean) {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await protectedFetch(`${BASE}/api/jobs/${pending.jobId}/schedule-notification`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ send, kind: pending.decision.kind }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { error?: string })?.error ?? "Could not record your answer");
      if (send) {
        toast({
          title: "The customer will be told",
          description: `Queued by ${readable(pending.decision.channels)}.`,
        });
      }
    } catch (error) {
      toast({
        title: "Could not record your answer", variant: "destructive",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <Dialog open={Boolean(pending)} onOpenChange={(next) => { if (!next && !busy) setPending(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-amber-500" />
            Tell the customer?
          </DialogTitle>
          <DialogDescription>
            {pending?.decision.summary} Nothing has been sent yet.
          </DialogDescription>
        </DialogHeader>
        {pending && (
          <p className="text-sm text-slate-600">
            We can let them know by {readable(pending.decision.channels)}.
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" disabled={busy} onClick={() => answer(false)}>
            No, don’t tell them
          </Button>
          <Button disabled={busy} onClick={() => answer(true)}>
            {busy ? "Saving…" : "Yes, tell them"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
