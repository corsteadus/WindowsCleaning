import { useEffect, useState } from "react";
import { CalendarCheck2, MapPin, ShieldCheck } from "lucide-react";
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
  id: number; description: string; quantity: number; unitPrice: number; totalPrice: number; propertyId: number | null;
}
interface Preview {
  accepted: boolean;
  requiresVerbalAcceptance: boolean;
  revisionNumber: number;
  snapshot: { quote: { notes?: string | null }; locations: Location[]; lineItems: SnapshotLine[] };
  existingJobs: Array<{ id: number; jobNumber: string }>;
}
interface ScheduleRow {
  propertyId: number; scheduledDate: string; scheduledStartTime: string; scheduledEndTime: string;
  crewId: string; assignedUserId: string; jobNotes: string;
}

export function EstimateConversionDialog({ quoteId }: { quoteId: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
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

  useEffect(() => {
    const locations = preview.data?.snapshot.locations;
    if (!locations) return;
    setRows((current) => {
      // Keep what the office has already typed when the estimate is the same
      // one, and start over when its locations have actually changed.
      const sameLocations = current.length === locations.length
        && locations.every((location) => current.some((row) => row.propertyId === location.id));
      if (sameLocations) return current;
      return locations.map((location) => ({
        propertyId: location.id, scheduledDate: "", scheduledStartTime: "09:00",
        scheduledEndTime: "11:00", crewId: "", assignedUserId: "", jobNotes: "",
      }));
    });
  }, [preview.data]);

  const commit = useMutation({
    mutationFn: () => api<{ jobs: Array<{ id: number; jobNumber: string }> }>(
      `/quotes/${quoteId}/convert-and-schedule`,
      {
        method: "POST",
        headers: { "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify({
          verbalAcceptance: verbal,
          verbalAcceptanceNote: verbal ? verbalNote : undefined,
          schedules: rows.map((row) => ({
            propertyId: row.propertyId,
            scheduledDate: row.scheduledDate,
            scheduledStartTime: row.scheduledStartTime,
            scheduledEndTime: row.scheduledEndTime,
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
      toast({ title: `${result.jobs.length} ${result.jobs.length === 1 ? "job" : "jobs"} scheduled` });
      setOpen(false);
      if (result.jobs[0]) navigate(`/jobs/${result.jobs[0].id}`);
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });

  const update = (propertyId: number, patch: Partial<ScheduleRow>) =>
    setRows((current) => current.map((row) => row.propertyId === propertyId ? { ...row, ...patch } : row));
  // Kyle #15: the button used to go quiet when it was disabled. One function
  // now decides both whether it is enabled and what the screen says about it,
  // so the two can never disagree.
  const blockers = preview.data
    ? conversionBlockers({
      locationCount: preview.data.snapshot.locations.length,
      rows,
      requiresVerbalAcceptance: preview.data.requiresVerbalAcceptance,
      verbalRecorded: verbal,
      verbalNote,
    })
    : [];
  const ready = !!preview.data && blockers.length === 0;

  return <>
    <Button onClick={() => {
      // The query is mounted for the life of the page, so toggling `enabled`
      // alone would serve whatever it read the first time.
      queryClient.invalidateQueries({ queryKey: ["estimate-conversion-preview", quoteId] });
      setOpen(true);
    }} className="bg-emerald-600 hover:bg-emerald-700">
      <CalendarCheck2 className="mr-2 h-4 w-4" /> Convert to Customer & Schedule
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl">
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
            <div><p className="text-sm font-bold text-emerald-900">Revision {preview.data.revisionNumber} is the scheduling source</p><p className="text-xs text-emerald-700 mt-1">Services, quantities, and prices below are copied unchanged into each location job.</p></div>
          </div>
          {preview.data.existingJobs.length > 0 && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">This estimate already has {preview.data.existingJobs.length} scheduled job(s). Submitting again returns those existing jobs.</div>}
          {preview.data.requiresVerbalAcceptance && <div className="space-y-3 rounded-xl border border-amber-200 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={verbal} onChange={(event) => setVerbal(event.target.checked)} /> Record authorized verbal acceptance</label>
            {verbal && <div><Label>Acceptance documentation</Label><Textarea className="mt-1.5" value={verbalNote} onChange={(event) => setVerbalNote(event.target.value)} placeholder="Who accepted, how, and when…" /></div>}
          </div>}
          <div className="space-y-4">
            {preview.data.snapshot.locations.map((location) => {
              const row = rows.find((item) => item.propertyId === location.id);
              const lines = preview.data!.snapshot.lineItems.filter((line) =>
                line.propertyId === location.id || (preview.data!.snapshot.locations.length === 1 && line.propertyId === null),
              );
              return <div key={location.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex gap-2"><MapPin className="h-4 w-4 text-primary mt-0.5" /><div><p className="font-bold text-sm">{location.name || location.address}</p><p className="text-xs text-slate-500">{location.address}, {location.city}, {location.state} {location.zip}</p></div></div>
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs space-y-1">{lines.map((line) => <div key={line.id} className="flex justify-between gap-3"><span>{line.quantity} × {line.description}</span><strong>${Number(line.totalPrice).toFixed(2)}</strong></div>)}</div>
                {row && <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><Label>Date</Label><Input type="date" value={row.scheduledDate} onChange={(event) => update(location.id, { scheduledDate: event.target.value })} /></div>
                  <div><Label>Start</Label><TimeSelect aria-label="Start time" value={row.scheduledStartTime} onChange={(value) => update(location.id, { scheduledStartTime: value })} /></div>
                  <div><Label>End</Label><TimeSelect aria-label="End time" value={row.scheduledEndTime} onChange={(value) => update(location.id, { scheduledEndTime: value })} /></div>
                  <div><Label>Crew</Label><Select value={row.crewId || "none"} onValueChange={(value) => update(location.id, { crewId: value === "none" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{(crews.data ?? []).filter((crew) => crew.isActive).map((crew) => <SelectItem key={crew.id} value={String(crew.id)}>{crew.name}</SelectItem>)}</SelectContent></Select></div>
                  <div><Label>Employee</Label><Select value={row.assignedUserId || "none"} onValueChange={(value) => update(location.id, { assignedUserId: value === "none" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{(employees.data ?? []).map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.displayName}</SelectItem>)}</SelectContent></Select></div>
                  <div className="sm:col-span-3"><Label>Job notes</Label><Textarea value={row.jobNotes} onChange={(event) => update(location.id, { jobNotes: event.target.value })} placeholder="Location-specific instructions…" /></div>
                </div>}
              </div>;
            })}
          </div>
        </>}
        {preview.data && !preview.isFetching && blockers.length > 0 && (
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
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            data-testid="conversion-submit"
            disabled={!ready || commit.isPending || preview.isFetching}
            onClick={() => commit.mutate()}
          >
            {commit.isPending ? "Scheduling all locations…" : `Schedule ${rows.length || ""} ${rows.length === 1 ? "job" : "jobs"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}