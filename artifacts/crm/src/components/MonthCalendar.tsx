import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { getListJobsQueryKey, useUpdateJob } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { authScopedQueryKey } from "@/lib/auth-scope";
import {
  UNDO_WINDOW_MS,
  canDrag,
  dragBlockMessage,
  dragBlockReason,
  resolveMonthDrop,
} from "@/lib/calendar-drag";
import {
  fetchCalendarOccurrences,
  fetchCalendarTotals,
  totalsByDate,
  type CalendarOccurrence,
} from "@/lib/calendar-api";
import {
  bucketByDate,
  buildMonthGrid,
  formatCents,
  shiftMonth,
  weekdayLabels,
  type GridDay,
  type MonthGrid,
  type WeekStart,
} from "@/lib/calendar-grid";

/**
 * The month grid.
 *
 * Two reads back this view, and both are bounded by the grid it is about to
 * paint. Occurrences carry a card's worth of fields; totals are summed by the
 * database and arrive one row per day. Nothing here loads a month of jobs in
 * order to count them, so a busy month costs what a quiet one does.
 */

type MonthCalendarProps = {
  year: number;
  month: number;
  weekStartsOn: WeekStart;
  today?: Date;
  onOpenJob: (jobId: number) => void;
  onOpenDay?: (date: string) => void;
  /** Whether this viewer may reschedule. Read-only viewers get no drag. */
  canMove: boolean;
};

const STATUS_ACCENT: Record<string, string> = {
  scheduled: "border-l-blue-400",
  in_progress: "border-l-amber-400",
  completed: "border-l-emerald-300",
};

/** Invoice state colours the card body; everything else stays neutral. */
const INVOICE_TINT: Record<string, string> = {
  paid: "bg-emerald-50/70",
  sent: "bg-rose-50/60",
  overdue: "bg-rose-50/60",
  partially_paid: "bg-rose-50/60",
  pending: "bg-rose-50/60",
};

function occurrenceTint(occurrence: CalendarOccurrence): string {
  if (!occurrence.invoiceStatus) return "bg-white";
  return INVOICE_TINT[occurrence.invoiceStatus] ?? "bg-white";
}

function timeLabel(occurrence: CalendarOccurrence): string {
  if (!occurrence.startTime) return "No time";
  const [h, m] = occurrence.startTime.split(":").map(Number);
  const ampm = h >= 12 ? "p" : "a";
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${ampm}`;
}

/** The card's contents, shared by the real card and the drag preview. */
function OccurrenceBody({ occurrence }: { occurrence: CalendarOccurrence }) {
  const detail = [occurrence.serviceType, occurrence.crewName].filter(Boolean).join(" · ");
  return (
    <>
      <div className="flex items-baseline gap-1">
        <span className="text-[9px] font-semibold text-slate-500 shrink-0">
          {timeLabel(occurrence)}
        </span>
        {occurrence.isRecurring && (
          <span className="text-[8px] font-bold text-indigo-500 shrink-0" title="Recurring">R</span>
        )}
      </div>
      <p className="text-[11px] font-semibold text-slate-800 truncate leading-tight">
        {occurrence.customerLabel}
      </p>
      {detail && <p className="text-[9px] text-slate-400 truncate">{detail}</p>}
      {occurrence.amountCents !== null && (
        <p className="text-[9px] font-semibold text-slate-500">
          {formatCents(occurrence.amountCents)}
        </p>
      )}
    </>
  );
}

function OccurrenceCard({
  occurrence,
  onOpen,
  draggable,
}: {
  occurrence: CalendarOccurrence;
  onOpen: (jobId: number) => void;
  draggable: boolean;
}) {
  const accent = STATUS_ACCENT[occurrence.status] ?? "border-l-slate-300";
  const detail = [occurrence.serviceType, occurrence.crewName].filter(Boolean).join(" · ");
  const blocked = dragBlockReason(occurrence);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: occurrence.id,
    disabled: !draggable,
    data: { occurrence },
  });

  const reason = blocked ? dragBlockMessage(blocked) : null;

  return (
    <button
      ref={setNodeRef}
      onClick={() => onOpen(occurrence.id)}
      title={reason ?? `${occurrence.customerLabel}${detail ? ` — ${detail}` : ""}`}
      {...(draggable ? listeners : {})}
      {...attributes}
      className={`w-full text-left rounded-md border border-slate-200 border-l-[3px] ${accent}
                  ${occurrenceTint(occurrence)} px-1.5 py-1 hover:border-slate-300
                  hover:shadow-sm transition-all
                  ${draggable ? "cursor-grab active:cursor-grabbing" : ""}
                  ${isDragging ? "opacity-30" : ""}`}
    >
      <OccurrenceBody occurrence={occurrence} />
    </button>
  );
}

function DayCell({
  day,
  occurrences,
  jobCount,
  valueCents,
  inMonth,
  onOpenJob,
  onOpenDay,
  canMove,
}: {
  day: GridDay;
  occurrences: CalendarOccurrence[];
  jobCount: number;
  valueCents: number | null;
  inMonth: boolean;
  onOpenJob: (jobId: number) => void;
  onOpenDay?: (date: string) => void;
  canMove: boolean;
}) {
  // Adjacent-month days are drop targets too: moving a job across a month
  // boundary should not require navigating away first.
  const { setNodeRef, isOver } = useDroppable({ id: day.date, disabled: !canMove });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col border-r border-b border-slate-200 min-h-[112px] p-1 transition-colors
        ${inMonth ? "bg-white" : "bg-slate-50/70"}
        ${isOver ? "bg-primary/10 ring-2 ring-inset ring-primary/50" : ""}
        ${day.isToday && !isOver ? "ring-2 ring-inset ring-primary/40" : ""}`}
    >
      <div className="flex items-center justify-between px-0.5 pb-1">
        <button
          onClick={() => onOpenDay?.(day.date)}
          className={`text-xs font-bold leading-none rounded px-1 py-0.5 transition-colors
            ${day.isToday ? "bg-primary text-white" : inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-100"}`}
        >
          {day.dayOfMonth}
        </button>
        {jobCount > 0 && (
          <span className="text-[9px] font-semibold text-slate-400">{jobCount}</span>
        )}
      </div>

      {/* Every job is drawn. The cell grows; work is never hidden behind a
          "+2 more" link the office has to click to trust the day. */}
      <div className="flex-1 space-y-1">
        {occurrences.map((occurrence) => (
          <OccurrenceCard
            key={occurrence.id}
            occurrence={occurrence}
            onOpen={onOpenJob}
            draggable={canMove && canDrag(occurrence)}
          />
        ))}
      </div>

      {jobCount > 0 && valueCents !== null && (
        <p className="text-[9px] font-semibold text-slate-500 text-right pt-1 px-0.5">
          {formatCents(valueCents)}
        </p>
      )}
    </div>
  );
}

export function MonthCalendar({
  year,
  month,
  weekStartsOn,
  today,
  onOpenJob,
  onOpenDay,
  canMove,
}: MonthCalendarProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dragging, setDragging] = useState<CalendarOccurrence | null>(null);

  // Pointer drags start only after a short distance so a click still opens the
  // job. Keyboard dragging is kept, because a calendar that can only be
  // rearranged with a mouse excludes anyone who does not use one.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const grid: MonthGrid = useMemo(
    () => buildMonthGrid(year, month, { weekStartsOn, ...(today ? { today } : {}) }),
    [year, month, weekStartsOn, today],
  );
  const range = grid.range;

  const occurrencesQuery = useQuery({
    queryKey: authScopedQueryKey(user, ["calendar-occurrences", range.start, range.end]),
    queryFn: () => fetchCalendarOccurrences(range),
    // Keep the previous month on screen while the next one loads, so paging
    // through months does not blank the grid on every click.
    placeholderData: (previous) => previous,
  });

  const totalsQuery = useQuery({
    queryKey: authScopedQueryKey(user, ["calendar-totals", range.start, range.end]),
    queryFn: () => fetchCalendarTotals(range),
    placeholderData: (previous) => previous,
  });

  // Warm the neighbouring months once this one has settled. Paging is the
  // common gesture, and both reads are already bounded, so the cost is one
  // small window either side rather than a wider fetch.
  useEffect(() => {
    if (occurrencesQuery.isFetching) return;
    for (const delta of [-1, 1]) {
      const { year: y, month: m } = shiftMonth(year, month, delta);
      const neighbour = buildMonthGrid(y, m, { weekStartsOn }).range;
      queryClient.prefetchQuery({
        queryKey: authScopedQueryKey(user, ["calendar-occurrences", neighbour.start, neighbour.end]),
        queryFn: () => fetchCalendarOccurrences(neighbour),
      });
      queryClient.prefetchQuery({
        queryKey: authScopedQueryKey(user, ["calendar-totals", neighbour.start, neighbour.end]),
        queryFn: () => fetchCalendarTotals(neighbour),
      });
    }
  }, [year, month, weekStartsOn, occurrencesQuery.isFetching, queryClient, user]);

  // One pass over the response, not one filter per cell.
  const buckets = useMemo(
    () => bucketByDate(occurrencesQuery.data?.occurrences ?? []),
    [occurrencesQuery.data],
  );
  const dayTotals = useMemo(() => totalsByDate(totalsQuery.data), [totalsQuery.data]);

  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);
  const period = totalsQuery.data?.period;
  const error = occurrencesQuery.error ?? totalsQuery.error;

  const refreshCalendar = useCallback(() => {
    // Totals are the server's, not a client-side sum, so both reads have to be
    // re-asked after a move or the footers drift from the grid.
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["calendar-occurrences"]) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["calendar-totals"]) });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
  }, [queryClient, user]);

  const moveMutation = useUpdateJob({
    mutation: {
      onSuccess: refreshCalendar,
      onError: (err: unknown) => {
        const detail = (err as { data?: { error?: string } } | null)?.data?.error;
        toast({
          title: "Could not move the job",
          ...(detail ? { description: detail } : {}),
          variant: "destructive",
        });
        // The optimistic grid is now wrong; re-read rather than guess.
        refreshCalendar();
      },
    },
  });

  const moveJob = useCallback(
    (jobId: number, to: string) =>
      moveMutation.mutate({ id: jobId, data: { scheduledDate: to } }),
    [moveMutation],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(null);
      const occurrence = event.active.data.current?.occurrence as CalendarOccurrence | undefined;
      const target = event.over?.id;
      if (!occurrence || typeof target !== "string") return;

      const drop = resolveMonthDrop(occurrence, target);
      if (drop.kind === "unchanged") return;
      if (drop.kind === "blocked") {
        toast({ title: "Cannot move this job", description: dragBlockMessage(drop.reason), variant: "destructive" });
        return;
      }

      moveJob(drop.jobId, drop.to);
      toast({
        title: `${occurrence.customerLabel} moved`,
        description: `${drop.from} → ${drop.to}`,
        duration: UNDO_WINDOW_MS,
        action: (
          <ToastAction altText="Undo the move" onClick={() => moveJob(drop.jobId, drop.from)}>
            Undo
          </ToastAction>
        ),
      });
    },
    [moveJob, toast],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragging((event.active.data.current?.occurrence as CalendarOccurrence) ?? null);
  }, []);

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
        <AlertTriangle className="w-5 h-5 text-rose-500 mx-auto mb-2" />
        <p className="text-sm font-semibold text-rose-800">Could not load the calendar</p>
        <p className="text-xs text-rose-600 mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
    <div className="space-y-3">
      {occurrencesQuery.data?.truncated && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            This month holds more than {occurrencesQuery.data.limit} jobs, so the grid is showing
            the first {occurrencesQuery.data.limit}. Day and month totals below remain complete.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
        <div className="grid grid-cols-7 bg-slate-100">
          {labels.map((label) => (
            <div
              key={label}
              className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center border-r border-slate-200 last:border-r-0"
            >
              {label}
            </div>
          ))}
        </div>

        {grid.weeks.map((week) => {
          const weekTotal = week.days.reduce(
            (acc, day) => {
              const total = dayTotals.get(day.date);
              return {
                jobs: acc.jobs + (total?.jobCount ?? 0),
                cents: total?.scheduledValueCents === null || total === undefined
                  ? acc.cents
                  : (acc.cents ?? 0) + total.scheduledValueCents,
              };
            },
            { jobs: 0, cents: 0 as number | null },
          );

          return (
            <div key={week.key}>
              <div className="grid grid-cols-7 border-t border-slate-200">
                {week.days.map((day) => {
                  const total = dayTotals.get(day.date);
                  return (
                    <DayCell
                      key={day.date}
                      day={day}
                      occurrences={buckets.get(day.date) ?? []}
                      jobCount={total?.jobCount ?? 0}
                      valueCents={total?.scheduledValueCents ?? null}
                      inMonth={day.inMonth}
                      onOpenJob={onOpenJob}
                      canMove={canMove}
                      {...(onOpenDay ? { onOpenDay } : {})}
                    />
                  );
                })}
              </div>
              {weekTotal.jobs > 0 && (
                <div className="flex items-center justify-end gap-3 px-3 py-1 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500">
                  <span className="font-semibold">Week</span>
                  <span>{weekTotal.jobs} {weekTotal.jobs === 1 ? "job" : "jobs"}</span>
                  {weekTotal.cents !== null && (
                    <span className="font-semibold text-slate-700">{formatCents(weekTotal.cents)}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Month roll-up. "Scheduled Job Value" is work planned, never money
          collected — the spec is explicit that this must not read as Sales. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Scheduled jobs</span>
          <span className="text-sm font-bold text-slate-900">{period?.jobCount ?? 0}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Scheduled Job Value</span>
          <span className="text-sm font-bold text-slate-900">
            {formatCents(period?.scheduledValueCents)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Completed</span>
          <span className="text-sm font-bold text-slate-900">{period?.completedCount ?? 0}</span>
        </div>
        {(occurrencesQuery.isFetching || totalsQuery.isFetching) && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400 ml-auto">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Updating…
          </span>
        )}
      </div>
    </div>

    {/* The dragged card follows the cursor at full opacity while the original
        dims in place, so it stays clear which job is being moved. */}
    <DragOverlay dropAnimation={null}>
      {dragging && (
        <div className="w-[150px] rounded-md border border-primary/40 bg-white px-1.5 py-1 shadow-lg">
          <OccurrenceBody occurrence={dragging} />
        </div>
      )}
    </DragOverlay>
    </DndContext>
  );
}
