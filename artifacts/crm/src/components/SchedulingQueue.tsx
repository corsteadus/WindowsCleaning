import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertCircle, Calendar, Clock, ExternalLink, MapPin, PauseCircle, PlayCircle, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  QueueRequestError,
  fetchQueuePage,
  holdEntry,
  releaseEntry,
  scheduleFromQueue,
  setQueueStatus,
  type QueueCard,
} from "@/lib/schedule-queue-api";
import {
  QUEUE_STATUS_LABELS,
  QUEUE_TABS,
  appendPage,
  dropEntry,
  emptyCopy,
  formatCents,
  queueStatusLabel,
  statusChips,
  totalCount,
  waitingLabel,
  waitingTone,
  type QueueTabKey,
} from "@/lib/schedule-queue-view";

/**
 * The scheduling queue — spec §4.
 *
 * Work that is not on the calendar still has to be visible and actionable:
 * estimates that became jobs with no date yet, and jobs pulled off the calendar
 * without being cancelled.
 *
 * The list is paged, not loaded whole. A busy office accumulates hundreds of
 * undated jobs, and the endpoint this replaces returned every one of them on
 * every render of the schedule page.
 */

const TONE_CLASS = {
  fresh: "bg-slate-100 text-slate-600",
  aging: "bg-amber-100 text-amber-700",
  stale: "bg-red-100 text-red-700",
} as const;

type TransitionKind = "schedule" | "hold" | null;

/* ── One card ──────────────────────────────────────────────────────────── */

function QueueEntryCard({ card, canManage, onSchedule, onHold, onRelease, onStatus, busy }: {
  card: QueueCard;
  canManage: boolean;
  onSchedule: (card: QueueCard) => void;
  onHold: (card: QueueCard) => void;
  onRelease: (card: QueueCard) => void;
  onStatus: (card: QueueCard, status: string) => void;
  busy: boolean;
}) {
  const [, navigate] = useLocation();
  const money = formatCents(card.valueCents);
  const held = card.status === "on_hold";

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-start gap-3
                    hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md
                            ${held ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>
            {queueStatusLabel(card.queueStatus)}
          </span>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${TONE_CLASS[waitingTone(card.daysWaiting)]}`}
            title={`In the queue since ${new Date(card.queuedAt).toLocaleDateString()}`}
          >
            <Clock className="w-2.5 h-2.5 inline mr-0.5 -mt-0.5" />
            {waitingLabel(card.daysWaiting)}
          </span>
          {card.jobNumber && (
            <span className="text-[10px] text-slate-400 font-mono">{card.jobNumber}</span>
          )}
        </div>

        <p className="font-bold text-slate-900 text-sm leading-snug truncate">
          {card.customerLabel ?? "Customer"}
        </p>
        {card.propertyLabel && (
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
            <p className="text-xs text-slate-500 truncate">{card.propertyLabel}</p>
          </div>
        )}
        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
          {card.serviceType && <span className="truncate">{card.serviceType}</span>}
          {/* Null means the viewer may not see amounts — render nothing, not $0. */}
          {money && <span className="font-semibold text-slate-700">{money}</span>}
        </div>

        {held && card.onHoldReason && (
          <p className="mt-1.5 text-[11px] text-violet-700 bg-violet-50 rounded-md px-2 py-1">
            {card.onHoldReason}
          </p>
        )}

        {canManage && (
          <label className="sr-only" htmlFor={`queue-status-${card.entryId}`}>
            What this job is waiting on
          </label>
        )}
        {canManage && (
          <select
            id={`queue-status-${card.entryId}`}
            value={card.queueStatus ?? ""}
            disabled={busy}
            onChange={(event) => onStatus(card, event.target.value)}
            className="mt-2 text-[11px] border border-slate-200 rounded-md px-1.5 py-1
                       text-slate-600 bg-white disabled:opacity-50"
          >
            {!card.queueStatus && <option value="">No status</option>}
            {Object.entries(QUEUE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-1.5 shrink-0">
        {canManage && (
          <button
            onClick={() => onSchedule(card)}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary/90
                       active:scale-[.97] text-white text-[11px] font-bold transition-all disabled:opacity-50"
          >
            <Calendar className="w-3 h-3" />
            Schedule
          </button>
        )}
        {canManage && (held ? (
          <button
            onClick={() => onRelease(card)}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200
                       text-slate-600 hover:border-primary/30 hover:text-primary text-[11px]
                       font-semibold transition-colors disabled:opacity-50"
          >
            <PlayCircle className="w-3 h-3" />
            Release
          </button>
        ) : (
          <button
            onClick={() => onHold(card)}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200
                       text-slate-600 hover:border-violet-300 hover:text-violet-700 text-[11px]
                       font-semibold transition-colors disabled:opacity-50"
          >
            <PauseCircle className="w-3 h-3" />
            Hold
          </button>
        ))}
        <button
          onClick={() => navigate(`/jobs/${card.jobId}`)}
          className="flex items-center justify-center h-7 w-full rounded-lg border border-slate-200
                     text-slate-400 hover:text-primary hover:border-primary/30 transition-colors"
          title="View job"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

/* ── The queue ─────────────────────────────────────────────────────────── */

export function SchedulingQueue({ canManage, dueTab, onUnavailable }: {
  canManage: boolean;
  /** "Repeat Service Due" is sourced from recurring plans, so its content is passed in. */
  dueTab?: { count: number; content: React.ReactNode };
  /**
   * Told when the queue cannot be reached at all.
   *
   * The backfill runs at server startup, so between deploying this and enabling
   * migrations the endpoint has no table to read. The caller keeps the older
   * unscheduled list on screen in that window rather than leaving the office
   * with nothing.
   */
  onUnavailable?: (unavailable: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<QueueTabKey>("ready");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyEntry, setBusyEntry] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ kind: TransitionKind; card: QueueCard | null }>({
    kind: null, card: null,
  });
  const [form, setForm] = useState({ date: "", start: "", end: "", reason: "" });

  const entryTab = tab === "due" ? null : tab;

  /**
   * Loads one page. `after` null means the first page, which replaces the list;
   * a cursor appends. The two are one function so an append can never
   * accidentally reset the list, or a reset accidentally append.
   */
  const load = useCallback(async (after: string | null) => {
    if (!entryTab) return;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchQueuePage({ tab: entryTab, cursor: after, status: statusFilter });
      setCards((existing) => (after ? appendPage(existing, page.entries) : page.entries));
      setCounts(page.counts);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      onUnavailable?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the queue");
      // A 5xx means the endpoint or its table is not there; a 4xx means the
      // request was wrong, which is our bug to fix and not a reason to fall
      // back to the old list.
      const serverSide = !(err instanceof QueueRequestError) || err.status >= 500;
      onUnavailable?.(serverSide);
    } finally {
      setLoading(false);
    }
  }, [entryTab, statusFilter, onUnavailable]);

  // Changing tab or filter is a new list, never a continuation of the old one.
  useEffect(() => {
    setCards([]);
    setCursor(null);
    setHasMore(false);
    void load(null);
  }, [load]);

  const chips = useMemo(() => statusChips(counts), [counts]);
  const tabTotals = useMemo(() => totalCount(counts), [counts]);

  /**
   * Runs a transition and reconciles the list.
   *
   * On success the card leaves this tab, so it is dropped immediately rather
   * than waiting for a refetch — and the counts are reloaded, because the chips
   * describe the whole tab and not just what is on screen.
   *
   * On a 409 the entry moved underneath us, so the honest response is to reload
   * rather than to show a card that no longer exists in that state.
   */
  const run = useCallback(async (
    card: QueueCard,
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setBusyEntry(card.entryId);
    try {
      await action();
      setCards((existing) => dropEntry(existing, card.entryId));
      toast({ title: success });
      void load(null);
      // The calendar and the job lists both show this work; let them refetch.
      void queryClient.invalidateQueries();
    } catch (err) {
      const conflict = err instanceof QueueRequestError && err.isConflict;
      toast({
        title: conflict ? "This job moved" : "That did not work",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      if (conflict) void load(null);
    } finally {
      setBusyEntry(null);
    }
  }, [load, queryClient, toast]);

  const openSchedule = (card: QueueCard) => {
    setForm({ date: "", start: "", end: "", reason: "" });
    setDialog({ kind: "schedule", card });
  };
  const openHold = (card: QueueCard) => {
    setForm({ date: "", start: "", end: "", reason: "" });
    setDialog({ kind: "hold", card });
  };
  const closeDialog = () => setDialog({ kind: null, card: null });

  const submitSchedule = async () => {
    const card = dialog.card;
    if (!card || !form.date) return;
    closeDialog();
    await run(
      card,
      () => scheduleFromQueue(card.entryId, {
        scheduledDate: form.date,
        startTime: form.start || null,
        endTime: form.end || null,
      }),
      "Job scheduled",
    );
  };

  const submitHold = async () => {
    const card = dialog.card;
    if (!card || !form.reason.trim()) return;
    closeDialog();
    await run(card, () => holdEntry(card.entryId, { reason: form.reason.trim() }), "Job put on hold");
  };

  const tabCount = (key: QueueTabKey) => {
    if (key === "due") return dueTab?.count ?? 0;
    return key === tab ? tabTotals : undefined;
  };

  const copy = emptyCopy(tab, statusFilter !== null);

  return (
    <section className="bg-slate-50 rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {QUEUE_TABS.map((option) => {
          const count = tabCount(option.key);
          return (
            <button
              key={option.key}
              onClick={() => { setTab(option.key); setStatusFilter(null); }}
              aria-pressed={tab === option.key}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
                ${tab === option.key
                  ? "bg-primary text-white"
                  : "text-slate-500 hover:text-slate-800 hover:bg-white"}`}
            >
              {option.label}
              {count !== undefined && count > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-md text-[10px]
                  ${tab === option.key ? "bg-white/20" : "bg-slate-200 text-slate-600"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => void load(null)}
          disabled={loading}
          className="ml-auto flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800
                     px-2 py-1 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {tab === "due" ? (
        dueTab?.content ?? (
          <p className="text-xs text-slate-500 py-6 text-center">{copy.body}</p>
        )
      ) : (
        <>
          {chips.length > 0 && (
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              <button
                onClick={() => setStatusFilter(null)}
                aria-pressed={statusFilter === null}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors
                  ${statusFilter === null ? "bg-slate-800 text-white" : "bg-white text-slate-600 border border-slate-200"}`}
              >
                All {tabTotals}
              </button>
              {chips.map((chip) => (
                <button
                  key={chip.status}
                  onClick={() => setStatusFilter(statusFilter === chip.status ? null : chip.status)}
                  aria-pressed={statusFilter === chip.status}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors
                    ${statusFilter === chip.status
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300"}`}
                >
                  {chip.label} {chip.count}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200
                            rounded-lg px-3 py-2 mb-3">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {cards.length === 0 && !loading && !error ? (
            <div className="text-center py-8">
              <p className="text-sm font-semibold text-slate-700">{copy.title}</p>
              <p className="text-xs text-slate-500 mt-1">{copy.body}</p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <QueueEntryCard
                  key={card.entryId}
                  card={card}
                  canManage={canManage}
                  busy={busyEntry === card.entryId}
                  onSchedule={openSchedule}
                  onHold={openHold}
                  onRelease={(c) => void run(c, () => releaseEntry(c.entryId), "Returned to the queue")}
                  onStatus={(c, status) => void run(
                    c,
                    () => setQueueStatus(c.entryId, status),
                    `Marked ${queueStatusLabel(status)}`,
                  )}
                />
              ))}
            </div>
          )}

          {hasMore && (
            <div className="text-center mt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void load(cursor)}
              >
                {loading ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={dialog.kind === "schedule"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule {dialog.card?.customerLabel ?? "job"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="queue-schedule-date">Date</Label>
              <Input
                id="queue-schedule-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="queue-schedule-start">Start time</Label>
                <Input
                  id="queue-schedule-start"
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="queue-schedule-end">End time</Label>
                <Input
                  id="queue-schedule-end"
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Leave the times blank for an all-day job.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button disabled={!form.date} onClick={() => void submitSchedule()}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog.kind === "hold"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Put {dialog.card?.customerLabel ?? "this job"} on hold</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="queue-hold-reason">What is it waiting on?</Label>
              <Input
                id="queue-hold-reason"
                value={form.reason}
                placeholder="Customer asked us to wait until spring"
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>
            {/* Spec §4.6: holding is not cancelling, and people need telling. */}
            <p className="text-[11px] text-slate-500">
              The job keeps its price, notes and history. It comes off the calendar until you
              release it.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button disabled={!form.reason.trim()} onClick={() => void submitHold()}>
              Put on hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
