import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { ArrowLeft } from "lucide-react";
import {
  useCreateRecurringPlan,
  getListRecurringPlansQueryKey,
  useGetCustomer,
  getGetCustomerQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CustomerCombobox } from "@/components/CustomerCombobox";
import { PropertyPicker } from "@/components/PropertyPicker";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { useLocation } from "wouter";
import {
  CUSTOMER_NONE,
  PROPERTY_NONE,
  SERVICE_NONE,
  CUSTOMER_PLACEHOLDER,
  SERVICE_ANY_LABEL,
  buildRecurringPlanPayload,
  customerOptionLabel,
  selectedServiceLabel,
  nextSelectValue,
  nextOptionalSelectValue,
  DAY_TIME_ANY,
  type CustomerOption,
} from "@/lib/recurring-plan-form";

const FREQ_OPTIONS = [
  { value: "weekly",     label: "Weekly",        hint: "Every 7 days" },
  { value: "biweekly",   label: "Every 2 Weeks",  hint: "Every 14 days" },
  { value: "monthly",    label: "Monthly",        hint: "Every 1 month" },
  { value: "bimonthly",  label: "Every 2 Months", hint: "Every 2 months" },
  { value: "quarterly",  label: "Quarterly",      hint: "Every 3 months" },
  { value: "semiannual", label: "Semi-Annual",    hint: "Every 6 months" },
  { value: "annual",     label: "Annual",         hint: "Every 12 months" },
];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TIME_WINDOWS = [
  { value: "07:00", label: "7:00 AM" },
  { value: "08:00", label: "8:00 AM" },
  { value: "09:00", label: "9:00 AM" },
  { value: "10:00", label: "10:00 AM" },
  { value: "11:00", label: "11:00 AM" },
  { value: "12:00", label: "12:00 PM" },
  { value: "13:00", label: "1:00 PM" },
  { value: "14:00", label: "2:00 PM" },
];

const SERVICE_TYPES = [
  { value: "window_cleaning", label: "Window Cleaning" },
  { value: "gutter_cleaning", label: "Gutter Cleaning" },
  { value: "pressure_washing", label: "Pressure Washing" },
  { value: "solar_panels", label: "Solar Panel Cleaning" },
  { value: "general", label: "General Service" },
];

/**
 * The combobox hands back (and the page holds) the FULL selected customer
 * record — never an id to re-find in a result page — so the selection and
 * its label survive search churn, refetches, and absence from the current
 * bounded search page. email/clientType feed the shared combobox row UI.
 */
type PlanCustomer = CustomerOption & {
  email?: string | null;
  clientType?: string | null;
  defaultPropertyId?: number | null;
  effectiveDefaultPropertyId?: number | null;
};

export default function RecurringPlanNew() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Non-empty sentinels replace "" to prevent Radix UI runtime crashes.
  // PROPERTY_NONE / SERVICE_NONE are non-empty strings; customerId is now
  // DERIVED from the held customer record (numeric string when selected,
  // CUSTOMER_NONE sentinel when not) so the payload builder, the property
  // gating, and the reset effect keep their exact historical semantics.
  const [selectedCustomer, setSelectedCustomer] = useState<PlanCustomer | null>(null);
  const customerId = selectedCustomer ? String(selectedCustomer.id) : CUSTOMER_NONE;
  const [propertyId, setPropertyId] = useState<string>(PROPERTY_NONE);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [frequencyType, setFrequencyType] = useState("quarterly");
  const [preferredDay, setPreferredDay] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [nextRunDate, setNextRunDate] = useState("");
  const [serviceType, setServiceType] = useState<string>(SERVICE_NONE);
  const [estimatedAmount, setEstimatedAmount] = useState("");
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState("");
  const [defaultServiceNotes, setDefaultServiceNotes] = useState("");

  // Customer options come from the shared server-search CustomerCombobox —
  // the old preloaded limit-200 list is gone (the API caps page size at 200,
  // so with ~3,000+ customers most could never appear in that dropdown).

  // Only show property choices once a real customer is selected.
  const isCustomerSelected = customerId !== CUSTOMER_NONE;
  const { data: selectedCustomerDetails } = useGetCustomer(Number(customerId) || 0, {
    query: {
      enabled: isCustomerSelected,
      queryKey: authScopedQueryKey(user, getGetCustomerQueryKey(Number(customerId) || 0)),
    },
  });
  const effectiveDefaultPropertyId =
    (selectedCustomerDetails as PlanCustomer | undefined)?.effectiveDefaultPropertyId ??
    selectedCustomer?.effectiveDefaultPropertyId ??
    selectedCustomer?.defaultPropertyId;

  // Reset property sentinel whenever customer changes.
  useEffect(() => { setPropertyId(PROPERTY_NONE); }, [customerId]);

  const createMutation = useCreateRecurringPlan({
    mutation: {
      onSuccess: (plan) => {
        queryClient.invalidateQueries({ queryKey: getListRecurringPlansQueryKey() });
        toast({ title: "Recurring plan created!" });
        navigate(`/recurring-plans/${(plan as { id: number }).id}`);
      },
      onError: () => toast({ title: "Failed to create plan", variant: "destructive" }),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildRecurringPlanPayload({
      customerId, propertyId, name, status, frequencyType,
      preferredDay, preferredTime, nextRunDate, serviceType,
      estimatedAmount, defaultDurationMinutes, defaultServiceNotes,
    });
    if (!payload) {
      toast({ title: "Customer, name, and frequency are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({ data: payload as Parameters<typeof createMutation.mutate>[0]["data"] });
  };

  const freqHint = FREQ_OPTIONS.find((f) => f.value === frequencyType)?.hint;

  return (
    <Layout>
      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Button type="button" variant="ghost" size="icon" onClick={() => navigate("/recurring-plans")} className="rounded-xl h-9 w-9">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900">New Recurring Plan</h1>
            <p className="text-sm text-muted-foreground">Set up a repeat service schedule for a customer.</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Customer & Property */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-slate-900">Customer & Property</h2>
            <div className="space-y-1.5">
              <Label>Customer <span className="text-red-500">*</span></Label>
              {/* Debounced SERVER-side search (shared combobox, one bounded
                  result page) replaces the preloaded limit-200 Radix Select —
                  with ~3,000+ customers the old dropdown could never contain
                  most of them.  The page holds the full selected record, so
                  the closed-trigger label is deterministic under any list
                  churn and keeps the shared precedence via customerOptionLabel:
                  displayName → person name → company name → Customer #id.
                  activeOnly={false} preserves this page's historical behavior
                  of offering customers of every status.
                  This is a cmdk/popover control, NOT a Radix Select — no
                  bubble-input circuit exists here, so no transition guard is
                  needed; the remaining six Selects below keep their guards. */}
              <CustomerCombobox
                selectedCustomer={selectedCustomer}
                onSelect={setSelectedCustomer}
                labelFor={customerOptionLabel}
                placeholder={CUSTOMER_PLACEHOLDER}
                showClientTypeIcon
                activeOnly={false}
              />
            </div>
            {/* Only show property picker after a real customer is selected. */}
            {isCustomerSelected && (
              <div className="space-y-1.5">
                <Label>Property</Label>
                <PropertyPicker
                  customerId={Number(customerId)}
                  value={propertyId === PROPERTY_NONE ? "" : Number(propertyId)}
                  onChange={(value) => setPropertyId(value ? String(value) : PROPERTY_NONE)}
                   defaultPropertyId={effectiveDefaultPropertyId}
                />
              </div>
            )}
          </div>

          {/* Plan details */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-slate-900">Plan Details</h2>
            <div className="space-y-1.5">
              <Label>Plan Name <span className="text-red-500">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Quarterly Window & Gutter Service"
                className="rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus((prev) => nextSelectValue(prev, v))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Service Type</Label>
                {/* SERVICE_NONE ("none") sentinel; first item allows deselection.
                    Closed-trigger text is computed explicitly (see Customer
                    select above) so the empty state always reads
                    SERVICE_ANY_LABEL even if SERVICE_TYPES were empty. */}
                <Select value={serviceType} onValueChange={(v) => setServiceType((prev) => nextSelectValue(prev, v))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder={SERVICE_ANY_LABEL}>
                      {selectedServiceLabel(serviceType, SERVICE_TYPES) ?? SERVICE_ANY_LABEL}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SERVICE_NONE}>{SERVICE_ANY_LABEL}</SelectItem>
                    {SERVICE_TYPES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Frequency */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-slate-900">Frequency</h2>
            <div className="space-y-1.5">
              <Label>Repeats <span className="text-red-500">*</span></Label>
              <Select value={frequencyType} onValueChange={(v) => setFrequencyType((prev) => nextSelectValue(prev, v))}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQ_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {freqHint && (
                <p className="text-xs text-slate-400">{freqHint} — each generated job will advance the next run date by this interval.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Preferred Day</Label>
                <Select value={preferredDay || DAY_TIME_ANY} onValueChange={(v) => setPreferredDay((prev) => nextOptionalSelectValue(prev, v))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Any day" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">No preference</SelectItem>
                    {DAYS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Preferred Start Time</Label>
                <Select value={preferredTime || DAY_TIME_ANY} onValueChange={(v) => setPreferredTime((prev) => nextOptionalSelectValue(prev, v))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Any time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">No preference</SelectItem>
                    {TIME_WINDOWS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>First / Next Run Date</Label>
              <Input
                type="date"
                value={nextRunDate}
                onChange={(e) => setNextRunDate(e.target.value)}
                className="rounded-xl"
              />
              <p className="text-xs text-slate-400">The date when the first job should be generated.</p>
            </div>
          </div>

          {/* Financial */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-slate-900">Job Defaults</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Estimated Amount ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedAmount}
                  onChange={(e) => setEstimatedAmount(e.target.value)}
                  placeholder="0.00"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Est. Duration (min)</Label>
                <Input
                  type="number"
                  min="0"
                  value={defaultDurationMinutes}
                  onChange={(e) => setDefaultDurationMinutes(e.target.value)}
                  placeholder="120"
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Default Job Notes</Label>
              <Textarea
                value={defaultServiceNotes}
                onChange={(e) => setDefaultServiceNotes(e.target.value)}
                placeholder="Notes that will be copied to every generated job…"
                className="rounded-xl resize-none"
                rows={3}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pb-8">
            <Button
              type="submit"
              className="flex-1 h-11 rounded-xl shadow-md shadow-primary/20 text-base font-semibold"
              disabled={createMutation.isPending || !isCustomerSelected || !name}
            >
              {createMutation.isPending ? "Creating…" : "Create Plan"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl px-6"
              onClick={() => navigate("/recurring-plans")}
            >
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Layout>
  );
}
