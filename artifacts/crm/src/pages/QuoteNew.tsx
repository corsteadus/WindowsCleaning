import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/Layout";
import {
  ArrowLeft, Plus, Trash2, Sparkles, PenLine, FileText,
} from "lucide-react";
import {
  useListServices,
  useGetCustomer,
  getGetCustomerQueryKey,
  useCreateQuote,
  useCreateQuoteWithAppointment,
  getListQuotesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { PropertyPicker } from "@/components/PropertyPicker";
import { CustomerCombobox } from "@/components/CustomerCombobox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";
import { useLocation } from "wouter";
import { filterSelectableCrewTechnicians } from "@/lib/crew-technician-options";
import {
  captureAndRetainSubmittedQuoteAppointment,
  prepareQuoteAppointment,
  submitAndConfirmQuoteAppointment,
  type QuoteAppointmentRequest as AppointmentRequest,
} from "@/lib/quote-appointment-submission";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ─── Customer types ─────────────────────────────────────────────────────────

interface CustomerOption {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  clientType?: string | null;
  status?: string | null;
  defaultPropertyId?: number | null;
  effectiveDefaultPropertyId?: number | null;
}

function customerDisplayName(c: CustomerOption): string {
  const fullName = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  if (fullName && c.companyName) return `${fullName} — ${c.companyName}`;
  if (fullName) return fullName;
  if (c.companyName) return c.companyName;
  return `Customer #${c.id}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItemDraft {
  key: string;
  serviceId?: number;
  description: string;
  quantity: string;
  unitPrice: string;
}

function newLineItem(): LineItemDraft {
  return { key: crypto.randomUUID(), description: "", quantity: "1", unitPrice: "" };
}

// ─── LineItemCard ─────────────────────────────────────────────────────────────

function LineItemCard({
  item,
  index,
  onUpdate,
  onRemove,
  canRemove,
}: {
  item: LineItemDraft;
  index: number;
  onUpdate: (key: string, field: keyof LineItemDraft, value: string) => void;
  onRemove: (key: string) => void;
  canRemove: boolean;
}) {
  const qty   = parseFloat(item.quantity)  || 0;
  const price = parseFloat(item.unitPrice) || 0;
  const total = qty * price;
  const descRef = useRef<HTMLInputElement>(null);

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      {/* Header row: item # + remove */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Item {index + 1}</span>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(item.key)}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Remove item"
            aria-label={`Remove quote item ${index + 1}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-500">Description</label>
        <input
          ref={index === 0 ? undefined : descRef}
          value={item.description}
          onChange={(e) => onUpdate(item.key, "description", e.target.value)}
          placeholder={item.serviceId ? item.description : "What are you quoting?"}
          className="w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white text-slate-900
                     placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        />
        {item.serviceId && (
          <p className="text-[10px] text-primary font-medium ml-0.5">From service catalog</p>
        )}
      </div>

      {/* Qty + Price + Total */}
      <div className="grid grid-cols-3 gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">Qty</label>
          <input
            type="number"
            value={item.quantity}
            onChange={(e) => onUpdate(item.key, "quantity", e.target.value)}
            min="0.01"
            step="0.01"
            placeholder="1"
            className="w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white text-slate-900
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
              placeholder="0.00"
              className="w-full h-10 pl-6 pr-3 text-sm rounded-xl border border-slate-200 bg-white text-slate-900
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

// ─── ServicePickerDialog ──────────────────────────────────────────────────────

function ServicePickerDialog({
  services,
  onAdd,
  onClose,
  navigate,
}: {
  services: Array<{ id: number; name: string; description?: string | null; basePrice: number | string; category?: string | null; unit?: string | null; isActive: boolean }>;
  onAdd: (s: { id: number; name: string; basePrice: number | string }) => void;
  onClose: () => void;
  navigate: (to: string) => void;
}) {
  const active = services.filter((s) => s.isActive);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-primary" />
            Add from Service Catalog
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-1.5 -mx-2 px-2">
          {active.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              <FileText className="w-10 h-10 mx-auto mb-2 text-slate-200" />
              No active services yet.{" "}
              <button type="button" className="text-primary font-medium hover:underline" onClick={() => { onClose(); navigate("/services"); }}>
                Set up your catalog
              </button>
            </div>
          ) : (
            active.map((service) => (
              <button
                type="button"
                key={service.id}
                onClick={() => onAdd(service)}
                className="w-full text-left flex items-center justify-between p-3.5 rounded-xl border border-slate-100
                           hover:bg-primary/5 hover:border-primary/20 active:scale-[.99] transition-all group"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 text-sm truncate group-hover:text-primary transition-colors">
                    {service.name}
                  </p>
                  {service.description && (
                    <p className="text-xs text-slate-500 truncate mt-0.5">{service.description}</p>
                  )}
                  {service.category && (
                    <Badge variant="outline" className="mt-1 text-[10px] capitalize bg-blue-50 border-blue-100 text-blue-700 px-1.5 py-0">
                      {service.category.replace("_", " ")}
                    </Badge>
                  )}
                </div>
                <div className="ml-4 shrink-0 text-right">
                  <p className="font-bold text-slate-900 text-sm">{formatCurrency(Number(service.basePrice))}</p>
                  {service.unit && <p className="text-[10px] text-slate-400">per {service.unit}</p>}
                </div>
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full h-10 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function QuoteNew() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const queryClient  = useQueryClient();
  const { toast }    = useToast();

  // ?customerId=<id> — preselect a customer (e.g. arriving from CustomerDetail)
  const urlCustomerIdRef = useRef<number | null>(null);
  if (urlCustomerIdRef.current === null) {
    const raw = new URLSearchParams(window.location.search).get("customerId");
    const parsed = raw ? parseInt(raw, 10) : NaN;
    urlCustomerIdRef.current = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }
  const urlCustomerId = urlCustomerIdRef.current;

  // Form state
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const customerId = selectedCustomer ? String(selectedCustomer.id) : "";

  const { data: urlCustomer } = useGetCustomer(urlCustomerId, {
    query: {
      enabled: urlCustomerId > 0,
      queryKey: authScopedQueryKey(user, getGetCustomerQueryKey(urlCustomerId)),
    },
  });
  useEffect(() => {
    if (urlCustomer && !selectedCustomer) {
      setSelectedCustomer(urlCustomer as CustomerOption);
    }
    // Only initialize once from the URL; user selection afterwards wins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCustomer]);
  const { data: selectedCustomerDetails } = useGetCustomer(Number(customerId) || 0, {
    query: {
      enabled: !!customerId,
      queryKey: authScopedQueryKey(user, getGetCustomerQueryKey(Number(customerId) || 0)),
    },
  });
  const [propertyId, setPropertyId] = useState("");
  const [status,     setStatus]     = useState("draft");
  const [notes,      setNotes]      = useState("");
  const [terms,      setTerms]      = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [lineItems,  setLineItems]  = useState<LineItemDraft[]>([newLineItem()]);
  const [showPicker, setShowPicker] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [appointmentDuration, setAppointmentDuration] = useState("60");
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [estimateNotes, setEstimateNotes] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("unassigned");
  const [appointmentPropertyIds, setAppointmentPropertyIds] = useState<number[]>([]);
  const pendingAppointmentRef = useRef<AppointmentRequest | null>(null);
  const appointmentDurationTouchedControlRef = useRef<HTMLInputElement>(null);
  const appointmentFallbackPropertyControlRef = useRef<HTMLInputElement>(null);
  const scheduledCreateIdempotencyKeyRef = useRef(createIdempotencyKey());
  const submissionStartedRef = useRef(false);

  // API
  const { data: services } = useListServices();
  const { data: estimateEmployees = [], isLoading: estimateEmployeesLoading } = useQuery({
    queryKey: ["estimate-employees"],
    queryFn: async () => {
      const response = await protectedFetch(`${BASE}/api/estimate-employees`);
      if (!response.ok) throw new Error("Unable to load employees");
      return response.json() as Promise<Array<{ id: string; displayName: string; role?: string | null; isActive?: boolean }>>;
    },
  });
  // Fail closed: appointment assignees are only active canonical technicians.
  // A legacy/incomplete employee response must never widen this selector.
  const selectableEstimateEmployees = filterSelectableCrewTechnicians(estimateEmployees);
  const availableAppointmentProperties = (
    Array.isArray((selectedCustomerDetails as any)?.properties)
      ? (selectedCustomerDetails as any).properties
      : []
  ).filter((property: any) => Number.isInteger(property.id) && property.id > 0 && !property.archivedAt);

  const createMutation = useCreateQuote({
    mutation: {
      onSuccess: (quote) => {
        queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey() });
        toast({ title: `Quote ${(quote as { quoteNumber?: string }).quoteNumber} created!` });
        navigate(`/quotes/${quote.id}`);
      },
      onError: () => toast({ title: "Failed to create quote", variant: "destructive" }),
      onSettled: () => {
        submissionStartedRef.current = false;
      },
    },
  });
  const createScheduledMutation = useCreateQuoteWithAppointment({
    request: idempotencyRequest(scheduledCreateIdempotencyKeyRef.current),
    mutation: {
      onSuccess: async (result) => {
        const request = pendingAppointmentRef.current;
        let confirmed = false;
        if (request) {
          try {
            confirmed = await submitAndConfirmQuoteAppointment({
              request,
              submit: async () => result.appointment,
              readback: async () => {
                const response = await protectedFetch(`${BASE}/api/quotes/${result.quote.id}/estimate-lifecycle`);
                if (!response.ok) throw new Error("Appointment readback failed");
                const lifecycle = await response.json();
                return lifecycle.appointment;
              },
            });
          } catch {
            confirmed = false;
          }
        }
        queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey() });
        if (!confirmed) {
          toast({
            title: "Scheduled quote saved; verification needs attention",
            description: "The atomic save completed, but independent appointment readback did not match. Opening the committed quote without issuing another create.",
            variant: "destructive",
          });
          navigate(`/quotes/${result.quote.id}`);
          return;
        }
        toast({ title: "Estimate scheduled!" });
        navigate(`/quotes/${result.quote.id}`);
      },
      onError: () => toast({
        title: "Quote and appointment were not created",
        description: "Complete the appointment and try again. No partial scheduled quote was saved.",
        variant: "destructive",
      }),
      onSettled: () => {
        submissionStartedRef.current = false;
      },
    },
  });

  useEffect(() => {
    setPropertyId("");
    setAppointmentPropertyIds([]);
    if (appointmentFallbackPropertyControlRef.current) {
      appointmentFallbackPropertyControlRef.current.value = "";
    }
  }, [customerId]);

  // Line item helpers
  const updateItem = (key: string, field: keyof LineItemDraft, value: string) => {
    setLineItems((prev) => prev.map((li) => (li.key === key ? { ...li, [field]: value } : li)));
  };
  const removeItem = (key: string) => {
    setLineItems((prev) => prev.filter((li) => li.key !== key));
  };
  const addServiceItem = (service: { id: number; name: string; basePrice: number | string }) => {
    const li: LineItemDraft = {
      key: crypto.randomUUID(),
      serviceId: service.id,
      description: service.name,
      quantity: "1",
      unitPrice: String(service.basePrice),
    };
    setLineItems((prev) => [...prev.filter((l) => l.description !== ""), li]);
    setShowPicker(false);
  };
  const addCustomItem = () => {
    setLineItems((prev) => [...prev, newLineItem()]);
  };

  // Live totals
  const subtotal = lineItems.reduce((sum, li) => {
    return sum + (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0);
  }, 0);
  const itemCount = lineItems.filter((li) => li.description.trim()).length;

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionStartedRef.current) return;
    if (!customerId) {
      toast({ title: "Please select a customer", variant: "destructive" });
      return;
    }
    const validItems = lineItems.filter((li) => li.description.trim());
    if (!validItems.length) {
      toast({ title: "Add at least one line item", variant: "destructive" });
      return;
    }
    pendingAppointmentRef.current = null;
    const appointment = prepareQuoteAppointment(captureAndRetainSubmittedQuoteAppointment(
      new FormData(event.currentTarget),
      {
      date: appointmentDate,
      time: appointmentTime,
      duration: appointmentDuration,
      durationTouched: false,
      assignedUserId,
      propertyIds: appointmentPropertyIds,
      fallbackPropertyId: propertyId ? Number(propertyId) : null,
      availablePropertyIds: availableAppointmentProperties.map((property: any) => property.id),
      selectableTechnicianIds: selectableEstimateEmployees.map((employee) => employee.id),
      appointmentNotes,
      estimateNotes,
      },
      (submitted) => {
        setAppointmentDate(submitted.date);
        setAppointmentTime(submitted.time);
        setAppointmentDuration(submitted.duration);
        setAssignedUserId(submitted.assignedUserId);
        setAppointmentPropertyIds(submitted.propertyIds);
        setAppointmentNotes(submitted.appointmentNotes);
        setEstimateNotes(submitted.estimateNotes);
      },
    ));
    if (appointment.kind === "invalid") {
      toast({
        title: "Complete the estimate appointment",
        description: appointment.message,
        variant: "destructive",
      });
      return;
    }
    if (appointment.kind === "ready") {
      pendingAppointmentRef.current = appointment.request;
    }
    const quote = {
      customerId: Number(customerId),
      propertyId: propertyId ? Number(propertyId) : undefined,
      status,
      notes: notes || undefined,
      terms: terms || undefined,
      validUntil: validUntil || undefined,
      lineItems: validItems.map((li) => ({
        serviceId: li.serviceId ?? undefined,
        description: li.description,
        quantity: parseFloat(li.quantity) || 1,
        unitPrice: parseFloat(li.unitPrice) || 0,
      })),
    };
    submissionStartedRef.current = true;
    if (appointment.kind === "ready") {
      createScheduledMutation.mutate({ data: { quote, appointment: appointment.request } });
      return;
    }
    createMutation.mutate({ data: quote });
  };

  return (
    <Layout>
      {/* ── Back nav ───────────────────────────────────── */}
      <button
        type="button"
        onClick={() => navigate("/quotes")}
        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Quotes
      </button>

      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">New Quote</h1>
        <p className="text-xs text-slate-400 mt-0.5">Build a proposal for your client</p>
      </div>

      {/* ══════════════════════════════════════════════════
           MAIN 2-COLUMN GRID
      ══════════════════════════════════════════════════ */}
      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

        {/* ─── LEFT: Customer + Settings ─────────────── */}
        <div className="lg:col-span-1 space-y-4">

          {/* Customer & Property */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Client</h2>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Customer <span className="text-red-500">*</span>
                </Label>
                <CustomerCombobox
                  selectedCustomer={selectedCustomer}
                  onSelect={setSelectedCustomer}
                  labelFor={customerDisplayName}
                  placeholder="Select customer…"
                  showClientTypeIcon
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Property</Label>
                    <PropertyPicker
                      customerId={customerId ? Number(customerId) : null}
                      value={propertyId ? Number(propertyId) : ""}
                      onChange={(value) => {
                        const nextPropertyId = value ? String(value) : "";
                        setPropertyId(nextPropertyId);
                        if (appointmentFallbackPropertyControlRef.current) {
                          appointmentFallbackPropertyControlRef.current.value = nextPropertyId;
                        }
                      }}
                       defaultPropertyId={
                         (selectedCustomerDetails as CustomerOption | undefined)?.effectiveDefaultPropertyId ??
                         selectedCustomer?.effectiveDefaultPropertyId ??
                         selectedCustomer?.defaultPropertyId
                       }
                    />
              </div>
            </div>
          </div>

          {/* Quote Settings */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Settings</h2>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="rounded-xl h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Valid Until</Label>
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="rounded-xl h-11" />
              </div>
            </div>
          </div>

          {/* Sticky totals + save (desktop sidebar) */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4 lg:sticky lg:top-20">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Summary</h2>

            <div className="space-y-2 pb-3 border-b border-slate-100">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Items</span>
                <span className="font-medium text-slate-700">{itemCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-semibold text-slate-800">{formatCurrency(subtotal)}</span>
              </div>
            </div>

            {/* Total — most prominent */}
            <div className="flex justify-between items-end">
              <span className="text-base font-bold text-slate-800">Total</span>
              <span className="text-3xl font-bold text-primary tabular-nums">{formatCurrency(subtotal)}</span>
            </div>

            <button
              type="submit"
              data-testid="save-quote-top"
              disabled={createMutation.isPending || createScheduledMutation.isPending}
              className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 active:scale-[.98]
                         text-white text-base font-bold shadow-md shadow-primary/20
                         transition-all disabled:opacity-60"
            >
              {createMutation.isPending || createScheduledMutation.isPending ? "Saving…" : "Save Quote"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/quotes")}
              className="w-full h-10 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* ─── RIGHT: Line Items + Notes ─────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Line Items */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            {/* Section header + add buttons */}
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                Line Items
                {itemCount > 0 && (
                  <span className="ml-2 text-xs font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full normal-case tracking-normal">
                    {itemCount}
                  </span>
                )}
              </h2>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-primary text-white
                             text-xs font-bold shadow-sm shadow-primary/20 hover:bg-primary/90
                             active:scale-[.97] transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Add Service
                </button>
                <button
                  type="button"
                  onClick={addCustomItem}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200
                             text-slate-600 text-xs font-semibold hover:bg-slate-50 active:scale-[.97] transition-all"
                >
                  <PenLine className="w-3.5 h-3.5" />
                  Custom
                </button>
              </div>
            </div>

            {/* Item cards */}
            {lineItems.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-xl">
                <FileText className="w-10 h-10 text-slate-200 mb-3" />
                <p className="text-slate-500 font-semibold mb-1">No services added yet</p>
                <p className="text-slate-400 text-xs mb-4">Add from your catalog or create a custom line item</p>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="flex items-center gap-2 h-9 px-4 rounded-xl bg-primary text-white text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Add Service
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {lineItems.map((item, i) => (
                  <LineItemCard
                    key={item.key}
                    item={item}
                    index={i}
                    onUpdate={updateItem}
                    onRemove={removeItem}
                    canRemove={lineItems.length > 0}
                  />
                ))}
                {/* Add more row */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowPicker(true)}
                    className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border-2 border-dashed border-slate-200
                               text-slate-500 text-xs font-semibold hover:border-primary/30 hover:text-primary hover:bg-primary/5
                               transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Add Service
                  </button>
                  <button
                    type="button"
                    onClick={addCustomItem}
                    className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border-2 border-dashed border-slate-200
                               text-slate-500 text-xs font-semibold hover:border-slate-300 hover:bg-slate-50
                               transition-all"
                  >
                    <PenLine className="w-3.5 h-3.5" />
                    Custom Line
                  </button>
                </div>
              </div>
            )}

            {/* Inline totals (visible on mobile / below items on all sizes) */}
            {itemCount > 0 && (
              <div className="mt-5 pt-4 border-t border-slate-100 flex justify-end">
                <div className="space-y-1.5 min-w-[200px]">
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Subtotal</span>
                    <span className="font-semibold text-slate-800">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-end pt-1 border-t border-slate-100">
                    <span className="text-base font-bold text-slate-900">Total</span>
                    <span className="text-xl font-bold text-primary">{formatCurrency(subtotal)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-sky-100 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Estimate Appointment</h2>
              <p className="mt-1 text-xs text-slate-400">Optional. Schedule the on-site estimate; the selected property becomes its first location.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input ref={appointmentDurationTouchedControlRef} type="hidden" name="appointmentDurationTouched" defaultValue="false" />
              <input ref={appointmentFallbackPropertyControlRef} type="hidden" name="appointmentFallbackPropertyId" defaultValue="" />
              <div className="space-y-1.5"><Label>Date</Label><Input name="appointmentDate" type="date" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Start time</Label><Input name="appointmentTime" type="time" value={appointmentTime} onChange={(e) => setAppointmentTime(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <Select name="appointmentDuration" value={appointmentDuration} onValueChange={(value) => {
                  setAppointmentDuration(value);
                  if (appointmentDurationTouchedControlRef.current) {
                    appointmentDurationTouchedControlRef.current.value = "true";
                  }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 minutes</SelectItem><SelectItem value="60">1 hour</SelectItem>
                    <SelectItem value="90">90 minutes</SelectItem><SelectItem value="120">2 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Assigned employee</Label>
                <Select name="assignedUserId" value={assignedUserId} onValueChange={setAssignedUserId} disabled={selectableEstimateEmployees.length === 0}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{selectableEstimateEmployees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.displayName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {!estimateEmployeesLoading && selectableEstimateEmployees.length === 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="status">
                No active Field or Team Technician is available. Appointment scheduling is unavailable; leave every appointment field blank to save this quote without an appointment.
              </p>
            )}
            {availableAppointmentProperties.length > 0 && (
              <div><Label>Estimate locations</Label><div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">{availableAppointmentProperties.map((property: any) => <label key={property.id} className="flex items-start gap-2 rounded-xl border p-3 text-sm"><input name="appointmentPropertyIds" value={property.id} type="checkbox" checked={appointmentPropertyIds.includes(property.id)} onChange={(e) => setAppointmentPropertyIds((current) => e.target.checked ? [...current, property.id] : current.filter((id) => id !== property.id))} /><span><strong>{property.name || property.address}</strong><span className="block text-xs text-slate-400">{[property.address, property.city, property.state].filter(Boolean).join(", ")}</span></span></label>)}</div></div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Appointment notes</Label><Textarea name="appointmentNotes" value={appointmentNotes} onChange={(e) => setAppointmentNotes(e.target.value)} placeholder="Arrival, access, or scheduling notes…" rows={3} /></div>
              <div className="space-y-1.5"><Label>Estimate notes</Label><Textarea name="estimateNotes" value={estimateNotes} onChange={(e) => setEstimateNotes(e.target.value)} placeholder="Scope to inspect or discuss…" rows={3} /></div>
            </div>
          </div>

          {/* Notes & Terms */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Notes & Terms</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any notes for this quote…"
                  className="rounded-xl resize-none text-sm"
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Terms & Conditions</Label>
                <Textarea
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Payment terms, conditions…"
                  className="rounded-xl resize-none text-sm"
                  rows={3}
                />
              </div>
            </div>
          </div>

          {/* Mobile: Save button at bottom of content */}
          <div className="lg:hidden space-y-2">
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex justify-between items-end mb-4">
                <span className="text-base font-bold text-slate-800">Total</span>
                <span className="text-3xl font-bold text-primary">{formatCurrency(subtotal)}</span>
              </div>
              <button
                type="submit"
                data-testid="save-quote-bottom"
                disabled={createMutation.isPending || createScheduledMutation.isPending}
                className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 active:scale-[.98]
                           text-white text-base font-bold shadow-md shadow-primary/20 transition-all disabled:opacity-60"
              >
                {createMutation.isPending || createScheduledMutation.isPending ? "Saving…" : "Save Quote"}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Service Picker */}
      {showPicker && (
        <ServicePickerDialog
          services={services ?? []}
          onAdd={addServiceItem}
          onClose={() => setShowPicker(false)}
          navigate={navigate}
        />
      )}
    </Layout>
  );
}
