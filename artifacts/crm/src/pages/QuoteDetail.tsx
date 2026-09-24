import { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  ArrowLeft, Pencil, Send, XCircle, ArrowRightCircle, Save, Plus,
  Trash2, X, User, MapPin, FileText, Sparkles, Printer, CalendarDays,
  Mail, MessageSquare, LockKeyhole, History, Copy, CheckCircle2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  useGetQuote,
  useUpdateQuote,
  useDeleteQuote,
  convertQuote,
  getListQuotesQueryKey,
  getGetQuoteQueryKey,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { PropertyPicker } from "@/components/PropertyPicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { CORRECTABLE_ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS, estimateStatusLabel } from "@/lib/estimate-status";
import { hasClientCapability } from "@/lib/rbac";
import { useAuth } from "@workspace/replit-auth-web";
import { Link, useLocation, useParams } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { format } from "date-fns";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { EstimateConversionDialog } from "@/components/EstimateConversionDialog";
import { protectedFetch } from "@/lib/auth-scope";
import {
  chicagoAppointmentStartsAt,
  committedAppointmentMatches,
  hasAppointmentLocation,
  isoToChicagoDateTimeLocal,
} from "@/lib/chicago-time";
import { filterSelectableCrewTechnicians } from "@/lib/crew-technician-options";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
async function estimateApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(`${BASE}/api${path}`, {
    ...init, credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error ?? "Request failed");
  return body as T;
}

// Labels live in lib/estimate-status.ts so the list, the profile and this page agree.

function EstimateLifecyclePanel({ quote }: { quote: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Random Edits #4: an authorised employee may correct a status, and the
  // correction is written to the activity history by the server.
  const canCorrectStatus = hasClientCapability(user, "quotes.manage");
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState("draft");
  const [correctionReason, setCorrectionReason] = useState("");
  const key = ["estimate-lifecycle", quote.id];
  const correctStatus = useMutation({
    mutationFn: () => estimateApi<any>(`/quotes/${quote.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: correction, reason: correctionReason }),
    }),
    onSuccess: () => {
      setCorrecting(false);
      void refetch();
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast({ title: `Status corrected to ${ESTIMATE_STATUS_LABELS[correction] ?? correction}` });
    },
    onError: (cause: unknown) => toast({
      title: "Could not correct the status",
      description: cause instanceof Error ? cause.message : undefined,
      variant: "destructive",
    }),
  });
  const { data, refetch } = useQuery({
    queryKey: key,
    queryFn: () => estimateApi<any>(`/quotes/${quote.id}/estimate-lifecycle`),
  });
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [assignedUserId, setAssignedUserId] = useState("unassigned");
  const [propertyIds, setPropertyIds] = useState<number[]>([]);
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [estimateNotes, setEstimateNotes] = useState("");
  const initializedAppointmentRef = useRef("");
  const [email, setEmail] = useState(quote.customer?.email ?? quote.lead?.email ?? "");
  const [phone, setPhone] = useState(quote.customer?.phone ?? quote.lead?.phone ?? "");
  const [deliveryMethod, setDeliveryMethod] = useState("email");
  const [publicPath, setPublicPath] = useState("");
  const { data: estimateEmployees = [] } = useQuery({
    queryKey: ["estimate-employees"],
    queryFn: () => estimateApi<Array<{ id: string; displayName: string; role?: string | null; isActive?: boolean }>>("/estimate-employees"),
  });
  // Fail closed rather than offering an assignee whose active technician
  // eligibility cannot be established from the current contract.
  const selectableEstimateEmployees = filterSelectableCrewTechnicians(estimateEmployees);
  const { data: customerProperties = [] } = useQuery({
    queryKey: ["estimate-customer-properties", quote.customerId],
    enabled: Boolean(quote.customerId),
    queryFn: () => estimateApi<Array<{ id: number; name?: string | null; address?: string }>>(`/properties?customerId=${quote.customerId}`),
  });
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => estimateApi<any>(path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async (result, input) => {
      if (input.path.endsWith("/appointment")) {
        const requested = input.body as {
          startsAt: string;
          durationMinutes: number;
          propertyIds: number[];
          assignedUserId: string | null;
          appointmentNotes: string | null;
          estimateNotes: string | null;
        };
        const lifecycle = await refetch();
        if (!committedAppointmentMatches(requested, {
          ...result,
          propertyIds: lifecycle.data?.locations?.map((location: { propertyId: number }) => location.propertyId),
        })) {
          toast({
            title: "Appointment not confirmed",
            description: "The server response did not match the appointment you entered. The editor remains open.",
            variant: "destructive",
          });
          return;
        }
      }
      if (input.path.endsWith("/deliver")) setPublicPath(result.path);
      refetch();
      queryClient.invalidateQueries({ queryKey: getGetQuoteQueryKey(quote.id) });
      if (input.path.endsWith("/appointment")) {
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["estimate-appointments"] });
      }
      toast({ title: input.path.endsWith("/finalize") ? "Estimate finalized" : input.path.endsWith("/deliver") ? "Delivery queued" : input.path.endsWith("/revisions") ? "New revision ready to edit" : "Appointment saved" });
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  const status = data?.status ?? quote.status;
  const locked = !!data?.locked;
  const appointment = data?.appointment;
  const appointmentFingerprint = appointment
    ? `${appointment.id ?? ""}:${appointment.updatedAt ?? appointment.startsAt}`
    : "";
  useEffect(() => {
    if (!appointment || initializedAppointmentRef.current === appointmentFingerprint) return;
    const wallTime = isoToChicagoDateTimeLocal(appointment.startsAt);
    setDate(wallTime.slice(0, 10));
    setTime(wallTime.slice(11, 16));
    setDuration(String(appointment.durationMinutes ?? 60));
    setAssignedUserId(appointment.assignedUserId ?? "unassigned");
    setAppointmentNotes(appointment.appointmentNotes ?? "");
    setEstimateNotes(appointment.estimateNotes ?? "");
    setPropertyIds((data?.locations ?? []).map((location: { propertyId: number }) => location.propertyId));
    initializedAppointmentRef.current = appointmentFingerprint;
  }, [appointment, appointmentFingerprint, data?.locations]);
  const schedule = () => {
    const startsAt = chicagoAppointmentStartsAt(date, time);
    const durationMinutes = Number(duration);
    const retainedPropertyIds = propertyIds.length
      ? propertyIds
      : (appointment ? (data?.locations ?? []).map((location: { propertyId: number }) => location.propertyId) : quote.propertyId ? [quote.propertyId] : []);
    if (
      !startsAt || !Number.isInteger(durationMinutes) || durationMinutes < 15
      || !hasAppointmentLocation(retainedPropertyIds)
      || assignedUserId === "unassigned"
      || !selectableEstimateEmployees.some((employee) => employee.id === assignedUserId)
    ) {
      toast({ title: "Choose a valid Chicago date, time, duration, location, and active technician", variant: "destructive" });
      return;
    }
    action.mutate({ path: `/quotes/${quote.id}/appointment`, body: {
      startsAt,
      durationMinutes,
      propertyIds: retainedPropertyIds,
      assignedUserId: assignedUserId === "unassigned" ? null : assignedUserId,
      appointmentNotes: appointmentNotes || null,
      estimateNotes: estimateNotes || null,
    } });
  };
  const finalize = () => action.mutate({
    path: `/quotes/${quote.id}/finalize`,
    body: {
      notes: quote.notes, terms: quote.terms,
      lineItems: (quote.lineItems ?? []).map((line: any) => ({
        serviceId: line.serviceId, description: line.description,
        quantity: line.quantity, unitPrice: line.unitPrice, propertyId: quote.propertyId,
      })),
    },
  });
  const deliver = () => action.mutate({
    path: `/quotes/${quote.id}/deliver`,
    body: { channels: deliveryMethod === "both" ? ["email", "sms"] : [deliveryMethod], email, phone },
  });
  const secureUrl = publicPath ? `${window.location.origin}${BASE}${publicPath}` : "";
  return (
    <>
    <section className="bg-white rounded-2xl border border-sky-100 p-5 mb-4 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-bold text-slate-900">Estimate lifecycle</h2><p className="text-xs text-slate-500 mt-1">Appointment, finalization, delivery, customer activity, and decision history.</p></div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">{estimateStatusLabel(status)}</span>
          {canCorrectStatus && status !== "accepted" && status !== "accepted_scheduled" && (
            <button type="button" onClick={() => { setCorrection(status); setCorrectionReason(""); setCorrecting(true); }} className="text-[11px] font-semibold text-primary hover:underline">Correct status</button>
          )}
        </div>
      </div>
      {locked && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><div className="flex gap-2"><LockKeyhole className="h-4 w-4 mt-0.5 shrink-0" /><span>The accepted estimate snapshot is locked. Create a revision rather than changing accepted terms.</span></div><Button size="sm" disabled={action.isPending} onClick={() => action.mutate({ path: `/quotes/${quote.id}/revisions`, body: {} })}><History className="mr-2 h-4 w-4" /> Create revision</Button></div>}
      {data?.revision && status !== "accepted_scheduled" && (
        <div className="flex justify-end"><EstimateConversionDialog quoteId={quote.id} /></div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold"><CalendarDays className="h-4 w-4 text-primary" /> Appointment</h3>
          {appointment && <p className="mt-2 text-sm text-slate-600">{isoToChicagoDateTimeLocal(appointment.startsAt).replace("T", " ")} Chicago · {appointment.durationMinutes} min</p>}
          {!locked && <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2"><Input aria-label="Appointment date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><Input aria-label="Appointment start time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
            <Select value={duration} onValueChange={setDuration}><SelectTrigger aria-label="Appointment duration"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">30 minutes</SelectItem><SelectItem value="60">1 hour</SelectItem><SelectItem value="90">90 minutes</SelectItem><SelectItem value="120">2 hours</SelectItem></SelectContent></Select>
            <Select value={assignedUserId} onValueChange={setAssignedUserId}><SelectTrigger aria-label="Assigned employee"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{selectableEstimateEmployees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.displayName}</SelectItem>)}</SelectContent></Select>
            {customerProperties.map((property) => <label key={property.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={propertyIds.includes(property.id)} onChange={(event) => setPropertyIds((current) => event.target.checked ? [...new Set([...current, property.id])] : current.filter((id) => id !== property.id))} /><span>{property.name || property.address || `Property #${property.id}`}</span></label>)}
            <Textarea aria-label="Appointment notes" value={appointmentNotes} onChange={(event) => setAppointmentNotes(event.target.value)} placeholder="Appointment notes" rows={2} />
            <Textarea aria-label="Estimate notes" value={estimateNotes} onChange={(event) => setEstimateNotes(event.target.value)} placeholder="Estimate notes" rows={2} />
            <p className="text-[11px] text-slate-400">Date and time are interpreted in America/Chicago.</p>
            <Button className="w-full" variant="outline" onClick={schedule} disabled={action.isPending}>{appointment ? "Reschedule" : "Schedule estimate"}</Button>
          </div>}
        </div>
        <div className="rounded-xl border p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold"><CheckCircle2 className="h-4 w-4 text-primary" /> Finalization</h3>
          <p className="mt-2 text-sm text-slate-500">{data?.revision ? `Revision ${data.revision.revisionNumber} finalized` : "Create a durable snapshot before delivery."}</p>
          <Button className="mt-3 w-full" variant="outline" disabled={locked || action.isPending || !(quote.lineItems?.length)} onClick={finalize}>{data?.revision ? "Finalize new revision" : "Finalize estimate"}</Button>
        </div>
        <div className="rounded-xl border p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold"><Mail className="h-4 w-4 text-primary" /> Customer delivery</h3>
          <Select value={deliveryMethod} onValueChange={setDeliveryMethod}><SelectTrigger className="mt-3"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="sms">SMS</SelectItem><SelectItem value="both">Email + SMS</SelectItem></SelectContent></Select>
          {(deliveryMethod === "email" || deliveryMethod === "both") && <Input className="mt-2" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email recipient" />}
          {(deliveryMethod === "sms" || deliveryMethod === "both") && <Input className="mt-2" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="SMS recipient" />}
          <Button className="mt-3 w-full" disabled={!data?.revision || action.isPending} onClick={deliver}><MessageSquare className="mr-2 h-4 w-4" /> Queue delivery</Button>
        </div>
      </div>
      {secureUrl && <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3"><Input readOnly value={secureUrl} /><Button size="icon" variant="outline" aria-label="Copy secure link" onClick={() => { navigator.clipboard.writeText(secureUrl); toast({ title: "Secure link copied" }); }}><Copy className="h-4 w-4" /></Button></div>}
      {(data?.deliveries?.length > 0 || data?.activities?.length > 0) && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div><h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400"><Mail className="h-3.5 w-3.5" /> Delivery state</h3><div className="mt-2 space-y-2">{data.deliveries.map((item: any) => <div key={item.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span>{item.channel.toUpperCase()} · {item.recipient}</span><strong className="capitalize">{item.status.replace("_", " ")}</strong></div>)}</div></div>
        <div><h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400"><History className="h-3.5 w-3.5" /> Activity</h3><div className="mt-2 space-y-2 max-h-44 overflow-auto">{data.activities.map((item: any) => <div key={item.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs"><strong>{item.activityType.replaceAll("_", " ")}</strong><span className="ml-2 text-slate-400">{new Date(item.occurredAt).toLocaleString()}</span></div>)}</div></div>
      </div>}
    </section>
      <Dialog open={correcting} onOpenChange={(open) => !open && setCorrecting(false)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle className="text-base">Correct the status</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">The correction is recorded in the activity history. An estimate becomes accepted only through the customer's own decision.</p>
          <label className="block text-xs font-semibold text-slate-600">Status
            <select aria-label="Corrected status" value={correction} onChange={(e) => setCorrection(e.target.value)} className="input-lite mt-1 w-full">
              {CORRECTABLE_ESTIMATE_STATUSES.map((value) => <option key={value} value={value}>{ESTIMATE_STATUS_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-600">Reason <span className="font-normal text-slate-400">(optional)</span>
            <input aria-label="Correction reason" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} className="input-lite mt-1 w-full" placeholder="e.g. customer declined by phone" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCorrecting(false)} className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600">Cancel</button>
            <button type="button" onClick={() => correctStatus.mutate()} disabled={correctStatus.isPending} className="h-9 rounded-xl bg-primary px-3 text-sm font-semibold text-white disabled:opacity-50">{correctStatus.isPending ? "Saving…" : "Save correction"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItemEdit {
  key: string;
  id?: number;
  serviceId?: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  draft:    { label: "Draft",    bg: "bg-slate-100",  text: "text-slate-700",    dot: "bg-slate-400" },
  sent:     { label: "Sent",     bg: "bg-blue-50",    text: "text-blue-700",     dot: "bg-blue-400" },
  approved: { label: "Approved", bg: "bg-emerald-50", text: "text-emerald-700",  dot: "bg-emerald-400" },
  rejected: { label: "Rejected", bg: "bg-red-50",     text: "text-red-600",      dot: "bg-red-400" },
  declined: { label: "Declined", bg: "bg-red-50",     text: "text-red-600",      dot: "bg-red-400" },
  expired:  { label: "Expired",  bg: "bg-amber-50",   text: "text-amber-700",    dot: "bg-amber-400" },
};

// ─── LineItemEditCard ─────────────────────────────────────────────────────────

function LineItemEditCard({
  item,
  index,
  onUpdate,
  onRemove,
}: {
  item: LineItemEdit;
  index: number;
  onUpdate: (key: string, field: keyof LineItemEdit, value: string) => void;
  onRemove: (key: string) => void;
}) {
  const qty   = parseFloat(item.quantity)  || 0;
  const price = parseFloat(item.unitPrice) || 0;
  const total = qty * price;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Item {index + 1}</span>
        <button
          onClick={() => onRemove(item.key)}
          aria-label={`Remove quote item ${index + 1}`}
          className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-500">Description</label>
        <input
          value={item.description}
          onChange={(e) => onUpdate(item.key, "description", e.target.value)}
          placeholder="Service or item description…"
          className="w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white text-slate-900
                     placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        />
      </div>
      <div className="grid grid-cols-3 gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">Qty</label>
          <input
            type="number"
            value={item.quantity}
            onChange={(e) => onUpdate(item.key, "quantity", e.target.value)}
            min="0.01"
            step="0.01"
            className="w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white
                       focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">Unit Price</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
            <input
              type="number"
              value={item.unitPrice}
              onChange={(e) => onUpdate(item.key, "unitPrice", e.target.value)}
              min="0"
              step="0.01"
              className="w-full h-10 pl-6 pr-3 text-sm rounded-xl border border-slate-200 bg-white
                         focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">Total</label>
          <div className="h-10 flex items-center px-3 rounded-xl bg-white border border-slate-100">
            <span className="text-sm font-bold text-slate-900">{total > 0 ? formatCurrency(total) : "—"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const quoteId  = parseInt(id, 10);
  const [, navigate] = useLocation();
  const { goBack, backLabel } = useBackNavigation("/quotes");
  const queryClient  = useQueryClient();
  const { toast }    = useToast();

  const [confirmDelete,   setConfirmDelete]   = useState(false);
  const [editing,         setEditing]         = useState(false);
  const [editNotes,       setEditNotes]        = useState("");
  const [editTerms,       setEditTerms]        = useState("");
  const [editStatus,      setEditStatus]       = useState("");
  const [editValidUntil,  setEditValidUntil]   = useState("");
  const [editPropertyId,  setEditPropertyId]   = useState<number | "">("");
  const [editLineItems,   setEditLineItems]    = useState<LineItemEdit[]>([]);

  const { data: quote, isLoading, isError } = useGetQuote(quoteId);

  const updateMutation = useUpdateQuote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetQuoteQueryKey(quoteId) });
        queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey() });
        toast({ title: "Quote updated!" });
        setEditing(false);
      },
      onError: () => toast({ title: "Failed to update quote", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteQuote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey() });
        toast({ title: "Quote deleted" });
        navigate("/quotes");
      },
      onError: () => toast({ title: "Failed to delete quote", variant: "destructive" }),
    },
  });

  const convertMutation = useMutation({
    mutationFn: ({ id, key }: { id: number; key: string }) =>
      convertQuote(id, idempotencyRequest(key)),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: getGetQuoteQueryKey(quoteId) });
      queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey() });
      toast({ title: `Job ${(job as { jobNumber?: string }).jobNumber} created!` });
      setTimeout(() => navigate(`/jobs/${(job as { id: number }).id}`), 600);
    },
    onError: () => toast({ title: "Failed to convert", variant: "destructive" }),
  });

  const startEdit = () => {
    if (!quote) return;
    setEditNotes(quote.notes ?? "");
    setEditTerms(quote.terms ?? "");
    setEditStatus(quote.status);
    setEditValidUntil(quote.validUntil ?? "");
    setEditPropertyId(quote.propertyId ?? "");
    setEditLineItems(
      (quote.lineItems ?? []).map((li) => ({
        key: String(li.id),
        id: li.id,
        serviceId: li.serviceId,
        description: li.description,
        quantity: String(li.quantity),
        unitPrice: String(li.unitPrice),
      }))
    );
    setEditing(true);
  };

  const updateItem = (key: string, field: keyof LineItemEdit, value: string) =>
    setEditLineItems((prev) => prev.map((li) => (li.key === key ? { ...li, [field]: value } : li)));
  const removeItem = (key: string) =>
    setEditLineItems((prev) => prev.filter((li) => li.key !== key));
  const addItem = () =>
    setEditLineItems((prev) => [...prev, { key: crypto.randomUUID(), description: "", quantity: "1", unitPrice: "" }]);

  const saveEdit = () => {
    const validItems = editLineItems.filter((li) => li.description.trim());
    updateMutation.mutate({
      id: quoteId,
      data: {
        status: editStatus,
        propertyId: editPropertyId ? Number(editPropertyId) : null,
        notes: editNotes || undefined,
        terms: editTerms || undefined,
        validUntil: editValidUntil || undefined,
        lineItems: validItems.map((li) => ({
          serviceId: li.serviceId ?? undefined,
          description: li.description,
          quantity: parseFloat(li.quantity) || 1,
          unitPrice: parseFloat(li.unitPrice) || 0,
        })),
      },
    });
  };

  const changeStatus = (s: string) =>
    updateMutation.mutate({ id: quoteId, data: { status: s } });

  // ─ Loading / error states ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <Layout>
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-24 bg-slate-200 rounded mb-6" />
          <div className="h-28 bg-white rounded-2xl border border-slate-100" />
          <div className="h-12 bg-white rounded-2xl border border-slate-100" />
          <div className="h-48 bg-white rounded-2xl border border-slate-100" />
        </div>
      </Layout>
    );
  }

  if (isError || !quote) {
    return (
      <Layout>
        <button onClick={goBack} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> {backLabel ?? "Quotes"}
        </button>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FileText className="w-12 h-12 text-slate-200 mb-4" />
          <h2 className="text-lg font-bold text-slate-700 mb-1">Quote not found</h2>
          <p className="text-slate-400 text-sm mb-5">This quote may have been deleted.</p>
          <button onClick={goBack} className="px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors">
            {backLabel ?? "Quotes"}
          </button>
        </div>
      </Layout>
    );
  }

  // ─ Derived data ───────────────────────────────────────────────────────────

  const statusCfg = STATUS_CFG[quote.status] ?? STATUS_CFG.draft;
  const quoteRaw = quote as { customer?: { displayName?: string; email?: string | null; phone?: string | null } | null; lead?: { displayName?: string; email?: string | null; phone?: string | null } | null; property?: { name?: string | null; address?: string; city?: string; state?: string; zip?: string } | null };
  const quoteCustomer = quoteRaw.customer ?? quoteRaw.lead;
  const quoteProperty = quoteRaw.property;

  const displayLineItems = editing ? editLineItems : (quote.lineItems ?? []);
  const editSubtotal = editLineItems.reduce((s, li) => s + (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0), 0);
  const subtotal = editing ? editSubtotal : Number(quote.subtotal);
  const totalAmount = editing ? editSubtotal : Number(quote.totalAmount ?? quote.subtotal);

  const isDraft    = quote.status === "draft";
  const isSent     = quote.status === "sent";
  const isApproved = quote.status === "approved";
  const acceptedLocked = quote.status === "accepted" || quote.status === "approved";
  // Conversion and quote-linked job creation are intentionally deferred to the
  // accepted-estimate scheduling task.
  const canConvert = false;

  return (
    <Layout>
      {/* ── Back nav ─────────────────────────────────── */}
      <div className="mb-4">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {backLabel ?? "Quotes"}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════
           HERO CARD
      ══════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-l-4 border-slate-200 border-l-primary/40 p-5 mb-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <span className="font-mono text-xs text-slate-400">{quote.quoteNumber}</span>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">
              {quoteCustomer?.displayName ?? `Customer #${quote.customerId}`}
            </h1>
            {quoteProperty && (
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 text-slate-400" />
                <p className="text-sm text-slate-500">
                  {quoteProperty.name ? `${quoteProperty.name} — ` : ""}
                  {[quoteProperty.address, quoteProperty.city, quoteProperty.state, quoteProperty.zip].filter(Boolean).join(", ")}
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold ${statusCfg.bg} ${statusCfg.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
              {statusCfg.label}
            </span>
            <span className="text-2xl font-bold text-slate-900 tabular-nums">{formatCurrency(totalAmount)}</span>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Created {format(new Date(quote.createdAt), "MMMM d, yyyy")}
          {quote.validUntil ? ` · Valid until ${quote.validUntil}` : ""}
        </p>
      </div>

      <EstimateLifecyclePanel quote={quote} />

      {/* ══════════════════════════════════════════════════
           PRIMARY ACTIONS (desktop — full row)
      ══════════════════════════════════════════════════ */}
      {!editing && (
        <div className="hidden sm:flex gap-2.5 mb-4 flex-wrap">
          {canConvert && !acceptedLocked && (
            <button
              onClick={() => convertMutation.mutate({ id: quoteId, key: createIdempotencyKey() })}
              disabled={convertMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl
                         bg-emerald-500 hover:bg-emerald-600 active:scale-[.98]
                         text-white text-sm font-bold shadow-sm shadow-emerald-200
                         transition-all disabled:opacity-60"
            >
              <ArrowRightCircle className="w-4 h-4" />
              {convertMutation.isPending ? "Converting…" : "Approve & Convert to Job"}
            </button>
          )}
           {isDraft && !acceptedLocked && (
            <button
              onClick={() => changeStatus("sent")}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 h-11 px-5 rounded-xl
                         border-2 border-blue-200 text-blue-700 bg-white hover:bg-blue-50 active:scale-[.98]
                         text-sm font-bold transition-all disabled:opacity-60"
            >
              <Send className="w-4 h-4" />
              Mark Sent
            </button>
          )}
          {canConvert && (
            <button
              onClick={() => changeStatus("rejected")}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 h-11 px-5 rounded-xl
                         border-2 border-red-200 text-red-600 bg-white hover:bg-red-50 active:scale-[.98]
                         text-sm font-bold transition-all disabled:opacity-60"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
          )}
          <button
            onClick={() => window.open(`/quotes/${quoteId}/print`, "_blank")}
            className="flex items-center gap-2 h-11 px-4 rounded-xl
                       border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 active:scale-[.98]
                       text-sm font-semibold transition-all"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
          {!acceptedLocked && <button
            onClick={startEdit}
            className="flex items-center gap-2 h-11 px-4 rounded-xl
                       border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 active:scale-[.98]
                       text-sm font-semibold transition-all"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>}
          {!acceptedLocked && <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMutation.isPending}
            title="Delete quote"
            aria-label="Delete quote"
            className="flex items-center justify-center h-11 w-11 rounded-xl
                       border border-red-200 text-red-500 bg-white hover:bg-red-50 active:scale-[.98]
                       transition-all disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" />
          </button>}
        </div>
      )}

      {/* Edit mode save/cancel bar */}
      {editing && (
        <div className="hidden sm:flex gap-2.5 mb-4">
          <button
            onClick={saveEdit}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 h-11 px-6 rounded-xl bg-primary text-white
                       text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 active:scale-[.98]
                       transition-all disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {updateMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="flex items-center gap-2 h-11 px-4 rounded-xl border border-slate-200 text-slate-600
                       text-sm font-semibold hover:bg-slate-50 active:scale-[.98] transition-all"
          >
            <X className="w-4 h-4" /> Cancel
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
           MAIN CONTENT
      ══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

        {/* ─── LEFT: Line Items + Notes ──────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Line Items */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                Line Items
                {displayLineItems.length > 0 && (
                  <span className="ml-2 text-xs font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full normal-case tracking-normal">
                    {displayLineItems.length}
                  </span>
                )}
              </h2>
              {editing && (
                <button
                  onClick={addItem}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-xl border border-slate-200
                             text-slate-600 text-xs font-semibold hover:bg-slate-50 active:scale-[.97] transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Item
                </button>
              )}
            </div>

            {/* Editing: card view */}
            {editing ? (
              <div className="space-y-3">
                {editLineItems.length === 0 ? (
                  <div className="py-10 text-center border-2 border-dashed border-slate-200 rounded-xl">
                    <FileText className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm font-medium">No items. Add one above.</p>
                  </div>
                ) : (
                  editLineItems.map((li, i) => (
                    <LineItemEditCard
                      key={li.key}
                      item={li}
                      index={i}
                      onUpdate={updateItem}
                      onRemove={removeItem}
                    />
                  ))
                )}
              </div>
            ) : (
              /* Read view: clean table */
              <div>
                {displayLineItems.length === 0 ? (
                  <div className="py-10 text-center border-2 border-dashed border-slate-200 rounded-xl">
                    <FileText className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm font-medium">No line items on this quote.</p>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {/* Column headers */}
                    <div className="grid grid-cols-12 gap-2 px-2 pb-2 border-b border-slate-100">
                      <div className="col-span-6 text-xs font-bold uppercase tracking-wide text-slate-400">Description</div>
                      <div className="col-span-2 text-xs font-bold uppercase tracking-wide text-slate-400 text-center">Qty</div>
                      <div className="col-span-2 text-xs font-bold uppercase tracking-wide text-slate-400 text-right">Unit Price</div>
                      <div className="col-span-2 text-xs font-bold uppercase tracking-wide text-slate-400 text-right">Total</div>
                    </div>
                    {(quote.lineItems ?? []).map((li) => (
                      <div key={li.id} className="grid grid-cols-12 gap-2 px-2 py-3 border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                        <div className="col-span-6">
                          <p className="text-sm font-semibold text-slate-900">{li.description}</p>
                        </div>
                        <div className="col-span-2 text-sm text-slate-600 text-center self-center">{li.quantity}</div>
                        <div className="col-span-2 text-sm text-slate-600 text-right self-center">{formatCurrency(Number(li.unitPrice))}</div>
                        <div className="col-span-2 text-sm font-bold text-slate-900 text-right self-center">{formatCurrency(Number(li.totalPrice))}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Inline totals below items */}
            {displayLineItems.length > 0 && (
              <div className="mt-5 pt-4 border-t border-slate-100 flex justify-end">
                <div className="space-y-1.5 min-w-[200px]">
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Subtotal</span>
                    <span className="font-semibold text-slate-800">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-end pt-1 border-t border-slate-100">
                    <span className="text-base font-bold text-slate-900">Total</span>
                    <span className="text-xl font-bold text-primary">{formatCurrency(totalAmount)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notes & Terms */}
          {editing ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Notes & Terms</h2>

              {/* Edit settings inline */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</Label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger className="rounded-xl h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="declined">Declined</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Valid Until</Label>
                  <Input type="date" value={editValidUntil} onChange={(e) => setEditValidUntil(e.target.value)} className="rounded-xl h-10" />
                </div>
              </div>
              <PropertyPicker
                customerId={quote.customerId}
                value={editPropertyId}
                onChange={setEditPropertyId}
                allowNone
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</Label>
                  <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes…" className="rounded-xl resize-none text-sm" rows={3} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Terms</Label>
                  <Textarea value={editTerms} onChange={(e) => setEditTerms(e.target.value)} placeholder="Terms & conditions…" className="rounded-xl resize-none text-sm" rows={3} />
                </div>
              </div>

              {/* Mobile save in edit section */}
              <div className="sm:hidden flex gap-2">
                <button onClick={saveEdit} disabled={updateMutation.isPending}
                  className="flex-1 h-11 rounded-xl bg-primary text-white text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-60">
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </button>
                <button onClick={() => setEditing(false)}
                  className="h-11 px-4 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all">
                  Cancel
                </button>
              </div>
            </div>
          ) : (quote.notes || quote.terms) ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">Notes & Terms</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {quote.notes && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Notes</p>
                    <p className="text-slate-700 text-sm whitespace-pre-line leading-relaxed">{quote.notes}</p>
                  </div>
                )}
                {quote.terms && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Terms</p>
                    <p className="text-slate-700 text-sm whitespace-pre-line leading-relaxed">{quote.terms}</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Mobile: primary actions at bottom */}
          {!editing && (
            <div className="sm:hidden space-y-2">
              {canConvert && (
                <button
                  onClick={() => convertMutation.mutate({ id: quoteId, key: createIdempotencyKey() })}
                  disabled={convertMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 h-12 rounded-xl
                             bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold
                             shadow-sm shadow-emerald-200 transition-all disabled:opacity-60"
                >
                  <ArrowRightCircle className="w-5 h-5" />
                  {convertMutation.isPending ? "Converting…" : "Approve & Convert to Job"}
                </button>
              )}
              <div className="flex gap-2">
                {isDraft && (
                  <button onClick={() => changeStatus("sent")} disabled={updateMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border-2 border-blue-200 text-blue-700 text-sm font-bold hover:bg-blue-50 transition-all disabled:opacity-60">
                    <Send className="w-4 h-4" /> Mark Sent
                  </button>
                )}
                {!acceptedLocked && <button onClick={startEdit}
                  className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all">
                  <Pencil className="w-4 h-4" /> Edit
                </button>}
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT: Sticky sidebar ─────────────────── */}
        <div className="hidden lg:block space-y-4">

          {/* Sticky totals */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 sticky top-20">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-4">Summary</h3>
            <div className="space-y-2 pb-3 border-b border-slate-100">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Items</span>
                <span className="font-medium text-slate-700">{displayLineItems.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-semibold text-slate-800">{formatCurrency(subtotal)}</span>
              </div>
            </div>
            <div className="flex justify-between items-end mt-3 mb-4">
              <span className="text-base font-bold text-slate-800">Total</span>
              <span className="text-3xl font-bold text-primary tabular-nums">{formatCurrency(totalAmount)}</span>
            </div>

            {/* Sidebar quick actions */}
            {!editing && (
              <div className="space-y-2">
                {canConvert && (
                  <button
                    onClick={() => convertMutation.mutate({ id: quoteId, key: createIdempotencyKey() })}
                    disabled={convertMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 h-11 rounded-xl
                               bg-emerald-500 hover:bg-emerald-600 active:scale-[.98]
                               text-white text-sm font-bold shadow-sm shadow-emerald-200 transition-all disabled:opacity-60"
                  >
                    <ArrowRightCircle className="w-4 h-4" />
                    {convertMutation.isPending ? "Converting…" : "Convert to Job"}
                  </button>
                )}
                {isDraft && (
                  <button
                    onClick={() => changeStatus("sent")}
                    disabled={updateMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 h-10 rounded-xl
                               border-2 border-blue-200 text-blue-700 hover:bg-blue-50 active:scale-[.98]
                               text-sm font-bold transition-all disabled:opacity-60"
                  >
                    <Send className="w-4 h-4" /> Mark Sent
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Customer */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Customer</h3>
            </div>
            {quoteCustomer ? (
              <div className="space-y-1">
                <p className="font-semibold text-slate-900 text-sm">{quoteCustomer.displayName}</p>
                {quoteCustomer.email && <p className="text-xs text-slate-500">{quoteCustomer.email}</p>}
                {quoteCustomer.phone && <p className="text-xs text-slate-500">{quoteCustomer.phone}</p>}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Customer #{quote.customerId}</p>
            )}
          </div>

          {/* Property */}
          {quoteProperty && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Property</h3>
              </div>
              <div className="space-y-0.5">
                {quoteProperty.name && <p className="font-semibold text-slate-900 text-sm">{quoteProperty.name}</p>}
                <p className="text-xs text-slate-600">{quoteProperty.address}</p>
                <p className="text-xs text-slate-400">
                  {[quoteProperty.city, quoteProperty.state, quoteProperty.zip].filter(Boolean).join(", ")}
                </p>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Timeline</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Created</span>
                <span className="text-slate-700 font-medium">{format(new Date(quote.createdAt), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Updated</span>
                <span className="text-slate-700 font-medium">{format(new Date(quote.updatedAt), "MMM d, yyyy")}</span>
              </div>
              {quote.validUntil && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Valid Until</span>
                  <span className="text-slate-700 font-medium">{quote.validUntil}</span>
                </div>
              )}
            </div>
          </div>

          {/* Danger zone */}
          <div className="pt-1">
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-2 text-sm text-red-500 hover:text-red-700 font-medium transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete Quote
            </button>
          </div>
        </div>
      </div>

      {/* ── Confirm Delete Dialog ─────────────────────────────────────── */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-4 h-4" /> Delete Quote
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-1">
            Permanently delete <span className="font-semibold">{quote?.quoteNumber}</span>?
            This cannot be undone.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Keep Quote
            </button>
            <button
              onClick={() => { setConfirmDelete(false); deleteMutation.mutate({ id: quoteId }); }}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Permanently"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
