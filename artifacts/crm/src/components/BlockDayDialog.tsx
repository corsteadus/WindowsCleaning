/**
 * Marking days as not bookable.
 *
 * Spec V1 #12 and §7.15. A block is not a job (§11.4): a blocked day counts no
 * work and carries no value. Two kinds, and the dialog says what each one does
 * rather than leaving "hard" and "soft" to be guessed at:
 *
 * - **hard** refuses a booking — the day the business is closed;
 * - **soft** warns and lets the scheduler decide — a crew on training.
 *
 * Soft is the default, because the posture everywhere else on this calendar is
 * to warn rather than refuse: only the person booking knows whether the
 * exception is deliberate.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarOff, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimeSelect } from "@/components/TimeSelect";
import { useToast } from "@/hooks/use-toast";
import { createCalendarBlock } from "@/lib/calendar-api";

export function BlockDayDialog({
  open, onClose, onSaved, crews,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  crews: Array<{ id: number; name: string }>;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [scope, setScope] = useState<"company" | "crew">("company");
  const [crewId, setCrewId] = useState("");
  const [mode, setMode] = useState<"hard" | "soft">("soft");
  const [problem, setProblem] = useState<string | null>(null);

  const reset = () => {
    setTitle(""); setStartDate(""); setEndDate(""); setAllDay(true);
    setStartTime(""); setEndTime(""); setScope("company"); setCrewId("");
    setMode("soft"); setProblem(null);
  };

  const save = useMutation({
    mutationFn: () => createCalendarBlock({
      title,
      startDate,
      endDate: endDate || null,
      isAllDay: allDay,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      scopeType: scope,
      crewId: scope === "crew" ? Number(crewId) : null,
      blockMode: mode,
    }),
    onSuccess: (block) => {
      onSaved();
      reset();
      onClose();
      toast({
        title: "Day blocked",
        description: block.blockMode === "hard"
          ? `${block.title} — bookings on it will be refused`
          : `${block.title} — bookings on it will warn first`,
      });
    },
    onError: (error) => setProblem(error instanceof Error ? error.message : "The block could not be saved"),
  });

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md rounded-2xl" data-testid="block-day-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarOff className="h-4 w-4 text-primary" />
            Block days
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="block-title" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What is it for
            </Label>
            <Input
              id="block-title"
              value={title}
              onChange={(event) => { setProblem(null); setTitle(event.target.value); }}
              placeholder="Christmas Day, crew training, van in for service…"
              className="rounded-xl"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="block-start" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                From
              </Label>
              <Input id="block-start" type="date" value={startDate} className="rounded-xl"
                onChange={(event) => { setProblem(null); setStartDate(event.target.value); }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block-end" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                To <span className="font-normal normal-case text-slate-400">(optional)</span>
              </Label>
              <Input id="block-end" type="date" value={endDate} className="rounded-xl"
                onChange={(event) => { setProblem(null); setEndDate(event.target.value); }} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-slate-900"
              checked={allDay}
              onChange={(event) => { setProblem(null); setAllDay(event.target.checked); }}
            />
            All day
          </label>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="block-from-time" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  From
                </Label>
                <TimeSelect id="block-from-time" value={startTime} onChange={setStartTime} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="block-to-time" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  To
                </Label>
                <TimeSelect id="block-to-time" value={endTime} onChange={setEndTime} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applies to</Label>
            <div className="flex flex-wrap items-center gap-2">
              {([["company", "Everyone"], ["crew", "One crew"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  onClick={() => { setProblem(null); setScope(value); }}
                  className={`h-8 rounded-lg border px-3 text-xs font-semibold transition-colors
                    ${scope === value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  {label}
                </button>
              ))}
              {scope === "crew" && (
                <select
                  aria-label="Which crew"
                  value={crewId}
                  onChange={(event) => { setProblem(null); setCrewId(event.target.value); }}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
                >
                  <option value="">Choose a crew</option>
                  {crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
                </select>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What should happen
            </Label>
            <div className="flex flex-wrap gap-2">
              {([
                ["soft", "Warn first", "A booking is allowed once somebody confirms"],
                ["hard", "Refuse", "A booking on these days is turned away"],
              ] as const).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => { setProblem(null); setMode(value); }}
                  title={hint}
                  className={`h-8 rounded-lg border px-3 text-xs font-semibold transition-colors
                    ${mode === value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">
              {mode === "hard"
                ? "Work cannot be booked on these days until the block is lifted."
                : "Work can still be booked; whoever books it is told about the block first."}
            </p>
          </div>

          {problem && <p className="text-xs font-semibold text-red-600">{problem}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={() => { reset(); onClose(); }}
            className="h-9 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-40"
          >
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Block {mode === "hard" ? "and refuse" : "and warn"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
