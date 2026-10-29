import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, Clock, FileText, MapPin, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { createIdempotencyKey } from "@/lib/idempotency";
import { protectedFetch } from "@/lib/auth-scope";
import { TimeSelect } from "@/components/TimeSelect";
import { conversionBlockers } from "@/lib/conversion-readiness";
import {
  addMinutes, arrivalSummary, DEFAULT_DURATION, DEFAULT_WINDOW, DURATION_OPTIONS, minutesLabel, WINDOW_OPTIONS, type ArrivalMode,
} from "@/lib/conversion-times";
import { applyDiscounts, discountLabel, type Discount } from "@/lib/discounts";
import { salesTax } from "@/lib/sales-tax";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(`${BASE}/api${path}`, {
    ...init, credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? "Request failed");
  return body as T;
}

interface Location {
  id: number; name?: string | null; address: string; city: string; state: string; zip: string; notes?: string | null;
}
interface SnapshotLine {
  /** null while still to be quoted (Kyle, 2026-10-24). */
  id: number; description: string; quantity: number; unitPrice: number | null; totalPrice: number; propertyId: number | null; taxable?: boolean;
}
interface Preview {
  accepted: boolean;
  requiresVerbalAcceptance: boolean;
  revisionNumber: number;
  acceptanceMethod: "customer" | null;
  snapshot: { quote: { notes?: string | null }; locations: Location[]; lineItems: SnapshotLine[]; discounts?: Discount[]; tax?: { rate: number; label: string | null } | null };
  /** A4: every service offered, and the ones the customer took (where the ticks start). */
  offeredLineItems?: SnapshotLine[];
  acceptedLineItemIds?: number[];
  existingJobs: Array<{ id: number; jobNumber: string }>;
  /** Video 7: what the customer wrote when accepting online. */
  customerNotes?: string | null;
}
interface ScheduleRow {
  propertyId: number; scheduledDate: string; scheduledStartTime: string;
  mode: ArrivalMode; windowMinutes: number; durationMinutes: number;
  crewId: string; assignedUserId: string; jobNotes: string;
}

const cents = (value: number) => Math.round(Number(value) * 100);

/**
 * Schedule an accepted estimate — A4 (Kyle, Video 7). The customer's choice is
 * ticked to start with; the office can untick a service or tick a declined one
 * back. Each location gets a date, an exact time or an arrival window, and how
 * long the work takes. "Schedule + create invoice" makes the draft invoice with
 * the jobs. The server re-checks every one of these and works the money out itself.
 */
export function EstimateConversionDialog({ quoteId, open: openProp, onOpenChange, hideTrigger }: {
  quoteId: number;
  /** Controlled from outside — the profile's "Convert to Customer" picker. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => { setOpenState(next); onOpenChange?.(next); };
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [verbal, setVerbal] = useState(false);
  const [verbalNote, setVerbalNote] = useState("");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const preview = useQuery({
    queryKey: ["estimate-conversion-preview", quoteId],
    queryFn: () => api<Preview>(`/quotes/${quoteId}/conversion-preview`),
    enabled: open,
    // Never schedule from a cached answer. Between one opening and the next
    // the office may have corrected the status to Accepted, or edited the
    // estimate — and a stale preview would tell them nobody has accepted it
    // when somebody just did.
    staleTime: 0,
    refetchOnMount: "always",
  });
  const crews = useQuery({
    queryKey: ["crews", "estimate-conversion"],
    queryFn: () => api<Array<{ id: number; name: string; isActive: boolean }>>("/crews"),
    enabled: open,
  });
  const employees = useQuery({
    queryKey: ["estimate-employees", "conversion"],
    queryFn: () => api<Array<{ id: string; displayName: string }>>("/estimate-employees"),
    enabled: open,
  });

  const data = preview.data;
  // Everything offered (older servers: what was accepted), the customer's choice, and what is ticked now.
  const offered = data?.offeredLineItems ?? data?.snapshot.lineItems ?? [];
  const acceptedIds = useMemo(() => new Set(data?.acceptedLineItemIds ?? data?.snapshot.lineItems.map((l) => l.id) ?? []), [data]);
  const allLocations = data?.snapshot.locations ?? [];
  const single = allLocations.length === 1;
  const linesAt = (locationId: number) => offered.filter((line) => line.propertyId === locationId || (single && line.propertyId === null));
  const activeLocations = allLocations.filter((location) => linesAt(location.id).some((line) => chosen.has(line.id)));

  useEffect(() => {
    if (!data) return;
    setChosen(new Set(data.acceptedLineItemIds ?? data.snapshot.lineItems.map((line) => line.id)));
    setRows((current) => {
      // Keep what the office has already typed when the estimate is the same
      // one, and start over when its locations have actually changed.
      const locations = data.snapshot.locations;
      const sameLocations = current.length === locations.length
        && locations.every((location) => current.some((row) => row.propertyId === location.id));
      if (sameLocations) return current;
      return locations.map((location) => ({
        propertyId: location.id, scheduledDate: "", scheduledStartTime: "09:00",
        mode: "exact" as ArrivalMode, windowMinutes: DEFAULT_WINDOW, durationMinutes: DEFAULT_DURATION,
        crewId: "", assignedUserId: "", jobNotes: "",
      }));
    });
  }, [data]);

  const activeRows = rows.filter((row) => activeLocations.some((location) => location.id === row.propertyId));
  const selected = offered.filter((line) => chosen.has(line.id));
  const added = selected.filter((line) => !acceptedIds.has(line.id));
  const removed = offered.filter((line) => acceptedIds.has(line.id) && !chosen.has(line.id));
  // The money for what is ticked, by the same rules as the server (discounts, then tax).
  const money = useMemo(() => {
    const subtotal = selected.reduce((sum, line) => sum + cents(line.totalPrice), 0) / 100;
    const discounted = applyDiscounts(subtotal, data?.snapshot.discounts ?? []);
    const tax = salesTax(selected.map((line) => ({ totalPrice: Number(line.totalPrice), taxable: Boolean(line.taxable) })), discounted.discountTotal, data?.snapshot.tax?.rate ?? null).tax;
    return { ...discounted, tax, total: (cents(discounted.total) + cents(tax)) / 100 };
  }, [selected, data]);
  const unpricedTicked = selected.filter((line) => line.unitPrice == null);

  const commit = useMutation({
    mutationFn: (createInvoice: boolean) => api<{ jobs: Array<{ id: number; jobNumber: string }>; invoice?: { id: number; invoiceNumber: string } | null }>(
      `/quotes/${quoteId}/convert-and-schedule`,
      {
        method: "POST",
        headers: { "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify({
          verbalAcceptance: verbal,
          verbalAcceptanceNote: verbal ? verbalNote : undefined,
          lineItemIds: [...chosen],
          createInvoice,
          schedules: activeRows.map((row) => ({
            propertyId: row.propertyId,
            scheduledDate: row.scheduledDate,
            scheduledStartTime: row.scheduledStartTime,
            durationMinutes: row.durationMinutes,
            arrivalWindowMinutes: row.mode === "window" ? row.windowMinutes : null,
            crewId: row.crewId ? Number(row.crewId) : null,
            assignedUserIds: row.assignedUserId ? [row.assignedUserId] : [],
            jobNotes: row.jobNotes || null,
          })),
        }),
      },
    ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["estimate-lifecycle", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["estimate-conversion-preview", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      const jobs = `${result.jobs.length} ${result.jobs.length === 1 ? "job" : "jobs"} scheduled`;
      toast({ title: result.invoice ? `${jobs} · invoice ${result.invoice.invoiceNumber} created as a draft` : jobs });
      setOpen(false);
      // With an invoice the next step is usually sending it; otherwise the job.
      if (result.invoice) navigate(`/invoices/${result.invoice.id}`);
      else if (result.jobs[0]) navigate(`/jobs/${result.jobs[0].id}`);
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });

  const update = (propertyId: number, patch: Partial<ScheduleRow>) =>
    setRows((current) => current.map((row) => row.propertyId === propertyId ? { ...row, ...patch } : row));
  const toggle = (id: number) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Kyle #15: one function decides both whether the button is enabled and what
  // the screen says about it, so the two can never disagree.
  const blockers = data
    ? conversionBlockers({
      locationCount: activeLocations.length,
      servicesTicked: chosen.size,
      rows: activeRows.map((row) => {
        const end = addMinutes(row.scheduledStartTime, row.durationMinutes);
        const windowEnd = row.mode === "window" ? addMinutes(row.scheduledStartTime, row.windowMinutes) : "ok";
        return {
          propertyId: row.propertyId, scheduledDate: row.scheduledDate, scheduledStartTime: row.scheduledStartTime,
          scheduledEndTime: end ?? "23:59", runsPastMidnight: !end || !windowEnd,
        };
      }),
      requiresVerbalAcceptance: data.requiresVerbalAcceptance,
      verbalRecorded: verbal,
      verbalNote,
      unpriced: unpricedTicked.length
        ? `${unpricedTicked.map((line) => `“${line.description}”`).join(", ")} ${unpricedTicked.length === 1 ? "is" : "are"} still to be quoted — untick ${unpricedTicked.length === 1 ? "it" : "them"} to schedule the rest, or`
        : null,
    })
    : [];
  const ready = !!preview.data && blockers.length === 0;
  const jobCount = activeLocations.length;

  return <>
    {!hideTrigger && <Button onClick={() => {
      // The query is mounted for the life of the page, so toggling `enabled`
      // alone would serve whatever it read the first time.
      queryClient.invalidateQueries({ queryKey: ["estimate-conversion-preview", quoteId] });
      setOpen(true);
    }} className="bg-emerald-600 hover:bg-emerald-700">
      <CalendarCheck2 className="mr-2 h-4 w-4" /> Convert to Customer & Schedule
    </Button>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl" data-testid="conversion-dialog">
        <DialogHeader>
          <DialogTitle>Schedule accepted estimate</DialogTitle>
        </DialogHeader>
        {/* isFetching, not isLoading: on a reopen the cached answer is already
            rendered, and showing it while a fresh one is on the way told the
            office nobody had accepted an estimate they had just accepted. */}
        {preview.isFetching && <div className="py-12 text-center text-sm text-slate-500">Loading locked estimate snapshot…</div>}
        {preview.isError && !preview.isFetching && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{(preview.error as Error).message}</div>}
        {preview.data && !preview.isFetching && <>
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <ShieldCheck className="h-5 w-5 text-emerald-700 shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-900">Revision {data!.revisionNumber} is the scheduling source</p>
              <p className="text-xs text-emerald-700 mt-1">
                {data!.acceptanceMethod === "customer" ? "The services the customer accepted are ticked. " : ""}
                Untick anything you are not doing now, or tick a declined service the customer has since asked for. Prices are copied unchanged.
              </p>
            </div>
          </div>
          {data!.customerNotes && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm" data-testid="convert-customer-notes">
              <p className="font-semibold text-amber-900">Customer Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-800">{data!.customerNotes}</p>
            </div>
          )}
          {data!.existingJobs.length > 0 && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">This estimate already has {data!.existingJobs.length} scheduled job(s). Submitting again returns those existing jobs.</div>}
          {data!.requiresVerbalAcceptance && <div className="space-y-3 rounded-xl border border-amber-200 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={verbal} onChange={(event) => setVerbal(event.target.checked)} /> Record authorized verbal acceptance</label>
            {verbal && <div><Label>Acceptance documentation</Label><Textarea className="mt-1.5" value={verbalNote} onChange={(event) => setVerbalNote(event.target.value)} placeholder="Who accepted, how, and when…" /></div>}
          </div>}

          <div className="space-y-4">
            {allLocations.map((location) => {
              const row = rows.find((item) => item.propertyId === location.id);
              const lines = linesAt(location.id);
              const active = lines.some((line) => chosen.has(line.id));
              return <div key={location.id} className={`rounded-xl border p-4 ${active ? "border-slate-200" : "border-dashed border-slate-200 bg-slate-50/60"}`} data-testid="conversion-location">
                <div className="flex gap-2"><MapPin className="h-4 w-4 text-primary mt-0.5" /><div><p className="font-bold text-sm">{location.name || location.address}</p><p className="text-xs text-slate-500">{location.address}, {location.city}, {location.state} {location.zip}</p></div></div>
                <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white">
                  {lines.map((line) => {
                    const on = chosen.has(line.id);
                    const declined = !acceptedIds.has(line.id);
                    return <label key={line.id} data-testid="conversion-line" className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm ${on ? "" : "text-slate-400"}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(line.id)} aria-label={`Schedule ${line.description}`} className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className={on ? "font-medium text-slate-800" : "line-through"}>{line.quantity} × {line.description}</span>
                        {declined && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800" data-testid="conversion-line-declined">Declined by the customer</span>}
                      </span>
                      <strong className="tabular-nums">{line.unitPrice == null ? "To be quoted" : formatCurrency(Number(line.totalPrice))}</strong>
                    </label>;
                  })}
                </div>
                {!active && <p className="mt-3 text-xs text-slate-500" data-testid="conversion-location-skipped">No services ticked here, so no job is made for this location.</p>}
                {row && active && <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div><Label>Date</Label><Input type="date" value={row.scheduledDate} onChange={(event) => update(location.id, { scheduledDate: event.target.value })} /></div>
                  <div className="sm:col-span-2">
                    <Label className="block">Arrival</Label>
                    <div className="mt-1.5 inline-flex rounded-lg border border-slate-200 p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Arrival">
                      {(["exact", "window"] as const).map((mode) => (
                        <button key={mode} type="button" role="radio" aria-checked={row.mode === mode} data-testid={`arrival-mode-${mode}`}
                          onClick={() => update(location.id, { mode })}
                          className={`rounded-md px-3 py-1.5 ${row.mode === mode ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                          {mode === "exact" ? "Exact time" : "Arrival window"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div><Label>{row.mode === "window" ? "Window opens" : "Arrive at"}</Label><TimeSelect aria-label="Start time" value={row.scheduledStartTime} onChange={(value) => update(location.id, { scheduledStartTime: value })} /></div>
                  {row.mode === "window" && <div><Label>Window</Label>
                    <select aria-label="Arrival window" data-testid="arrival-window" value={row.windowMinutes} onChange={(event) => update(location.id, { windowMinutes: Number(event.target.value) })}
                      className="mt-0 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      {WINDOW_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutesLabel(minutes)}</option>)}
                    </select></div>}
                  <div><Label>Job takes</Label>
                    <select aria-label="Duration" data-testid="job-duration" value={row.durationMinutes} onChange={(event) => update(location.id, { durationMinutes: Number(event.target.value) })}
                      className="mt-0 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      {DURATION_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutesLabel(minutes)}</option>)}
                    </select></div>
                  <p className="sm:col-span-3 flex items-center gap-1.5 text-xs font-medium text-slate-600" data-testid="arrival-summary">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />{arrivalSummary(row.scheduledStartTime, row.mode, row.windowMinutes, row.durationMinutes)}
                  </p>
                  <div><Label>Crew</Label><Select value={row.crewId || "none"} onValueChange={(value) => update(location.id, { crewId: value === "none" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{(crews.data ?? []).filter((crew) => crew.isActive).map((crew) => <SelectItem key={crew.id} value={String(crew.id)}>{crew.name}</SelectItem>)}</SelectContent></Select></div>
                  <div><Label>Employee</Label><Select value={row.assignedUserId || "none"} onValueChange={(value) => update(location.id, { assignedUserId: value === "none" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{(employees.data ?? []).map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.displayName}</SelectItem>)}</SelectContent></Select></div>
                  <div className="sm:col-span-3"><Label>Job notes</Label><Textarea value={row.jobNotes} onChange={(event) => update(location.id, { jobNotes: event.target.value })} placeholder="Location-specific instructions…" /></div>
                </div>}
              </div>;
            })}
          </div>

          {/* What is being scheduled, worked out as the server will. */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm" data-testid="conversion-summary">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-600">{selected.length} {selected.length === 1 ? "service" : "services"} · {jobCount} {jobCount === 1 ? "job" : "jobs"}</span>
              <span className="text-base font-bold tabular-nums text-slate-900" data-testid="conversion-total">{formatCurrency(money.total)}</span>
            </div>
            {(money.discounts.length > 0 || money.tax > 0) && (
              <p className="mt-1 text-xs text-slate-500" data-testid="convert-discounts">
                {formatCurrency(money.subtotal)} of services
                {money.discounts.map((d) => ` · ${discountLabel(d)} −${formatCurrency(d.amount)}`).join("")}
                {money.tax > 0 ? ` · ${data!.snapshot.tax?.label ?? "Sales tax"} +${formatCurrency(money.tax)}` : ""}
              </p>
            )}
            {(added.length > 0 || removed.length > 0) && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="conversion-changed">
                Different from what the customer accepted:
                {added.length > 0 && ` adding ${added.map((l) => l.description).join(", ")}`}
                {added.length > 0 && removed.length > 0 && ";"}
                {removed.length > 0 && ` leaving out ${removed.map((l) => l.description).join(", ")}`}. This is noted in the estimate's history.
              </p>
            )}
          </div>
        </>}
        {data && !preview.isFetching && blockers.length > 0 && (
          <div data-testid="conversion-blockers" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
              Before this can be scheduled
            </p>
            <ul className="mt-2 space-y-1 text-sm text-amber-900">
              {blockers.map((blocker) => (
                <li key={blocker} className="flex gap-2">
                  <span aria-hidden="true">•</span><span>{blocker}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="outline" data-testid="conversion-submit-invoice"
            disabled={!ready || commit.isPending || preview.isFetching}
            onClick={() => commit.mutate(true)}>
            <FileText className="mr-2 h-4 w-4" /> Schedule + create invoice
          </Button>
          <Button
            data-testid="conversion-submit"
            disabled={!ready || commit.isPending || preview.isFetching}
            onClick={() => commit.mutate(false)}
          >
            {commit.isPending ? "Scheduling…" : `Schedule ${jobCount || ""} ${jobCount === 1 ? "job" : "jobs"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
