/**
 * The job drawer on the calendar.
 *
 * Phase 14, Step 3 — the other half of filters. The office's question about a
 * card on the month is almost always the same one: who is it for, where, when,
 * who is going, and is it invoiced. Answering it should not cost the month.
 *
 * It opens with what the card already held — the grid has that in memory, so
 * there is no spinner over the basics — and the full job fills in the phone
 * number, the address and the notes a moment later. The merge and its
 * precedence live in `lib/job-drawer.ts`, where they are tested.
 */
import { getGetJobQueryKey, useGetJob } from "@workspace/api-client-react";
import { Briefcase, Building2, Clock, MapPin, Phone, StickyNote, User } from "lucide-react";
import { Link } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/StatusBadge";
import type { CalendarOccurrence } from "@/lib/calendar-api";
import { jobDrawerSummary } from "@/lib/job-drawer";
import { formatCurrency } from "@/lib/utils";

function Line({
  icon: Icon, label, children,
}: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <div className="text-sm text-slate-800">{children}</div>
      </div>
    </div>
  );
}

export function JobSideDrawer({
  occurrence, onClose, onOpenJob,
}: {
  /** Null when nothing is open. The card is what the drawer opens from. */
  occurrence: CalendarOccurrence | null;
  onClose: () => void;
  onOpenJob: (jobId: number) => void;
}) {
  // Only asked for while the drawer is open, and only for the job in it.
  const detailQuery = useGetJob(occurrence?.id ?? 0, {
    query: {
      enabled: Boolean(occurrence),
      queryKey: getGetJobQueryKey(occurrence?.id ?? 0),
    },
  });

  if (!occurrence) return null;
  const summary = jobDrawerSummary(occurrence, detailQuery.data as never);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="job-drawer">
        <SheetHeader className="text-left">
          <SheetTitle className="pr-6 text-base">{summary.customerName}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <StatusBadge status={summary.status} />
            {summary.invoiceStatus && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-600">
                Invoice {summary.invoiceStatus}
              </span>
            )}
            {summary.jobNumber && (
              <span className="text-[11px] text-slate-400">{summary.jobNumber}</span>
            )}
          </div>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          <Line icon={Clock} label="When">
            <p className="font-medium">{summary.when}</p>
            <p className="text-slate-500">{summary.time}</p>
          </Line>

          <Line icon={Briefcase} label="Work">
            {summary.serviceType || "No service named"}
          </Line>

          <Line icon={MapPin} label="Where">
            {summary.where ?? "No property on this job"}
          </Line>

          <Line icon={User} label="Who">
            {summary.who}
          </Line>

          {summary.amountCents !== null && (
            <Line icon={Building2} label="Value">
              {formatCurrency(summary.amountCents / 100)}
            </Line>
          )}

          {/* These two only exist once the full job has arrived. */}
          {summary.customerPhone && (
            <Line icon={Phone} label="Phone">
              <a href={`tel:${summary.customerPhone}`} className="hover:underline">{summary.customerPhone}</a>
            </Line>
          )}

          {summary.notes && (
            <Line icon={StickyNote} label="Notes">
              <p className="whitespace-pre-wrap text-slate-600">{summary.notes}</p>
            </Line>
          )}

          {summary.loadingDetail && (
            <p className="text-[11px] text-slate-400">Loading the rest of this job…</p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => { onClose(); onOpenJob(summary.jobId); }}
            className="h-9 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white"
          >
            Open the job
          </button>
          {summary.customerId !== null && (
            <Link
              href={`/customers/${summary.customerId}`}
              onClick={onClose}
              className="flex h-9 items-center rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Open the profile
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
