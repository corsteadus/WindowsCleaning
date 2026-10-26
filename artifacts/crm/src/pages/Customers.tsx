import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  useCreateCustomer,
  useCreateProspect,
  useListCustomerDuplicateCandidates,
  useListProspectDuplicateCandidates,
  useListCrews,
  useListServices,
  useListActiveTeamUsers,
  createCustomerWithInitialJob,
  getListCustomersQueryKey,
  getListProspectsQueryKey,
  type CreateCustomerBody
} from "@workspace/api-client-react";
import { shouldDisableCustomerCreate } from "../lib/customer-create-guard";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { useAuth } from "@workspace/replit-auth-web";
import { hasClientCapability } from "@/lib/rbac";
import { getCustomersEmptyStateDescription } from "@/lib/schedule-empty-state";
import { customerListSearchLocation } from "@/lib/customer-list-url";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { formatPhoneAsTyped } from "@/lib/phone-format";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Layout } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { customerLifecycleDisplayStatus } from "@/lib/customer-lifecycle-display";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Users, Phone, Mail, ChevronRight, ChevronLeft, User, MapPin, Layers, Info, StickyNote, CalendarClock } from "lucide-react";
import { TimeSelect } from "@/components/TimeSelect";
import { EmailRows, ExtraLocations, OwnerSelect } from "@/components/IntakeFields";
import { IntakeEstimate } from "@/components/IntakeEstimate";
import {
  BLANK_APPOINTMENT, buildEstimate, emailBlocker, estimateProblems,
  type EstimateAppointmentDraft, type EstimateLineDraft,
} from "@/lib/intake-estimate";
import { filterSelectableCrewTechnicians } from "@/lib/crew-technician-options";
import { estimateCall, finalizeEstimate } from "@/lib/estimate-actions";
import {
  ACCOUNT_OWNER, INTAKE_PHONES, buildIntake, intakeProblems, namedPeople,
  type IntakeEmailRow, type IntakeLocationRow, type IntakeSlot, type Owner,
} from "@/lib/intake-form";
import { CustomFieldFilter } from "@/components/CustomFieldFilter";
import {
  type CustomFieldFilterState,
  NO_CUSTOM_FIELD_FILTER,
  customFieldFilterParams,
} from "@/lib/custom-field-filter";

const PAGE_SIZE = 75;

// ─── Schema ───────────────────────────────────────────────────────────────────

const customerSchema = z.object({
  // Contact
  salutation:    z.string().optional(),
  firstName:     z.string().min(1, "First name is required"),
  lastName:      z.string().min(1, "Last name is required"),
  companyName:   z.string().optional(),
  email:         z.string().email("Enter a valid email").optional().or(z.literal("")),
  homePhone:     z.string().optional(),
  workPhone:     z.string().optional(),
  cellPhone:     z.string().optional(),
  altPhone:      z.string().optional(),
  fax:           z.string().optional(),
  altPhoneType:  z.string().optional(),
  altContact:    z.string().optional(),
  birthday:      z.string().optional(),
  starRating:    z.coerce.number().int().min(1).max(5).optional().or(z.literal("")).transform(v => v === "" ? undefined : v),
  // Address
  billingAddress: z.string().optional(),
  billingCity:    z.string().optional(),
  billingState:   z.string().optional(),
  billingZip:     z.string().optional(),
  county:         z.string().optional(),
  subdivision:    z.string().optional(),
  // Window / Property
  windowCount:   z.coerce.number().int().optional().or(z.literal("")).transform(v => v === "" ? undefined : v),
  windowType:    z.string().optional(),
  houseSize:     z.string().optional(),
  laddersNeeded: z.string().optional(),
  // Account
  lifecycleStatus:        z.enum(["prospect", "customer", "inactive", "archived"]).default("customer"),
  accountType:            z.enum(["residential", "commercial"]).default("residential"),
  isNonProfit:            z.boolean().default(false),
  ccFeeExempt:            z.boolean().default(false),
  taxExempt:              z.boolean().default(false),
  customerDate:           z.string().optional(),
  preferredContactMethod: z.string().optional(),
  sendingPreferences:     z.string().optional(),
  howHeard:               z.string().optional(),
  tags:                   z.string().optional(),
  // Notes
  notes: z.string().optional(),
  // What the crew sees on the job (Kyle, Video 2).
  directions: z.string().optional(),
});
type CustomerFormValues = z.infer<typeof customerSchema>;

// ─── Paginated fetch ──────────────────────────────────────────────────────────

interface CustomerPage {
  customers: {
    id: number;
    firstName: string;
    lastName: string;
    companyName?: string | null;
    email?: string | null;
    homePhone?: string | null;
    cellPhone?: string | null;
    phone?: string | null;
    status: string;
    lifecycleStatus?: string | null;
    accountType?: string | null;
    windowCount?: number | null;
    starRating?: number | null;
    billingCity?: string | null;
  }[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function useCustomers(
  search: string,
  page: number,
  accountType: string,
  lifecycleStatus: string,
  mode: "customers" | "prospects",
  includeDeactivated: boolean,
  // Kyle #3: one custom field and one value, narrowing the list with everything else.
  customField: CustomFieldFilterState = NO_CUSTOM_FIELD_FILTER,
) {
  const { user } = useAuth();
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (search) params.set("search", search);
  if (accountType) params.set("accountType", accountType);
  if (lifecycleStatus) params.set("lifecycleStatus", lifecycleStatus);
  if (includeDeactivated) params.set("includeDeactivated", "true");
  const customFieldParams = customFieldFilterParams(customField);
  for (const [key, value] of Object.entries(customFieldParams)) params.set(key, value);
  return useQuery<CustomerPage>({
    queryKey: authScopedQueryKey(user, [
      mode, "paginated", page, search, accountType, lifecycleStatus, includeDeactivated,
      customFieldParams.customFieldId ?? "", customFieldParams.customFieldValue ?? "",
    ]),
    queryFn: async () => {
      const response = await protectedFetch(`/api/${mode}?${params}`);
      if (!response.ok) throw new Error(`Failed to load ${mode}`);
      return response.json();
    },
  });
}

// ─── CustomerCard ─────────────────────────────────────────────────────────────

function CustomerCard({
  customer,
  onView,
}: {
  customer: CustomerPage["customers"][number];
  onView: () => void;
}) {
  const displayName = customer.companyName && !customer.firstName
    ? customer.companyName
    : [customer.firstName, customer.lastName].filter(Boolean).join(" ");

  const initials = customer.firstName?.[0]
    ? [customer.firstName[0], customer.lastName?.[0]].filter(Boolean).join("").toUpperCase()
    : (customer.companyName?.[0] ?? "?").toUpperCase();

  const phone = customer.homePhone || customer.cellPhone || customer.phone;
  const importExternalId = (customer as typeof customer & { importExternalId?: string | null }).importExternalId;

  return (
    <button
      onClick={onView}
      className="w-full text-left bg-white rounded-2xl border border-slate-200 px-5 py-4
                 hover:shadow-md hover:border-slate-300 active:scale-[.998] transition-all group"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-primary">{initials}</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm truncate">
            {displayName}
            {customer.companyName && customer.firstName && (
              <span className="font-normal text-slate-400 ml-1.5 text-xs">({customer.companyName})</span>
            )}
          </p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {customer.email && (
              <span className="flex items-center gap-1 text-xs text-slate-400 truncate max-w-[200px]">
                <Mail className="w-3 h-3 shrink-0" />
                {customer.email}
              </span>
            )}
            {phone && (
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Phone className="w-3 h-3 shrink-0" />
                {phone}
              </span>
            )}
            {customer.billingCity && (
              <span className="text-xs text-slate-400">{customer.billingCity}</span>
            )}
            {importExternalId && (
              <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">CF #{importExternalId}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
           <StatusBadge status={customerLifecycleDisplayStatus(customer)} />
           {customer.accountType && (
             <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 capitalize">
               {customer.accountType}
             </span>
           )}
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
        </div>
      </div>
    </button>
  );
}

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-slate-100 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-100 rounded w-1/3" />
          <div className="h-3 bg-slate-100 rounded w-1/2" />
        </div>
        <div className="w-16 h-5 bg-slate-100 rounded-lg" />
      </div>
    </div>
  );
}

// ─── NewCustomerForm ──────────────────────────────────────────────────────────

const INPUT_CLS = "w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-slate-300";
const SELECT_CLS = "w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all";

function F({ label, error, children, required }: { label: string; error?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      {/* The control sits inside its label, so the two are actually associated:
          clicking the text focuses the field, and a screen reader reads a name
          for it. They were siblings before, which left every field nameless. */}
      <label className="block">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
        {children}
      </label>
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

/**
 * A phone field that punctuates itself as it is typed (Kyle, Testing Edits
 * 2026-10-01, #2). The person types digits; the brackets and dash appear on
 * their own. Anything that is not a plain US number is left as they wrote it.
 */
function PhoneInput({ registration, placeholder, label }: {
  registration: UseFormRegisterReturn; placeholder?: string; label?: string;
}) {
  return (
    <input
      {...registration}
      aria-label={label}
      type="tel"
      inputMode="tel"
      placeholder={placeholder ?? "(555) 000-0000"}
      className={INPUT_CLS}
      onChange={(event) => {
        event.target.value = formatPhoneAsTyped(event.target.value);
        void registration.onChange(event);
      }}
    />
  );
}

function FormSection({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pt-1">
        <Icon className="w-4 h-4 text-slate-400" />
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{title}</span>
      </div>
      <div className="bg-slate-50 rounded-xl p-4 space-y-3 border border-slate-100">
        {children}
      </div>
    </div>
  );
}

/**
 * Finalize the estimate just created and email it. Each line goes with its own
 * location and description (#31), read back from the server. Returns the
 * reason it was not sent, or null.
 */
async function sendNewEstimate(estimate: { id: number }, email: string): Promise<string | null> {
  try {
    await finalizeEstimate(estimate.id);
    await estimateCall(`/quotes/${estimate.id}/deliver`, { method: "POST", body: JSON.stringify({ channels: ["email"], email }) });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The estimate could not be sent";
  }
}

function NewCustomerForm({
  onSuccess,
  mode,
}: {
  onSuccess: () => void;
  mode: "customers" | "prospects";
}) {
  const isProspect = mode === "prospects";
  const entityLabel = isProspect ? "Prospect" : "Customer";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canScheduleInitialJob = hasClientCapability(user, "schedule.manage");
  // Profile Notes #15: a new prospect's estimate is scheduled in the same sitting.
  // The appointment belongs to an estimate on the server, so creating the
  // prospect carries straight on into its estimate with the appointment open.
  const canScheduleEstimate = isProspect && hasClientCapability(user, "quotes.manage");
  // Piece B2 (Kyle, Video 3): the estimate is booked on this same form. On by
  // default — it is why the prospect called.
  const [scheduleEstimateNext, setScheduleEstimateNext] = useState(true);
  // Every role with quotes.manage may also book and send an estimate; the
  // server still checks estimates.schedule and estimates.deliver itself.
  const canBookEstimateTime = canScheduleEstimate;
  const canEmailEstimate = canScheduleEstimate;
  const [estimateLines, setEstimateLines] = useState<EstimateLineDraft[]>([
    { key: "s0", serviceId: null, description: "", quantity: "1", unitPrice: "", location: 0, serviceNotes: "" },
  ]);
  const [estimateAppointment, setEstimateAppointment] = useState<EstimateAppointmentDraft>(BLANK_APPOINTMENT);
  const sendEstimateRef = useRef(false);
  const { data: estimateEmployees = [] } = useQuery({
    queryKey: authScopedQueryKey(user, ["estimate-employees"]),
    enabled: canScheduleEstimate && canBookEstimateTime,
    queryFn: async () => {
      const response = await protectedFetch(`${import.meta.env.BASE_URL.replace(/\/+$/, "")}/api/estimate-employees`, { credentials: "include" });
      if (!response.ok) return [];
      return response.json() as Promise<Array<{ id: string; displayName: string; role?: string | null; isActive?: boolean }>>;
    },
  });
  const estimators = filterSelectableCrewTechnicians(estimateEmployees);
  const [, navigate] = useLocation();
  // Profile redesign piece B: what the profile page holds, asked for up front.
  const [owners, setOwners] = useState<Partial<Record<IntakeSlot, Owner>>>({});
  const [cell2, setCell2] = useState("");
  const [emailRows, setEmailRows] = useState<IntakeEmailRow[]>([{ key: "e0", value: "", owner: ACCOUNT_OWNER, routing: "general" }]);
  const [extraLocations, setExtraLocations] = useState<IntakeLocationRow[]>([]);
  const [marketingSource, setMarketingSource] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [intakeErrors, setIntakeErrors] = useState<string[]>([]);
  const { data: marketingSources = [] } = useQuery({
    queryKey: authScopedQueryKey(user, ["catalog", "marketing-sources"]),
    queryFn: async () => {
      const response = await protectedFetch(`${import.meta.env.BASE_URL.replace(/\/+$/, "")}/api/catalogs/marketing-sources`, { credentials: "include" });
      if (!response.ok) return [];
      const items = await response.json() as Array<{ name?: string; label?: string; value?: string }> | { items?: Array<{ name?: string; label?: string; value?: string }> };
      const list = Array.isArray(items) ? items : items.items ?? [];
      return list.map((item) => item.value ?? item.name ?? item.label ?? "").filter(Boolean);
    },
  });
  const [duplicateState, setDuplicateState] = useState<"idle" | "checking" | "none" | "candidates" | "error">("idle");
  const [duplicateCandidates, setDuplicateCandidates] = useState<any[]>([]);
  const [duplicateDecision, setDuplicateDecision] = useState<"existing" | "separate" | null>(null);
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<number | null>(null);
  const [duplicateReason, setDuplicateReason] = useState("");
  const [duplicateError, setDuplicateError] = useState("");
  const [includeInitialJob, setIncludeInitialJob] = useState(false);
  const [initialServiceId, setInitialServiceId] = useState("");
  const [initialDate, setInitialDate] = useState("");
  const [initialStart, setInitialStart] = useState("");
  const [initialEnd, setInitialEnd] = useState("");
  const [initialCrewId, setInitialCrewId] = useState("");
  const [initialEmployeeIds, setInitialEmployeeIds] = useState<string[]>([]);
  const [initialJobError, setInitialJobError] = useState("");
  const [initialCommitPending, setInitialCommitPending] = useState(false);
  const submitInFlight = useRef(false);
  const { data: servicesData } = useListServices({ query: { enabled: canScheduleInitialJob || canScheduleEstimate } as any });
  const { data: crewsData } = useListCrews({ query: { enabled: canScheduleInitialJob } as any });
  const { data: activeTeamUsersData, isLoading: activeTeamUsersLoading } = useListActiveTeamUsers({ query: { enabled: canScheduleInitialJob } as any });
  const services = (servicesData ?? []) as Array<{ id: number; name: string; basePrice: number; isActive?: boolean }>;
  const crews = (crewsData ?? []) as Array<{ id: number; name: string; isActive?: boolean; members?: string | null }>;
  const activeTeamUsers = activeTeamUsersData ?? [];

  const { register, handleSubmit, watch, setValue, formState: { errors }, reset } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      lifecycleStatus: isProspect ? "prospect" : "customer",
      accountType: "residential",
      isNonProfit: false, ccFeeExempt: false, taxExempt: false,
    },
  });

  const [firstName, lastName, email, homePhone, workPhone, cellPhone, altPhone, fax] = watch([
    "firstName", "lastName", "email", "homePhone", "workPhone", "cellPhone", "altPhone", "fax",
  ]);
  const phoneValues: Record<string, string | undefined> = { homePhone, workPhone, cellPhone, altPhone, fax };
  const accountName = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  const people = namedPeople([...Object.values(owners), ...emailRows.map((row) => row.owner)].filter(Boolean) as Owner[]);
  // The first address is the account's own: it is the form's email, so the
  // duplicate check and the email validation see it.
  const firstEmail = emailRows.find((row) => row.value.trim())?.value.trim() ?? "";
  useEffect(() => {
    setValue("email", firstEmail, { shouldValidate: Boolean(firstEmail) });
  }, [firstEmail, setValue]);
  const accountType = watch("accountType");
  // Switching to Residential hides the business name; it must not be saved from
  // behind the hidden field either.
  useEffect(() => {
    if (accountType === "residential") setValue("companyName", "");
  }, [accountType, setValue]);
  const handleDuplicateSuccess = (result: { candidates?: any[]; candidateCount: number }) => {
    setDuplicateCandidates(result.candidates ?? []);
    setDuplicateDecision(null);
    setSelectedDuplicateId(null);
    setDuplicateReason("");
    setDuplicateError("");
    setDuplicateState(result.candidateCount > 0 ? "candidates" : "none");
  };
  const handleDuplicateError = () => {
    setDuplicateCandidates([]);
    setDuplicateError("We could not verify duplicate candidates. Fix the form or try again; creation is blocked until the check succeeds.");
    setDuplicateState("error");
  };
  const duplicateCheckMutation = useListCustomerDuplicateCandidates({
    mutation: {
      onSuccess: handleDuplicateSuccess,
      onError: handleDuplicateError,
    },
  });
  const prospectDuplicateCheckMutation = useListProspectDuplicateCandidates({
    mutation: {
      onSuccess: handleDuplicateSuccess,
      onError: handleDuplicateError,
    },
  });

  useEffect(() => {
    if (!firstName?.trim() || !lastName?.trim()) {
      setDuplicateState("idle");
      setDuplicateCandidates([]);
      return;
    }
    setDuplicateState("checking");
    const timer = window.setTimeout(() => {
      const mutation = isProspect ? prospectDuplicateCheckMutation : duplicateCheckMutation;
      mutation.mutate({
        data: {
          firstName,
          lastName,
          email: email || null,
          homePhone: homePhone || null,
          workPhone: workPhone || null,
          cellPhone: cellPhone || null,
          altPhone: altPhone || null,
        } as CreateCustomerBody,
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [firstName, lastName, email, homePhone, workPhone, cellPhone, altPhone, isProspect]);

  const handleCreateSuccess = (created?: { id?: number; estimate?: { id: number; quoteNumber: string } | null }) => {
    submitInFlight.current = false;
    const madeEstimate = created?.estimate ?? null;
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["customers"]) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["prospects"]) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCustomersQueryKey()) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListProspectsQueryKey()) });
    reset();
    onSuccess();
    if (!madeEstimate || !created?.id) {
      toast({ title: `${entityLabel} created successfully` });
      return;
    }
    if (!sendEstimateRef.current) {
      toast({ title: `${entityLabel} created with estimate ${madeEstimate.quoteNumber}` });
      navigate(`/prospects/${created.id}`);
      return;
    }
    void sendNewEstimate(madeEstimate, firstEmail).then((error) => {
      if (error) {
        toast({ title: `${entityLabel} and estimate saved — the email was not sent`, description: error, variant: "destructive" });
      } else {
        // Queued, as the estimate page says: the email itself goes out through
        // the "Estimate sent" automation, which an admin switches on.
        toast({ title: `Estimate ${madeEstimate.quoteNumber} queued for email`, description: `To ${firstEmail}` });
      }
      navigate(`/quotes/${madeEstimate.id}`);
    });
  };
  const handleCreateError = (err: unknown) => {
    submitInFlight.current = false;
    const msg = (err as { message?: string })?.message ?? "Something went wrong";
    toast({ title: `Failed to create ${entityLabel.toLowerCase()}`, description: msg, variant: "destructive" });
  };
  const createMutation = useCreateCustomer({
    mutation: {
      onSuccess: handleCreateSuccess,
      onError: handleCreateError,
    },
  });
  const createProspectMutation = useCreateProspect({
    mutation: {
      onSuccess: handleCreateSuccess,
      onError: handleCreateError,
    },
  });

  const onSubmit = async (v: CustomerFormValues) => {
    if (submitInFlight.current) return;
    const intakeState = {
      phones: Object.fromEntries(INTAKE_PHONES.map(({ slot, field }) => [slot, field ? (v[field] ?? "") : cell2])),
      owners, emails: emailRows, locations: extraLocations, marketingSource,
    };
    const bookEstimate = canScheduleEstimate && scheduleEstimateNext;
    const locationCount = buildIntake(intakeState).locations.length;
    const hasMain = [v.billingAddress, v.billingCity, v.billingState, v.billingZip].every((part) => part?.trim());
    const problems = [
      ...intakeProblems(intakeState),
      ...(bookEstimate ? estimateProblems(estimateLines, estimateAppointment, { main: hasMain, locations: locationCount }) : []),
    ];
    setIntakeErrors(problems);
    if (problems.length) return;
    const intake = buildIntake(intakeState);
    const estimate = bookEstimate ? buildEstimate(estimateLines, estimateAppointment) : undefined;
    if (duplicateState === "checking" || duplicateState === "idle" || duplicateState === "error") {
      setDuplicateError("Complete the duplicate check before creating this account.");
      return;
    }
    if (duplicateState === "candidates") {
      if (duplicateDecision === "existing") {
        const selected = duplicateCandidates.find((candidate) => candidate.id === selectedDuplicateId);
        if (selected) {
          navigate(`/${selected.lifecycleStatus === "prospect" ? "prospects" : "customers"}/${selected.id}`);
          return;
        }
      }
      if (duplicateDecision !== "separate" || !duplicateReason.trim()) {
        setDuplicateError("Choose an eligible existing account or provide a reason for creating a separate account.");
        return;
      }
    }
    if (!isProspect && includeInitialJob) {
      const service = services.find((candidate) => String(candidate.id) === initialServiceId);
      const crew = crews.find((candidate) => String(candidate.id) === initialCrewId);
      const employeeIds = initialEmployeeIds;
      if (!v.billingAddress?.trim() || !v.billingCity?.trim() || !v.billingState?.trim() || !v.billingZip?.trim()
        || !service || !crew || !initialDate || !initialStart || !initialEnd || employeeIds.length === 0) {
        setInitialJobError("Complete the service address, service, date, times, crew, and employee IDs before committing.");
        return;
      }
      setInitialJobError("");
      submitInFlight.current = true;
      setInitialCommitPending(true);
      try {
        const result = await createCustomerWithInitialJob({
          ...v,
          billingAddress: v.billingAddress,
          billingCity: v.billingCity,
          billingState: v.billingState,
          billingZip: v.billingZip,
          ...(duplicateState === "candidates" ? {
            createSeparateAccount: true,
            overrideReason: duplicateReason.trim(),
          } : {}),
          // Not in the generated API types yet (the spec is regenerated with pnpm);
          // the server reads it from the body (api-server lib/intake.ts).
          ...({ intake } as object),
          initialJob: {
            accepted: true,
            scheduledDate: initialDate,
            scheduledStartTime: initialStart,
            scheduledEndTime: initialEnd,
            crewId: crew.id,
            employeeIds,
            serviceSnapshot: [{
              serviceId: service.id,
              serviceName: service.name,
              quantity: 1,
              unitPrice: Number(service.basePrice ?? 0),
              totalPrice: Number(service.basePrice ?? 0),
            }],
          },
        }, idempotencyRequest(createIdempotencyKey()));
        handleCreateSuccess();
        navigate(`/customers/${result.customer.id}`);
      } catch (error) {
        handleCreateError(error);
      } finally {
        setInitialCommitPending(false);
      }
      return;
    }
    const mutation = isProspect ? createProspectMutation : createMutation;
    submitInFlight.current = true;
    mutation.mutate({
      data: {
        ...v,
        intake,
        ...(estimate ? { estimate } : {}),
        ...(duplicateState === "candidates" ? {
          createSeparateAccount: true,
          overrideReason: duplicateReason.trim(),
        } : {}),
      } as CreateCustomerBody,
    });
  };
  const isCreatePending = createMutation.isPending || createProspectMutation.isPending || initialCommitPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-1">

      {/* ── Account type — the first choice (Kyle, Profile Notes #1) ──────── */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Account type</legend>
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Account type">
          {([
            { value: "residential", label: "Residential", hint: "A home or individual" },
            { value: "commercial", label: "Commercial", hint: "A business or organisation" },
          ] as const).map(({ value, label, hint }) => (
            <label
              key={value}
              className={`flex cursor-pointer flex-col rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${
                accountType === value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <input type="radio" value={value} {...register("accountType")} className="sr-only" />
              <span className="text-sm font-semibold text-slate-900">{label}</span>
              <span className="text-xs text-slate-500">{hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ── Name ── the same order as the profile page, so a profile looks
          the same the day it is made as when it is edited (Kyle, Video 3). */}
      <FormSection icon={User} title="Name">
        <div className="grid grid-cols-[110px_1fr_1fr] gap-3">
          <F label="Salutation">
            <select {...register("salutation")} className={SELECT_CLS}>
              <option value="">—</option>
              {["Mr.", "Mrs.", "Ms.", "Dr.", "Prof."].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </F>
          <F label="First Name" required error={errors.firstName?.message}>
            <input {...register("firstName")} placeholder="John" className={INPUT_CLS} />
          </F>
          <F label="Last Name" required error={errors.lastName?.message}>
            <input {...register("lastName")} placeholder="Doe" className={INPUT_CLS} />
          </F>
        </div>
        {/* Kyle (Testing Edits, 2026-10-01, #1): a home has no business name, so
            the field is not shown on a residential account at all. */}
        {accountType === "commercial" && (
          <F label="Company / Business Name">
            <input {...register("companyName")} placeholder="Company or business name" className={INPUT_CLS} />
          </F>
        )}
      </FormSection>

      {/* ── Contact information — Kyle's six phones, each saying whose number
          it is, and as many named emails as the family has (Video 2). ───── */}
      <FormSection icon={Phone} title="Contact Information">
        <div className="space-y-2" data-testid="intake-phones">
          {INTAKE_PHONES.map(({ slot, field }) => {
            const value = field ? (phoneValues[field] ?? "") : cell2;
            return (
              <div key={slot} className="grid items-start gap-2 grid-cols-[64px_1fr_1fr]">
                <span className="pt-2 text-xs font-semibold text-slate-500">{slot}</span>
                {field
                  ? <PhoneInput registration={register(field)} label={`${slot} phone`} />
                  : <input type="tel" inputMode="tel" aria-label="Cell 2 phone" placeholder="(555) 555-5555" className={INPUT_CLS}
                      value={cell2} onChange={(event) => setCell2(formatPhoneAsTyped(event.target.value))} />}
                <OwnerSelect label={`Whose ${slot} number`} owner={owners[slot] ?? ACCOUNT_OWNER} people={people}
                  accountName={accountName} disabled={!String(value).trim()}
                  onChange={(owner) => setOwners((current) => ({ ...current, [slot]: owner }))} />
              </div>
            );
          })}
        </div>
        <div className="border-t border-slate-200 pt-3">
          <EmailRows rows={emailRows} people={people} accountName={accountName} error={errors.email?.message} onChange={setEmailRows} />
        </div>
      </FormSection>

      {/* ── Service address — the main one and up to two more, named ─────── */}
      <FormSection icon={MapPin} title="Service Address">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
          <MapPin className="w-3.5 h-3.5" /> Main
        </span>
        <div className="grid gap-2 grid-cols-[2fr_1fr_70px_100px]">
          <input {...register("billingAddress")} aria-label="Street Address" placeholder="Street" className={INPUT_CLS} />
          <input {...register("billingCity")} aria-label="City" placeholder="City" className={INPUT_CLS} />
          <input {...register("billingState")} aria-label="State" placeholder="State" className={INPUT_CLS} />
          <input {...register("billingZip")} aria-label="Zip" placeholder="Zip" className={INPUT_CLS} />
        </div>
        <ExtraLocations rows={extraLocations} onChange={setExtraLocations} />
        {/* Kyle #10: visible, toward the bottom of the information block. */}
        <div className="grid grid-cols-3 gap-3 border-t border-slate-200 pt-3">
          <F label="County">
            <input {...register("county")} placeholder="Buchanan" className={INPUT_CLS} />
          </F>
          <F label="Subdivision">
            <input {...register("subdivision")} placeholder="Subdivision name" className={INPUT_CLS} />
          </F>
          <F label="Birthday">
            <input {...register("birthday")} placeholder="MM/DD" className={INPUT_CLS} />
          </F>
        </div>
        {/* Kyle: "click Facebook. It is that simple." The managed list from Settings. */}
        <F label="How did they hear about us?">
          <select aria-label="How did they hear about us?" value={marketingSource} onChange={(event) => setMarketingSource(event.target.value)} className={SELECT_CLS}>
            <option value="">Not set</option>
            {marketingSources.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </F>
      </FormSection>

      {/* Window & Property Details was removed at Kyle's request (Testing Edits,
          2026-10-01, #3): the business defines its own Custom Fields instead. */}

      {/* ── Notes — internal; Directions is what the crew sees ───────────── */}
      <FormSection icon={StickyNote} title="Notes">
        <div className="grid grid-cols-2 gap-3">
          <F label="General Notes">
            <textarea {...register("notes")} rows={3} placeholder="Anything the office should know…" className={INPUT_CLS + " resize-none"} />
          </F>
          <F label="Directions">
            <textarea {...register("directions")} rows={3} placeholder="Gate, parking, which house… the crew sees this" className={INPUT_CLS + " resize-none"} />
          </F>
        </div>
      </FormSection>

      {/* ── More details — rarely used at intake, kept one click away ─────── */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}
          className="flex w-full items-center justify-between px-4 py-3 text-left">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Info className="w-4 h-4 text-slate-400" /> More details</span>
          <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${moreOpen ? "rotate-90" : ""}`} />
        </button>
        {/* Kept mounted while closed, so nothing typed is dropped from the form. */}
        <div className={`space-y-3 border-t border-slate-200 px-4 py-3 ${moreOpen ? "" : "hidden"}`}>
          {/* Kyle (Testing Edits, 2026-10-01, #4): nobody chooses this. A record
              made from Prospects is a prospect and one made from Customers is a
              customer; the way across is the conversion after an estimate is
              accepted, never a dropdown. The value still travels with the form. */}
          <input type="hidden" {...register("lifecycleStatus")} />
          {/* Customer Since is set by the server on creation or conversion (#4).
              Preferred Contact (#5) and Sending Preferences (#6) were removed at
              Kyle's request; the communication-safety rules behind them are unchanged. */}
          <div className="flex flex-wrap gap-5">
            {[
              { name: "isNonProfit" as const, label: "Non-Profit" },
              { name: "ccFeeExempt" as const, label: "CC Fee Exempt" },
              { name: "taxExempt"   as const, label: "Tax Exempt" },
            ].map(({ name, label }) => (
              <label key={name} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...register(name)} className="w-4 h-4 rounded accent-primary" />
                <span className="text-sm text-slate-700">{label}</span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Tags">
              <input {...register("tags")} placeholder="comma-separated tags" className={INPUT_CLS} />
            </F>
            <F label="Star Rating">
              <select {...register("starRating")} className={SELECT_CLS}>
                <option value="">— None —</option>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}
              </select>
            </F>
            <F label="Alt. Contact Name">
              <input {...register("altContact")} placeholder="Name of alternate contact" className={INPUT_CLS} />
            </F>
            <F label="Alt. Phone Type">
              <input {...register("altPhoneType")} placeholder="e.g. Office" className={INPUT_CLS} />
            </F>
          </div>
        </div>
      </section>

      {!isProspect && canScheduleInitialJob && (
        <FormSection icon={CalendarClock} title="Accepted Initial Job">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeInitialJob}
              onChange={(event) => setIncludeInitialJob(event.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-primary"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">Schedule the accepted first service in this commit</span>
              <span className="block text-xs text-slate-500">Customer, contact, property, ownership, and job are saved together or not at all.</span>
            </span>
          </label>
          {includeInitialJob && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <div className="grid grid-cols-2 gap-3">
                <F label="Accepted Service" required>
                  <select value={initialServiceId} onChange={(event) => setInitialServiceId(event.target.value)} className={SELECT_CLS}>
                    <option value="">Select service…</option>
                    {services.filter((service) => service.isActive !== false).map((service) => (
                      <option key={service.id} value={service.id}>{service.name} · ${Number(service.basePrice ?? 0).toFixed(2)}</option>
                    ))}
                  </select>
                </F>
                <F label="Service Date" required>
                  <input type="date" value={initialDate} onChange={(event) => setInitialDate(event.target.value)} className={INPUT_CLS} />
                </F>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <F label="Start Time" required>
                  <TimeSelect value={initialStart} onChange={setInitialStart} className={INPUT_CLS} />
                </F>
                <F label="End Time" required>
                  <TimeSelect value={initialEnd} onChange={setInitialEnd} className={INPUT_CLS} />
                </F>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <F label="Crew" required>
                  <select
                    value={initialCrewId}
                    onChange={(event) => setInitialCrewId(event.target.value)}
                    className={SELECT_CLS}
                  >
                    <option value="">Select crew…</option>
                    {crews.filter((crew) => crew.isActive !== false).map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
                  </select>
                </F>
                <F label="Assigned Team Members" required>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 space-y-1">
                    {activeTeamUsersLoading ? <p className="text-xs text-slate-400">Loading team…</p> : activeTeamUsers.length === 0 ? (
                      <p className="text-xs text-red-600">No active team members are available.</p>
                    ) : activeTeamUsers.map((user) => {
                      return (
                        <label key={user.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={initialEmployeeIds.includes(user.id)}
                            onChange={(event) => setInitialEmployeeIds((current) => event.target.checked
                              ? [...new Set([...current, user.id])]
                              : current.filter((id) => id !== user.id))}
                            className="accent-primary"
                          />
                          <span className="text-xs text-slate-700">{user.displayName}</span>
                        </label>
                      );
                    })}
                  </div>
                </F>
              </div>
              <p className="text-xs text-slate-500">Crew and employee assignment are explicit and independent because legacy crew member text is not a reliable user identity mapping. Both are captured in the accepted snapshot.</p>
              {initialJobError && <p className="text-xs font-medium text-red-600" role="alert">{initialJobError}</p>}
            </div>
          )}
        </FormSection>
      )}

      {canScheduleEstimate && (
        <FormSection icon={CalendarClock} title="Estimate">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              aria-label="Book an estimate now"
              checked={scheduleEstimateNext}
              onChange={(event) => setScheduleEstimateNext(event.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-primary"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">Book an estimate now</span>
              <span className="block text-xs text-slate-500">Saved with the prospect, or not at all. Leave a price blank for the estimator to quote on site.</span>
            </span>
          </label>
          {scheduleEstimateNext && (
            <IntakeEstimate
              lines={estimateLines}
              onLines={setEstimateLines}
              appointment={estimateAppointment}
              onAppointment={setEstimateAppointment}
              services={services}
              estimators={estimators}
              canSchedule={canBookEstimateTime}
              locations={[
                { index: 0, label: watch("billingAddress")?.trim() ? `Main — ${watch("billingAddress")}` : "Main address" },
                ...extraLocations
                  .filter((row) => [row.address, row.city, row.state, row.zip].some((part) => part.trim()))
                  .map((row, index) => ({ index: index + 1, label: row.name.trim() || `Location ${index + 2}` })),
              ]}
            />
          )}
        </FormSection>
      )}

      <DuplicateReviewPanel
        state={duplicateState}
        candidates={duplicateCandidates}
        decision={duplicateDecision}
        selectedId={selectedDuplicateId}
        reason={duplicateReason}
        error={duplicateError}
        onDecision={setDuplicateDecision}
        onSelect={setSelectedDuplicateId}
        onReason={setDuplicateReason}
        onOpen={(id) => navigate(`/customers/${id}`)}
      />

      {intakeErrors.length > 0 && (
        <div role="alert" data-testid="intake-problems" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 space-y-0.5">
          {intakeErrors.map((problem) => <p key={problem}>{problem}</p>)}
        </div>
      )}

      <div className="pt-2 pb-1 space-y-2">
        <button
          type="submit"
          onClick={() => { sendEstimateRef.current = false; }}
          disabled={shouldDisableCustomerCreate(isCreatePending, duplicateState, duplicateDecision, duplicateReason)}
          className="w-full h-11 rounded-xl bg-primary text-white text-sm font-bold
                     shadow-sm shadow-primary/20 hover:bg-primary/90 active:scale-[.98] transition-all disabled:opacity-60"
        >
          {isCreatePending
            ? "Saving…"
            : includeInitialJob && !isProspect
              ? "Create Customer & Schedule Job"
              : canScheduleEstimate && scheduleEstimateNext
                ? "Create Prospect & Save Estimate"
                : `Create ${entityLabel}`}
        </button>
        {/* Kyle, Video 3: when the price was given on the phone, send it now.
            Never with a service still to be quoted (lib/estimate-pricing on the server). */}
        {canScheduleEstimate && scheduleEstimateNext && canEmailEstimate && (() => {
          const blocker = emailBlocker(estimateLines, firstEmail);
          return (
            <div>
              <button
                type="submit"
                data-testid="save-and-email-estimate"
                onClick={() => { sendEstimateRef.current = true; }}
                disabled={Boolean(blocker) || shouldDisableCustomerCreate(isCreatePending, duplicateState, duplicateDecision, duplicateReason)}
                className="w-full h-10 rounded-xl border border-primary/40 bg-white text-primary text-sm font-bold hover:bg-primary/5 transition-all disabled:opacity-50"
              >
                Save and email estimate
              </button>
              {blocker && <p className="mt-1 text-center text-[11px] text-slate-400" data-testid="email-blocker">{blocker}</p>}
            </div>
          );
        })()}
      </div>
    </form>
  );
}

function DuplicateReviewPanel({
  state,
  candidates,
  decision,
  selectedId,
  reason,
  error,
  onDecision,
  onSelect,
  onReason,
  onOpen,
}: {
  state: "idle" | "checking" | "none" | "candidates" | "error";
  candidates: any[];
  decision: "existing" | "separate" | null;
  selectedId: number | null;
  reason: string;
  error: string;
  onDecision: (value: "existing" | "separate" | null) => void;
  onSelect: (value: number | null) => void;
  onReason: (value: string) => void;
  onOpen: (id: number) => void;
}) {
  if (state === "idle" || state === "none") return null;
  if (state === "checking") {
    return <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600" role="status">Checking for strong email or phone matches…</div>;
  }
  if (state === "error") {
    return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>;
  }
  return (
    <fieldset className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
      <legend className="px-1 text-sm font-bold text-amber-950">Possible existing account</legend>
      <p className="text-xs leading-5 text-amber-900">
        We found {candidates.length} strong contact match{candidates.length === 1 ? "" : "es"}.
        Names, addresses, and company names are not used as duplicate keys.
      </p>
      <div className="space-y-2">
        {candidates.map((candidate) => (
          <label key={candidate.id} className={`flex items-start gap-3 rounded-lg border bg-white px-3 py-2 ${candidate.canLink ? "border-amber-200 cursor-pointer" : "border-slate-200 opacity-70"}`}>
            <input
              type="radio"
              name="duplicate-account"
              value={candidate.id}
              disabled={!candidate.canLink}
              checked={decision === "existing" && selectedId === candidate.id}
              onChange={() => { onSelect(candidate.id); onDecision("existing"); }}
              className="mt-1 accent-primary"
            />
            <span className="min-w-0 flex-1 text-sm text-slate-800">
              <span className="font-semibold">{candidate.firstName} {candidate.lastName}</span>
              {candidate.companyName ? <span className="text-slate-500"> · {candidate.companyName}</span> : null}
              <span className="block text-xs text-slate-500">
                {candidate.matchTypes.join(" + ")} match · {candidate.lifecycleStatus}
                {!candidate.canLink ? " · cannot receive new links" : ""}
              </span>
            </span>
            {candidate.canLink ? (
              <button type="button" onClick={() => onOpen(candidate.id)} className="text-xs font-semibold text-primary hover:underline">
                Open
              </button>
            ) : null}
          </label>
        ))}
        <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 cursor-pointer">
          <input
            type="radio"
            name="duplicate-account"
            value="separate"
            checked={decision === "separate"}
            onChange={() => onDecision("separate")}
            className="mt-1 accent-primary"
          />
          <span className="text-sm text-slate-800">
            <span className="font-semibold">Create a separate account</span>
            <span className="block text-xs text-slate-500">This requires a short reason and is recorded for audit.</span>
          </span>
        </label>
      </div>
      {decision === "separate" ? (
        <textarea
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Why is this intentionally a separate account?"
          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          aria-label="Reason for creating a separate account"
        />
      ) : null}
      {error ? <p className="text-xs font-medium text-red-700" role="alert">{error}</p> : null}
    </fieldset>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Customers({ mode = "customers" }: { mode?: "customers" | "prospects" }) {
  const [, navigate] = useLocation();
  const urlSearch = useSearch();
  const { user } = useAuth();
  const isProspect = mode === "prospects";
  const entityLabel = isProspect ? "Prospect" : "Customer";
  const entityLabelPlural = isProspect ? "Prospects" : "Customers";
  const canManage = hasClientCapability(user, isProspect ? "leads.manage" : "customers.manage");
  const emptyStateDescription = getCustomersEmptyStateDescription(user);

  const initialQ = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("q") ?? ""
    : "";

  const [search, setSearch] = useState(initialQ);
  const [debouncedSearch, setDebouncedSearch] = useState(initialQ);
  const [page, setPage] = useState(1);
  const [accountType, setAccountType] = useState("");
  const [customField, setCustomField] = useState<CustomFieldFilterState>(NO_CUSTOM_FIELD_FILTER);
  // Kyle (2026-10-24): prospects and customers are separate lists, and a
  // deactivated profile is out of its list until asked for.
  const lifecycleStatus = isProspect ? "prospect" : "customer";
  const [includeDeactivated, setIncludeDeactivated] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // A header search can change q while this route stays mounted.
  useEffect(() => {
    const nextQuery = typeof window !== "undefined"
      ? new URLSearchParams(urlSearch).get("q") ?? ""
      : "";
    setSearch(nextQuery);
    setDebouncedSearch(nextQuery);
    setPage(1);
  }, [urlSearch]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
      if (typeof window !== "undefined") {
        const nextLocation = customerListSearchLocation(
          window.location.pathname,
          urlSearch,
          search,
        );
        const currentLocation = `${window.location.pathname}${window.location.search}`;
        if (nextLocation !== currentLocation) {
          navigate(nextLocation, { replace: true });
        }
      }
    }, 300);
    return () => clearTimeout(t);
  }, [navigate, search, urlSearch]);

  const { data, isLoading } = useCustomers(debouncedSearch, page, accountType, lifecycleStatus, mode, includeDeactivated, customField);

  const customers  = data?.customers ?? [];
  const total      = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <Layout>

      {/* ─── Page header ─────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{entityLabelPlural}</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {total > 0
              ? `${total.toLocaleString()} ${entityLabelPlural.toLowerCase()}`
              : isProspect ? "Manage prospective client profiles" : "Manage your client base"}
          </p>
        </div>
        {canManage && <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-white text-sm font-bold
                     shadow-sm shadow-primary/20 hover:bg-primary/90 active:scale-[.98] transition-all"
        >
          <Plus className="w-4 h-4" /> New {entityLabel}
        </button>}
      </div>

      {/* ─── Search ──────────────────────────────────── */}
      <div className="relative mb-3">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
        <input
          type="search"
          aria-label="Search profiles"
          placeholder="Search by name, company, city, email, phone, or a custom field…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full h-10 pl-10 pr-4 text-sm rounded-xl border border-slate-200 bg-white text-slate-900
                     placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        />
      </div>

      {/* ─── Lifecycle and account type filters ───────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { label: "All Account Types", value: "" },
          { label: "Residential",   value: "residential" },
          { label: "Commercial",    value: "commercial" },
        ].map(opt => (
          <button
            key={opt.value}
            onClick={() => { setAccountType(opt.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              accountType === opt.value
                ? "bg-primary text-white border-primary"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="w-px bg-slate-200 mx-1 self-stretch" />
        <label className="inline-flex items-center gap-2 px-2 text-xs font-semibold text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            data-testid="include-deactivated"
            checked={includeDeactivated}
            onChange={(event) => { setIncludeDeactivated(event.target.checked); setPage(1); }}
            className="w-4 h-4 rounded accent-primary"
          />
          Include deactivated profiles
        </label>
      </div>

      {/* Kyle #3: find a profile by what is in one of its custom fields. */}
      <CustomFieldFilter
        state={customField}
        onChange={(next) => { setCustomField(next); setPage(1); }}
      />

      {/* ─── Customer list ────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-2.5">
          {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : customers.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-2xl border border-dashed border-slate-200">
          <Users className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-600 font-bold mb-1">
            {search ? `No ${entityLabelPlural.toLowerCase()} match your search` : `No ${entityLabelPlural.toLowerCase()} yet`}
          </p>
          <p className="text-slate-400 text-sm mb-4">
            {search
              ? "Try a different name, email, city, or phone number."
              : isProspect
                ? `Add your first ${entityLabel.toLowerCase()} to get started.`
                : emptyStateDescription}
          </p>
          {search ? (
            <button
              onClick={() => {
                setSearch("");
                setDebouncedSearch("");
                const pathname = typeof window !== "undefined" ? window.location.pathname : `/${mode}`;
                navigate(customerListSearchLocation(pathname, urlSearch, ""), { replace: true });
              }}
              className="px-4 py-2 text-sm font-semibold text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
            >
              Clear search
            </button>
          ) : canManage ? (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add {entityLabel}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              onView={() => navigate(`/${mode}/${customer.id}`)}
            />
          ))}
        </div>
      )}

      {/* ─── Pagination ───────────────────────────────── */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-600
                       border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <span className="text-xs text-slate-400">
            Page {page} of {totalPages} &nbsp;·&nbsp; {total.toLocaleString()} customers
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-600
                       border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ─── Footer count (no pagination) ────────────── */}
      {!isLoading && customers.length > 0 && totalPages <= 1 && (
        <p className="text-center text-xs text-slate-400 mt-5">
          {total} {entityLabel.toLowerCase()}{total !== 1 ? "s" : ""}
          {debouncedSearch ? ` matching "${debouncedSearch}"` : ""}
        </p>
      )}

      {/* ─── New account dialog ───────────────────────── */}
      {canManage && <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-3xl rounded-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">New {entityLabel}</DialogTitle>
          </DialogHeader>
          <NewCustomerForm mode={mode} onSuccess={() => setIsCreateOpen(false)} />
        </DialogContent>
      </Dialog>}
    </Layout>
  );
}
