/**
 * Invoicing a range of finished work.
 *
 * Spec V1 #26, §13.1 and the fifth prototype test. The office finishes a week
 * and bills it; doing that one job at a time is where the evening goes.
 *
 * The screen shows what it is about to create before it creates it, grouped
 * the way the bill will arrive — **one invoice per customer**, each line
 * naming its job. Everything in the range that will not be billed is listed
 * with the reason, so nothing is left out quietly.
 *
 * Ticking is per job, not per customer: a week often holds one visit the
 * office wants to hold back.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, FileText, Loader2, Receipt } from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatDateOnly } from "@/lib/quote-settings-form";
import {
  bulkInvoice, formatCents, skipHeading,
  type BulkInvoicePlan,
} from "@/lib/bulk-invoice-api";

export function BulkInvoiceDialog({
  open, range, onClose, onCreated,
}: {
  open: boolean;
  /** The month on screen, as the range to offer first. */
  range: { from: string; to: string };
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [plan, setPlan] = useState<BulkInvoicePlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Null means "nothing has been unticked", which is everything. An empty set
  // is a real choice: the office has unticked all of it.
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    setFrom(range.from);
    setTo(range.to);
    setPlan(null);
    setProblem(null);
    setExcluded(new Set());
  }, [open, range.from, range.to]);

  const preview = useMutation({
    mutationFn: () => bulkInvoice({ from, to, preview: true }),
    onSuccess: (result) => { setPlan(result); setProblem(null); setExcluded(new Set()); },
    onError: (error) => {
      setPlan(null);
      setProblem(error instanceof Error ? error.message : "The range could not be read");
    },
  });

  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
    preview.mutate();
    // Re-previewing on every render is not wanted; the dates are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, from, to]);

  /** What is still ticked, and what that comes to. */
  const chosen = useMemo(() => {
    const groups = (plan?.groups ?? [])
      .map((group) => {
        const lines = group.lines.filter((line) => !excluded.has(line.jobId));
        return { ...group, lines, totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0) };
      })
      .filter((group) => group.lines.length > 0);
    return {
      groups,
      jobIds: groups.flatMap((group) => group.lines.map((line) => line.jobId)),
      totalCents: groups.reduce((sum, group) => sum + group.totalCents, 0),
    };
  }, [plan, excluded]);

  const create = useMutation({
    mutationFn: () => bulkInvoice({ from, to, jobIds: chosen.jobIds }),
    onSuccess: (result) => {
      onCreated();
      onClose();
      toast({ title: "Invoices created", description: result.summary });
    },
    onError: (error) => toast({
      title: "Could not create the invoices",
      description: error instanceof Error ? error.message : undefined,
      variant: "destructive",
    }),
  });

  const toggle = (jobId: number) => setExcluded((current) => {
    const next = new Set(current);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl" data-testid="bulk-invoice-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 text-primary" />
            Create invoices
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-from" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                From
              </Label>
              <Input id="bulk-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-to" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                To
              </Label>
              <Input id="bulk-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl" />
            </div>
          </div>

          {preview.isPending && (
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Working out what would be invoiced…
            </p>
          )}

          {problem && <p className="text-xs font-semibold text-red-600">{problem}</p>}

          {plan && plan.groups.length === 0 && !preview.isPending && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              No finished work waiting to be invoiced between {formatDateOnly(plan.from)} and{" "}
              {formatDateOnly(plan.to)}.
            </p>
          )}

          {plan && plan.groups.length > 0 && (
            <div className="max-h-64 space-y-2 overflow-y-auto" data-testid="bulk-invoice-plan">
              {plan.groups.map((group) => (
                <div key={group.customerId} className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="flex items-center justify-between text-sm font-semibold text-slate-900">
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-slate-400" />
                      {group.customerLabel}
                    </span>
                    <span>
                      {formatCents(
                        group.lines
                          .filter((line) => !excluded.has(line.jobId))
                          .reduce((sum, line) => sum + line.amountCents, 0),
                      )}
                    </span>
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {group.lines.map((line) => (
                      <li key={line.jobId}>
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={!excluded.has(line.jobId)}
                            onChange={() => toggle(line.jobId)}
                            aria-label={`Invoice ${line.description}`}
                            className="h-3.5 w-3.5 rounded border-slate-300"
                          />
                          <span className="flex-1 truncate">{line.description}</span>
                          <span className="font-semibold text-slate-700">{formatCents(line.amountCents)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Nothing is left out quietly. */}
          {plan && plan.skipped.length > 0 && (
            <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid="bulk-invoice-skipped">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                Not being invoiced ({plan.skipped.length})
              </p>
              <ul className="space-y-0.5 pl-5 text-xs text-slate-600">
                {plan.skipped.map((job) => (
                  <li key={job.id} className="list-disc">
                    {job.label} — {skipHeading(job.reason).toLowerCase()}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan && chosen.groups.length > 0 && (
            <p className="border-t border-slate-200 pt-2 text-sm font-semibold text-slate-800" data-testid="bulk-invoice-total">
              {chosen.groups.length} {chosen.groups.length === 1 ? "invoice" : "invoices"} ·{" "}
              {chosen.jobIds.length} {chosen.jobIds.length === 1 ? "job" : "jobs"} ·{" "}
              {formatCents(chosen.totalCents)}
            </p>
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
            onClick={() => create.mutate()}
            disabled={chosen.groups.length === 0 || create.isPending || preview.isPending}
            className="h-9 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-40"
          >
            {create.isPending
              ? "Creating…"
              : `Create ${chosen.groups.length} ${chosen.groups.length === 1 ? "invoice" : "invoices"}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
