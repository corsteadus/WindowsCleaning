import { blockDropForOccurrence, readableBlockMessage, type BlockDrop } from "@/lib/calendar-block-conflicts";
import { BulkInvoiceDialog } from "@/components/BulkInvoiceDialog";
import { monthRange } from "@/lib/bulk-invoice-api";
import { formatDateOnly } from "@/lib/quote-settings-form";
import { formatTimeOfDay } from "@/lib/time-of-day";
import { CalendarFilterBar } from "@/components/CalendarFilterBar";
import { JobSideDrawer } from "@/components/JobSideDrawer";
import { MoveDayDialog } from "@/components/MoveDayDialog";
import { BlockDayDialog } from "@/components/BlockDayDialog";
import {
  type CalendarFilterState,
  NO_CALENDAR_FILTERS,
  amountsAreHidden,
  assignmentOptions,
  filterOccurrences,
  isFiltering,
  totalsFromOccurrences,
} from "@/lib/calendar-filters";
import { askAboutSchedule, type JobUpdateResult } from "@/components/ScheduleNotificationPrompt";
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
import { AlertTriangle, CalendarClock, CalendarOff, Receipt, RefreshCw } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import {
  getListCrewsQueryKey, getListJobsQueryKey, useListCrews, useUpdateJob,
} from "@workspace/api-client-react";
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
import { describeSpan, findCrewOverlaps } from "@/lib/crew-overlap";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchCalendarBlocks,
  liftCalendarBlock,
  type SchedulingBlock,
  fetchCalendarOccurrences,
  fetchCalendarTotals,
  sumDayTotals,
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
  /** V1 #26. Billing is its own capability, not the one that moves work. */
  canInvoice?: boolean;
  /** Spec Step 3. Omitted means an unfiltered month, and no filter bar. */
  filters?: CalendarFilterState;
  onFiltersChange?: (next: CalendarFilterState) => void;
  savingFilters?: boolean;
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
  return formatTimeOfDay(occurrence.startTime) || "No time";
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
  onMoveDay,
  blocks,
  onLiftBlock,
}: {
  day: GridDay;
  occurrences: CalendarOccurrence[];
  jobCount: number;
  valueCents: number | null;
  inMonth: boolean;
  onOpenJob: (jobId: number) => void;
  onOpenDay?: (date: string) => void;
  canMove: boolean;
  onMoveDay?: (date: string) => void;
  blocks?: SchedulingBlock[];
  onLiftBlock?: (block: SchedulingBlock) => void;
}) {
  // Adjacent-month days are drop targets too: moving a job across a month
  // boundary should not require navigating away first.
  const { setNodeRef, isOver } = useDroppable({ id: day.date, disabled: !canMove });

  return (
    <div
      ref={setNodeRef}
      data-testid="calendar-day"
      data-date={day.date}
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
        <span className="flex items-center gap-1">
          {jobCount > 0 && (
            <span className="text-[9px] font-semibold text-slate-400">{jobCount}</span>
          )}
          {/* V1 #11. Rendered, not revealed on hover: a tablet has no hover. */}
          {canMove && jobCount > 0 && onMoveDay && (
            <button
              type="button"
              aria-label={`Move the work on ${day.date} to another day`}
              onClick={() => onMoveDay(day.date)}
              className="rounded p-0.5 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <CalendarClock className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>

      {/* Blocks first, and deliberately unlike a job card: a blocked day is
          not work, and §11.4 says it must never read as any. */}
      {(blocks ?? []).map((block) => (
        <button
          key={block.id}
          type="button"
          data-testid="calendar-block"
          data-block-mode={block.blockMode}
          onClick={() => onLiftBlock?.(block)}
          disabled={!onLiftBlock}
          title={block.blockMode === "hard"
            ? `${block.title} — bookings are refused. Click to lift.`
            : `${block.title} — bookings warn first. Click to lift.`}
          className={`mb-1 w-full truncate rounded px-1 py-0.5 text-left text-[9px] font-bold uppercase tracking-wide
            ${block.blockMode === "hard"
              ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
              : "bg-amber-100 text-amber-800 hover:bg-amber-200"}`}
        >
          {block.title}
        </button>
      ))}

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
  canInvoice = false,
  filters = NO_CALENDAR_FILTERS,
  onFiltersChange,
  savingFilters,
}: MonthCalendarProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dragging, setDragging] = useState<CalendarOccurrence | null>(null);
  // The card that is open in the drawer. Holding the whole occurrence, not
  // just an id, is what lets the drawer open with an answer already in it.
  const [openJob, setOpenJob] = useState<CalendarOccurrence | null>(null);
  const [movingDay, setMovingDay] = useState<string | null>(null);
  const [blockingDays, setBlockingDays] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  // Only asked for while somebody is actually writing a block.
  const crewsQuery = useListCrews({
    query: { enabled: blockingDays, queryKey: getListCrewsQueryKey() },
  });
  // A held move: a crew already booked, a soft block on the day, or both.
  // One dialog for both, because being asked twice about one drag teaches
  // people to click through without reading.
  const [conflict, setConflict] = useState<{
    occurrence: CalendarOccurrence;
    from: string;
    to: string;
    clashes: CalendarOccurrence[];
    /** A soft block on the day, when there is one. */
    warning: Extract<BlockDrop, { kind: "warn" }> | null;
  } | null>(null);

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

  // Spec V1 #12. Bounded by the same window as everything else here.
  const blocksQuery = useQuery({
    queryKey: authScopedQueryKey(user, ["calendar-blocks", range.start, range.end]),
    queryFn: () => fetchCalendarBlocks(range),
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

  const allOccurrences = occurrencesQuery.data?.occurrences ?? [];
  // Only the assignments actually booked this month are worth offering.
  const options = useMemo(() => assignmentOptions(allOccurrences), [allOccurrences]);
  const visibleOccurrences = useMemo(
    () => filterOccurrences(allOccurrences, filters),
    [allOccurrences, filters],
  );
  const hiddenCount = allOccurrences.length - visibleOccurrences.length;
  const filtering = isFiltering(filters);

  // One pass over the response, not one filter per cell.
  const buckets = useMemo(() => bucketByDate(visibleOccurrences), [visibleOccurrences]);
  // While a filter is on, the footers count what is on screen. The server's
  // totals are the whole month's, and a cell showing three jobs under a footer
  // saying eleven is a disagreement nobody trusts twice.
  // A block can span days, so each day it covers gets its own entry.
  const blocksByDate = useMemo(() => {
    const map = new Map<string, SchedulingBlock[]>();
    for (const block of blocksQuery.data?.blocks ?? []) {
      const last = block.endDate ?? block.startDate;
      for (let date = block.startDate; date <= last;) {
        map.set(date, [...(map.get(date) ?? []), block]);
        const [year, month, day] = date.split("-").map(Number);
        date = new Date(Date.UTC(year, month - 1, day + 1, 12)).toISOString().slice(0, 10);
      }
    }
    return map;
  }, [blocksQuery.data]);

  const dayTotals = useMemo(
    () => (filtering
      ? totalsFromOccurrences(visibleOccurrences, { amountsHidden: amountsAreHidden(totalsQuery.data) })
      : totalsByDate(totalsQuery.data)),
    [filtering, visibleOccurrences, totalsQuery.data],
  );

  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);

  // The summary is the month's, not the grid's. Both reads are asked for the
  // whole grid so the spilled days can be drawn and dropped onto, but a day
  // spilled in from August belongs to August's figures — and appears in both
  // months' grids, so counting it here would report the same job twice.
  const inMonthDates = useMemo(() => {
    const dates = new Set<string>();
    for (const week of grid.weeks) {
      for (const day of week.days) if (day.inMonth) dates.add(day.date);
    }
    return dates;
  }, [grid]);
  const period = useMemo(
    () => {
      if (!filtering) return sumDayTotals(totalsQuery.data, (date) => inMonthDates.has(date));
      if (!totalsQuery.data) return undefined;
      const amountsHidden = amountsAreHidden(totalsQuery.data);
      const summed = { jobCount: 0, completedCount: 0, scheduledValueCents: amountsHidden ? null : 0, durationMinutes: 0 };
      for (const [date, day] of dayTotals) {
        if (!inMonthDates.has(date)) continue;
        summed.jobCount += day.jobCount;
        summed.completedCount += day.completedCount;
        summed.durationMinutes += day.durationMinutes;
        if (!amountsHidden && day.scheduledValueCents !== null) {
          summed.scheduledValueCents = (summed.scheduledValueCents ?? 0) + day.scheduledValueCents;
        }
      }
      return summed;
    },
    [filtering, totalsQuery.data, dayTotals, inMonthDates],
  );
  const error = occurrencesQuery.error ?? totalsQuery.error;

  const refreshCalendar = useCallback(() => {
    // Totals are the server's, not a client-side sum, so both reads have to be
    // re-asked after a move or the footers drift from the grid.
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["calendar-occurrences"]) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["calendar-totals"]) });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
  }, [queryClient, user]);

  const refreshBlocks = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["calendar-blocks"]) });
  }, [queryClient, user]);

  /**
   * Lifting a block is a small, reversible act, so it asks once and does it —
   * the block is switched off rather than erased, and can be put back.
   */
  const liftBlock = useCallback((block: SchedulingBlock) => {
    if (!window.confirm(`Lift "${block.title}"? Work can be booked on these days again.`)) return;
    liftCalendarBlock(block.id)
      .then(() => {
        refreshBlocks();
        toast({ title: "Block lifted", description: block.title });
      })
      .catch((error: unknown) => toast({
        title: "Could not lift the block",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }));
  }, [refreshBlocks, toast]);

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

  // Undo is a second forward move, not a rollback, so it must not ask again:
  // the net effect of move-then-undo is that nothing changed.
  const moveJob = useCallback(
    (jobId: number, to: string, ask = true) =>
      moveMutation
        .mutateAsync({ id: jobId, data: { scheduledDate: to } })
        .then((updated) => { if (ask) askAboutSchedule(updated as unknown as JobUpdateResult); })
        .catch(() => { /* the mutation's own onError has already explained it */ }),
    [moveMutation],
  );

  const commitMove = useCallback(
    (occurrence: CalendarOccurrence, from: string, to: string) => {
      moveJob(occurrence.id, to);
      toast({
        title: `${occurrence.customerLabel} moved`,
        description: `${from} → ${to}`,
        duration: UNDO_WINDOW_MS,
        action: (
          <ToastAction altText="Undo the move" onClick={() => moveJob(occurrence.id, from, false)}>
            Undo
          </ToastAction>
        ),
      });
    },
    [moveJob, toast],
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

      // The day being dropped on is already painted, so its jobs and its
      // blocks are both in hand: neither check costs a read.
      // Spec #34: a hard block refuses the drop outright. The server refuses it
      // too — this is the same answer given in the moment rather than after a
      // round trip.
      const blocked = blockDropForOccurrence(occurrence, drop.to, blocksByDate.get(drop.to) ?? []);
      if (blocked.kind === "refused") {
        toast({
          title: "Cannot move this job",
          description: readableBlockMessage(blocked.message),
          variant: "destructive",
        });
        return;
      }

      const clashes = findCrewOverlaps(occurrence, buckets.get(drop.to) ?? []);
      if (clashes.length || blocked.kind === "warn") {
        // A warning, not a refusal — the spec reserves refusal for hard blocks,
        // and only the scheduler knows whether the exception is deliberate.
        setConflict({
          occurrence,
          from: drop.from,
          to: drop.to,
          clashes,
          warning: blocked.kind === "warn" ? blocked : null,
        });
        return;
      }

      commitMove(occurrence, drop.from, drop.to);
    },
    [blocksByDate, buckets, commitMove, toast],
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
      {/* Spec Step 3. The bar lives here because this is where the month's cards
          are: it can offer only the assignments actually booked, with counts. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        {onFiltersChange ? (
          <CalendarFilterBar
            options={options}
            state={filters}
            onChange={onFiltersChange}
            hiddenCount={hiddenCount}
            saving={savingFilters}
          />
        ) : <span />}

        {/* V1 #12. Beside the filters, because both are about what the month
            shows rather than about any one job. */}
        {canMove && (
          <button
            type="button"
            onClick={() => setBlockingDays(true)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5
                       text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50"
          >
            <CalendarOff className="h-3.5 w-3.5" />
            Block days
          </button>
        )}
        {canInvoice && (
          <button
            type="button"
            onClick={() => setInvoicing(true)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5
                       text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50"
          >
            <Receipt className="h-3.5 w-3.5" />
            Create invoices
          </button>
        )}
      </div>

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
                      onOpenJob={(jobId) => setOpenJob(buckets.get(day.date)?.find((card) => card.id === jobId) ?? null)}
                      onMoveDay={setMovingDay}
                      blocks={blocksByDate.get(day.date) ?? []}
                      {...(canMove ? { onLiftBlock: liftBlock } : {})}
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

    {/* A crew already booked, a soft block, or both. The move is held, not
        cancelled: the scheduler sees what it would run into and decides. */}
    <Dialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            {conflict?.clashes.length
              ? `${conflict.occurrence.crewName ?? "This crew"} is already booked`
              : "This day is marked off"}
          </DialogTitle>
        </DialogHeader>

        {conflict && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {conflict.clashes.length ? (
                <>
                  Moving <span className="font-semibold text-slate-900">{conflict.occurrence.customerLabel}</span>{" "}
                  to {formatDateOnly(conflict.to)} overlaps {conflict.clashes.length === 1 ? "another job" : `${conflict.clashes.length} other jobs`}{" "}
                  already on {conflict.occurrence.crewName ?? "this crew"}.
                </>
              ) : (
                <>
                  Moving <span className="font-semibold text-slate-900">{conflict.occurrence.customerLabel}</span>{" "}
                  to {formatDateOnly(conflict.to)}, which is marked off.
                </>
              )}
            </p>

            {/* The block is named. "That day is blocked" without saying which
                is the kind of message people learn to click past. */}
            {conflict.warning?.blocks.map((block) => (
              <div
                key={block.id}
                data-testid="drop-block-warning"
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
              >
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Marked off</p>
                <p className="text-sm font-semibold text-slate-900">{block.title}</p>
                <p className="text-xs text-slate-600">
                  {block.reason ?? "This is a soft block — work can still be booked."}
                </p>
              </div>
            ))}

            {conflict.clashes.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 divide-y divide-amber-100">
              <div className="px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Moving</p>
                <p className="text-sm font-semibold text-slate-900">{conflict.occurrence.customerLabel}</p>
                <p className="text-xs text-slate-600">{describeSpan(conflict.occurrence)}</p>
              </div>
              {conflict.clashes.map((clash) => (
                <div key={clash.id} className="px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Already booked</p>
                  <p className="text-sm font-semibold text-slate-900">{clash.customerLabel}</p>
                  <p className="text-xs text-slate-600">{describeSpan(clash)}</p>
                </div>
              ))}
            </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <button
            onClick={() => setConflict(null)}
            className="flex-1 h-10 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (conflict) commitMove(conflict.occurrence, conflict.from, conflict.to);
              setConflict(null);
            }}
            className="flex-1 h-10 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors"
          >
            Schedule anyway
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* V1 #26: the month's finished work, billed in one go. The range it
        offers is the month on screen, which is the question being asked. */}
    <BulkInvoiceDialog
      open={invoicing}
      range={monthRange(year, month)}
      onClose={() => setInvoicing(false)}
      onCreated={refreshCalendar}
    />

    {/* Step 3: the card's own drawer. It opens over the month rather than
        taking the person off it. */}
    <JobSideDrawer
      occurrence={openJob}
      onClose={() => setOpenJob(null)}
      onOpenJob={onOpenJob}
    />

    <MoveDayDialog
      from={movingDay}
      onClose={() => setMovingDay(null)}
      onMoved={refreshCalendar}
    />

    <BlockDayDialog
      open={blockingDays}
      onClose={() => setBlockingDays(false)}
      onSaved={refreshBlocks}
      crews={(crewsQuery.data ?? []).map((crew) => ({ id: crew.id, name: crew.name ?? `Crew #${crew.id}` }))}
    />

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
