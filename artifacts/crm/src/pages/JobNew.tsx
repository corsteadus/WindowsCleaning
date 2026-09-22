import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import {
  ArrowLeft, Calendar, Clock, User, Briefcase, Users, FileText, RefreshCw, Plus,
} from "lucide-react";
import {
  useCreateJob,
  useGetCustomer,
  useListCrews,
  useListServices,
  useListActiveTeamUsers,
  getListJobsQueryKey,
  getListUnscheduledJobsQueryKey,
  getGetCustomerQueryKey,
  getGetJobQueryKey,
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
import { QuickAddService } from "@/components/QuickAddService";
import { nextIdSelectValue, nextOptionalSelectValue } from "@/lib/select-guards";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { filterSelectableCrewTechnicians } from "@/lib/crew-technician-options";
import { submittedJobSchedule } from "@/lib/job-new-scheduled-date";
import { committedJobScheduleMatches } from "@/lib/job-date-commit";
import { useLocation, useSearch } from "wouter";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerLike {
  id: number;
  firstName: string;
  lastName: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string;
  defaultPropertyId?: number | null;
  effectiveDefaultPropertyId?: number | null;
}

interface CrewLike {
  id: number;
  name: string;
  isActive: boolean;
}

interface ServiceLike {
  id: number;
  name: string;
  basePrice?: number | null;
  pricingType?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function customerLabel(c: CustomerLike) {
  const fullName = `${c.firstName} ${c.lastName}`.trim();
  return c.companyName ? `${fullName} — ${c.companyName}` : fullName;
}

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly",
  bimonthly: "Bi-monthly", quarterly: "Quarterly",
  semiannual: "Semi-annual", annual: "Annual",
};

// Radix-facing sentinels for the in-form Selects (non-empty by contract —
// see select-guards.ts).  Stored state keeps "" / absence as "unset"; these
// are the mounted <SelectItem> values that mean "cleared on purpose", and
// the ONLY way a selection may transition back to unset via onValueChange.
const SERVICE_NONE    = "none";
const CREW_UNASSIGNED = "unassigned";
const TECH_UNASSIGNED = "unassigned";

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function JobNew() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Parse URL params
  const params = new URLSearchParams(search);
  const preCustomerId  = params.get("customerId") ? Number(params.get("customerId")) : null;
  const preRecurringId = params.get("recurringPlanId") ? Number(params.get("recurringPlanId")) : null;
  const preDate        = params.get("date") ?? "";

  // ── Form state ──────────────────────────────────────────────────────────────
  const [manualCustomer, setManualCustomer] = useState<CustomerLike | undefined>(undefined);
  const [propertyId,    setPropertyId]    = useState<number | "">("");
  const [crewId,        setCrewId]        = useState<number | "">("");
  const [assignedTechnicianUserId, setAssignedTechnicianUserId] = useState<string>("");
  const [serviceType,   setServiceType]   = useState("");
  const [scheduledDate, setScheduledDate] = useState(preDate || format(new Date(), "yyyy-MM-dd"));
  const [startTime,     setStartTime]     = useState("");
  const [endTime,       setEndTime]       = useState("");
  const [totalAmount,   setTotalAmount]   = useState("");
  const [notes,         setNotes]         = useState("");
  const [status,        setStatus]        = useState("scheduled");

  // ── Data fetching ───────────────────────────────────────────────────────────
  const { data: preCustomerData } = useGetCustomer(preCustomerId ?? 0, {
    query: { enabled: !!preCustomerId, queryKey: authScopedQueryKey(user, getGetCustomerQueryKey(preCustomerId ?? 0)) },
  });
  const selectedCustomer = manualCustomer ?? (preCustomerId ? (preCustomerData as CustomerLike | undefined) : undefined);
  const customerId = selectedCustomer ? selectedCustomer.id : ("" as number | "");
  const { data: selectedCustomerDetails } = useGetCustomer(Number(customerId) || 0, {
    query: {
      enabled: !!customerId,
      queryKey: authScopedQueryKey(user, getGetCustomerQueryKey(Number(customerId) || 0)),
    },
  });
  const effectiveDefaultPropertyId =
    (selectedCustomerDetails as CustomerLike | undefined)?.effectiveDefaultPropertyId ??
    selectedCustomer?.effectiveDefaultPropertyId ??
    selectedCustomer?.defaultPropertyId;

  const { data: crewsData } = useListCrews();
  const crews = ((crewsData ?? []) as CrewLike[]).filter((c) => c.isActive);

  const { data: teamUsersData } = useListActiveTeamUsers({
    query: { queryKey: authScopedQueryKey(user, ["/api/team-users/active"]) }
  });
  const teamUsers = filterSelectableCrewTechnicians(teamUsersData ?? []);

  const { data: servicesData } = useListServices();
  const services = (servicesData ?? []) as ServiceLike[];
  const [addingService, setAddingService] = useState(false);

  // Auto-fill amount when service selected
  useEffect(() => {
    if (!serviceType) return;
    const svc = services.find((s) => s.name === serviceType);
    if (svc?.basePrice && !totalAmount) {
      setTotalAmount(String(svc.basePrice));
    }
  }, [serviceType]);

  // Reset property when customer changes. PropertyPicker then applies the
  // effective default for the newly selected account once its active choices load.
  useEffect(() => {
    setPropertyId("");
  }, [customerId]);

  // ── Mutation ────────────────────────────────────────────────────────────────
  const createJob = useCreateJob({
    mutation: {
      onSuccess: (job, variables) => {
        queryClient.setQueryData(
          authScopedQueryKey(user, getGetJobQueryKey(job.id)),
          job,
        );
        if (!committedJobScheduleMatches(variables.data, job)) {
          toast({
            title: "Schedule not confirmed",
            description: "The server did not commit the date and times you entered. Review the saved job before continuing.",
            variant: "destructive",
          });
          return;
        }
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListUnscheduledJobsQueryKey() });
        toast({ title: "Job scheduled!", description: `${(job as { jobNumber: string }).jobNumber} created successfully.` });
        navigate(`/jobs/${(job as { id: number }).id}`);
      },
      onError: () => toast({ title: "Failed to create job", variant: "destructive" }),
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submittedSchedule = submittedJobSchedule(e.currentTarget, {
      date: scheduledDate,
      startTime,
      endTime,
    });
    if (!customerId) {
      toast({ title: "Customer required", variant: "destructive" });
      return;
    }
    createJob.mutate({
      data: {
        customerId:         Number(customerId),
        propertyId:         propertyId ? Number(propertyId) : undefined,
        crewId:             crewId ? Number(crewId) : null,
        assignedTechnicianUserId: assignedTechnicianUserId ? assignedTechnicianUserId : null,
        recurringPlanId:    preRecurringId ?? undefined,
        serviceType:        serviceType || undefined,
        scheduledDate:      submittedSchedule.date || null,
        scheduledStartTime: submittedSchedule.startTime || null,
        scheduledEndTime:   submittedSchedule.endTime || null,
        totalAmount:        parseFloat(totalAmount || "0"),
        notes:              notes || undefined,
        status,
        isRecurring:        !!preRecurringId,
      } as Parameters<typeof createJob.mutate>[0]["data"],
    });
  };

  return (
    <Layout>
      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Button type="button" variant="ghost" size="icon" aria-label="Go back" onClick={() => navigate(-1 as never)} className="rounded-xl h-9 w-9">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900">Schedule a Job</h1>
            <p className="text-sm text-muted-foreground">
              {preRecurringId ? "Generating job from recurring plan" : "Create a new job directly without needing a quote"}
            </p>
          </div>
        </div>

        <div className="space-y-5">

          {/* ── 1. Customer ───────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-slate-900">Customer</h2>
              <span className="text-red-500 text-sm">*</span>
            </div>

            {preCustomerId && selectedCustomer ? (
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-slate-900">{customerLabel(selectedCustomer)}</p>
                  {selectedCustomer.phone && <p className="text-xs text-slate-500">{selectedCustomer.phone}</p>}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-400"
                  onClick={() => { setManualCustomer(undefined); navigate("/jobs/new"); }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Select customer <span className="text-red-500">*</span></Label>
                <CustomerCombobox
                  selectedCustomer={selectedCustomer}
                  onSelect={(customer) => setManualCustomer(customer as CustomerLike)}
                  labelFor={customerLabel}
                  placeholder="Search or select customer…"
                />
              </div>
            )}

            {/* Property */}
            {customerId && (
              <div>
                <PropertyPicker
                  customerId={Number(customerId)}
                  value={propertyId}
                  onChange={(value) => setPropertyId(value)}
                   defaultPropertyId={effectiveDefaultPropertyId}
                />
              </div>
            )}
          </section>

          {/* ── 2. Service ────────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-slate-900">Service</h2>
            </div>

            <div className="space-y-1.5">
              <Label>Service Type</Label>
              <Select value={serviceType || SERVICE_NONE} onValueChange={(v) => setServiceType((prev) => nextOptionalSelectValue(prev, v, SERVICE_NONE))}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select service…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SERVICE_NONE}>Not specified</SelectItem>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.name}>
                      <span>{s.name}</span>
                      {s.basePrice && <span className="text-slate-400 ml-2">${s.basePrice}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {addingService ? (
                <QuickAddService
                  onCreated={(service) => {
                    setServiceType(service.name);
                    if (!totalAmount && service.basePrice != null) setTotalAmount(String(service.basePrice));
                    setAddingService(false);
                  }}
                  onCancel={() => setAddingService(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingService(true)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {services.length === 0 ? "The catalog is empty — add a service" : "New service"}
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Estimated Total ($)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="0.00"
                className="rounded-xl max-w-xs"
              />
            </div>
          </section>

          {/* ── 3. Schedule ───────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-slate-900">Date & Time</h2>
            </div>

            <div className="space-y-1.5">
              <Label>Scheduled Date</Label>
              <Input
                type="date"
                name="scheduledDate"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Start Time</Label>
                <Input
                  type="time"
                  name="scheduledStartTime"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> End Time</Label>
                <Input
                  type="time"
                  name="scheduledEndTime"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="rounded-xl"
                />
              </div>
            </div>
          </section>

          {/* ── 4. Crew & Technician ─────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-slate-900">Assignment</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Assign Crew</Label>
                <Select value={crewId ? String(crewId) : CREW_UNASSIGNED} onValueChange={(v) => setCrewId((prev) => nextIdSelectValue(prev, v, CREW_UNASSIGNED))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Unassigned — assign later" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CREW_UNASSIGNED}>Unassigned</SelectItem>
                    {crews.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Assign Direct Tech</Label>
                <Select value={assignedTechnicianUserId || TECH_UNASSIGNED} onValueChange={(v) => setAssignedTechnicianUserId((prev) => nextOptionalSelectValue(prev, v, TECH_UNASSIGNED))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TECH_UNASSIGNED}>Unassigned</SelectItem>
                    {teamUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* ── 5. Notes ──────────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-slate-900">Notes</h2>
            </div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Customer instructions, access notes, scope details…"
              className="rounded-xl resize-none min-h-[80px]"
              rows={3}
            />
          </section>

          {/* ── Actions ──────────────────────────────────────────────────── */}
          <div className="flex gap-3 pb-10">
            <Button
              type="submit"
              className="flex-1 h-11 rounded-xl shadow-md shadow-primary/20 text-base font-semibold"
              disabled={createJob.isPending || !customerId}
            >
              {createJob.isPending ? "Scheduling…" : "Schedule Job"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl px-6"
              onClick={() => navigate("/jobs")}
            >
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Layout>
  );
}
