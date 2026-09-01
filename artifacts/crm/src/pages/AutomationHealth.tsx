import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  Code2,
  Inbox,
  Info,
  Layers3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TimerReset,
  XCircle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAutomationEventAttemptQueryKey,
  getGetAutomationEventQueryKey,
  getListAutomationEventDeliveryAttemptsQueryKey,
  getListAutomationEventsQueryKey,
  useGetAutomationEvent,
  useGetAutomationEventAttempt,
  useGetFinancialCapabilities,
  useListAutomationEventDeliveryAttempts,
  useListAutomationEvents,
  useRetryAutomationEvent,
  type AutomationEvent,
  type AutomationEventAttempt,
  type AutomationEventDelivery,
  type AutomationEventListResponse,
  type ListAutomationEventsParams,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/Layout";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { AUTOMATION_ROUTES } from "@/lib/automation-routes";
import { useToast } from "@/hooks/use-toast";

const STATUS_CONFIG: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  completed: { label: "Completed", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  succeeded: { label: "Succeeded", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  pending: { label: "Pending", tone: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock3 },
  processing: { label: "Processing", tone: "bg-sky-50 text-sky-700 border-sky-200", icon: Loader2 },
  retrying: { label: "Retrying", tone: "bg-amber-50 text-amber-700 border-amber-200", icon: TimerReset },
  failed: { label: "Failed", tone: "bg-rose-50 text-rose-700 border-rose-200", icon: XCircle },
  dead_letter: { label: "Dead letter", tone: "bg-rose-50 text-rose-700 border-rose-200", icon: AlertTriangle },
  disabled: { label: "Disabled", tone: "bg-slate-100 text-slate-600 border-slate-200", icon: CircleDashed },
  skipped: { label: "Skipped", tone: "bg-slate-100 text-slate-600 border-slate-200", icon: CircleDashed },
};

function statusConfig(status?: string | null) {
  return STATUS_CONFIG[status ?? ""] ?? {
    label: status?.replace(/_/g, " ") || "Unknown",
    tone: "bg-slate-100 text-slate-600 border-slate-200",
    icon: Info,
  };
}

function safeDate(value?: string | null, fallback = "Not recorded") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : format(date, "MMM d, yyyy · h:mm a");
}

function relativeDate(value?: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not scheduled" : formatDistanceToNow(date, { addSuffix: true });
}

function eventTypeLabel(value: string) {
  return value.replace(/[._-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function errorMessage(error: unknown) {
  const responseError = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return responseError ?? (error instanceof Error ? error.message : "The automation action could not be completed.");
}

function payloadValue(value: unknown): string {
  if (value === null || value === undefined) return "Not provided";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return `${Object.keys(value as Record<string, unknown>).length} fields`;
  return "Present";
}

function eventExplanation(event: AutomationEvent) {
  if (event.status === "dead_letter") {
    return "This event reached its retry limit and is parked in dead-letter state. Review the attempts before requeueing one delivery.";
  }
  if (event.status === "disabled" || event.resultCode === "no_active_automation") {
    return "Processing is paused because the matching automation rule is disabled or missing.";
  }
  if (event.nextRetryAt) {
    return `A retry is scheduled ${relativeDate(event.nextRetryAt)}.`;
  }
  if (event.lastError) {
    return `Last error: ${event.lastError}`;
  }
  return null;
}

function StatusBadge({ status }: { status?: string | null }) {
  const config = statusConfig(status);
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${config.tone}`}>
      <Icon className={`h-3.5 w-3.5 ${status === "processing" ? "animate-spin" : ""}`} />
      {config.label}
    </Badge>
  );
}

function SectionLabel({ children, detail }: { children: ReactNode; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{children}</h2>
      {detail && <span className="text-[11px] text-slate-400">{detail}</span>}
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  note: string;
  tone: string;
  icon: typeof Activity;
}) {
  return (
    <Card className="border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(20,42,54,0.03)]">
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
          <p className={`mt-2 font-display text-2xl font-bold tracking-tight ${tone}`}>{value}</p>
          <p className="mt-1 text-xs text-slate-500">{note}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5 text-slate-500">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function EventRow({
  event,
  selected,
  onSelect,
}: {
  event: AutomationEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const isAttention = ["failed", "dead_letter", "disabled"].includes(event.status);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full border-b border-slate-100 px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-[#f3f8f8] ${
        selected ? "bg-[#edf6f6] shadow-[inset_3px_0_0_hsl(199_67%_34%)]" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isAttention ? "bg-rose-50 text-rose-600" : "bg-sky-50 text-sky-700"}`}>
          {isAttention ? <AlertTriangle className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-mono text-xs font-semibold text-slate-800">{event.eventNumber}</p>
            <StatusBadge status={event.status} />
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-slate-700">{eventTypeLabel(event.eventType)}</p>
          <p className="mt-1 truncate text-xs text-slate-400">
            {event.aggregateType} #{event.aggregateId} <span className="mx-1 text-slate-300">·</span> {event.source}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] text-slate-400">{relativeDate(event.occurredAt ?? event.createdAt)}</span>
          <ChevronRight className={`h-4 w-4 text-slate-300 transition-transform ${selected ? "translate-x-0.5 text-primary" : "group-hover:translate-x-0.5"}`} />
        </div>
      </div>
    </button>
  );
}

function DeliveryRow({
  delivery,
  selected,
  onSelect,
  onRetry,
  canRetry,
  retrying,
}: {
  delivery: AutomationEventDelivery;
  selected: boolean;
  onSelect: () => void;
  onRetry: () => void;
  canRetry: boolean;
  retrying: boolean;
}) {
  const retryable = ["retrying", "failed", "dead_letter"].includes(delivery.status);
  return (
    <div className={`rounded-xl border p-3 transition-colors ${selected ? "border-primary/30 bg-[#f2f8f8]" : "border-slate-200 bg-white"}`}>
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-3 text-left">
        <div className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-600"><Inbox className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-mono text-xs font-semibold text-slate-800">{delivery.consumerKey}</p>
            <StatusBadge status={delivery.status} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {delivery.attemptCount} attempt{delivery.attemptCount === 1 ? "" : "s"}
            {delivery.outcome ? ` · ${delivery.outcome}` : ""}
          </p>
          {delivery.lastError && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-rose-600">{delivery.lastError}</p>}
          {delivery.status === "dead_letter" && !delivery.lastError && <p className="mt-2 text-xs leading-relaxed text-rose-600">Retry limit reached; this delivery is parked until manually requeued.</p>}
           {(delivery.status === "disabled" || delivery.outcome === "no_active_automation") && <p className="mt-2 text-xs leading-relaxed text-slate-500">The matching automation rule is disabled or missing.</p>}
        </div>
        <ChevronRight className={`h-4 w-4 shrink-0 text-slate-300 ${selected ? "text-primary" : ""}`} />
      </button>
      {retryable && canRetry && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-200/80 pt-2.5">
          <span className="text-[11px] text-slate-400">{delivery.nextRetryAt ? `Next retry ${relativeDate(delivery.nextRetryAt)}` : "Eligible for manual requeue"}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-lg border-rose-200 px-2.5 text-[11px] text-rose-700 hover:bg-rose-50"
            disabled={retrying}
            onClick={onRetry}
          >
            {retrying ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1.5 h-3 w-3" />}
            Requeue delivery
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AutomationHealth() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const capabilityQuery = useGetFinancialCapabilities();
  const capabilities = capabilityQuery.data?.capabilities as readonly string[] | undefined;
  const canView = capabilities?.includes("automation_events.view") ?? false;
  const canRetry = capabilities?.includes("automation_events.manage") ?? false;
  const [filters, setFilters] = useState({ search: "", status: "", eventType: "", aggregateType: "", from: "", to: "" });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<number | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<number | null>(null);
  const [pendingRetry, setPendingRetry] = useState<{ eventId: number; deliveryId: number } | null>(null);
  const [retryKey, setRetryKey] = useState("");
  const submittedRetryKey = useRef<string | null>(null);

  const listParams = useMemo<ListAutomationEventsParams>(() => ({
    page: 1,
    pageSize: 30,
    search: filters.search || undefined,
    status: filters.status || undefined,
    eventType: filters.eventType || undefined,
    aggregateType: filters.aggregateType || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  }), [filters]);
  const eventList = useListAutomationEvents(listParams, {
    query: { enabled: canView, queryKey: getListAutomationEventsQueryKey(listParams) },
  });
  const detailQuery = useGetAutomationEvent(selectedId ?? 0, {
    query: { enabled: canView && selectedId !== null, queryKey: getGetAutomationEventQueryKey(selectedId ?? 0) },
  });
  const attemptsQuery = useListAutomationEventDeliveryAttempts(selectedId ?? 0, selectedDeliveryId ?? 0);
  const attemptQuery = useGetAutomationEventAttempt(selectedAttemptId ?? 0, {
    query: { enabled: selectedAttemptId !== null, queryKey: getGetAutomationEventAttemptQueryKey(selectedAttemptId ?? 0) },
  });

  const retryMutation = useRetryAutomationEvent({
    request: idempotencyRequest(retryKey || "pending-retry"),
    mutation: {
      onSuccess: () => {
        if (pendingRetry) {
          queryClient.invalidateQueries({ queryKey: getListAutomationEventsQueryKey(listParams) });
          queryClient.invalidateQueries({ queryKey: getGetAutomationEventQueryKey(pendingRetry.eventId) });
          queryClient.invalidateQueries({ queryKey: getListAutomationEventDeliveryAttemptsQueryKey(pendingRetry.eventId, pendingRetry.deliveryId) });
          if (selectedAttemptId !== null) {
            queryClient.invalidateQueries({ queryKey: getGetAutomationEventAttemptQueryKey(selectedAttemptId) });
          }
        }
        toast({ title: "Delivery requeued", description: "One delivery was placed back in the automation queue." });
        submittedRetryKey.current = null;
        setPendingRetry(null);
        setRetryKey("");
      },
      onError: (error) => {
        toast({ title: "Requeue failed", description: errorMessage(error), variant: "destructive" });
        submittedRetryKey.current = null;
        setPendingRetry(null);
        setRetryKey("");
      },
    },
  });
  const retryMutateRef = useRef(retryMutation.mutate);
  retryMutateRef.current = retryMutation.mutate;

  useEffect(() => {
    if (!pendingRetry || !retryKey || submittedRetryKey.current === retryKey) return;
    submittedRetryKey.current = retryKey;
    retryMutateRef.current({ id: pendingRetry.eventId, data: { deliveryId: pendingRetry.deliveryId } });
  }, [pendingRetry, retryKey]);

  const response = eventList.data as AutomationEventListResponse | undefined;
  const events = response?.data ?? [];
  const counts = response?.counts ?? {};
  const selectedDetail = detailQuery.data;
  const deliveries = selectedDetail?.deliveries ?? [];
  const selectedDelivery = deliveries.find((delivery) => delivery.id === selectedDeliveryId) ?? deliveries[0];
  const visibleAttempts = attemptsQuery.data?.attempts ?? selectedDetail?.attempts?.filter((attempt) => attempt.deliveryId === selectedDelivery?.id) ?? [];
  const selectedAttempt = attemptQuery.data;

  useEffect(() => {
    if (!selectedId && events[0]) setSelectedId(events[0].id);
  }, [events, selectedId]);

  useEffect(() => {
    if (selectedDetail?.deliveries?.length) {
      const firstDelivery = selectedDetail.deliveries[0];
      setSelectedDeliveryId((current) => current && selectedDetail.deliveries.some((delivery) => delivery.id === current) ? current : firstDelivery.id);
    } else {
      setSelectedDeliveryId(null);
    }
    setSelectedAttemptId(null);
  }, [selectedDetail]);

  const submitFilters = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draftFilters);
  };

  const clearFilters = () => {
    const cleared = { search: "", status: "", eventType: "", aggregateType: "", from: "", to: "" };
    setDraftFilters(cleared);
    setFilters(cleared);
  };

  const handleSelectEvent = (id: number) => {
    setSelectedId(id);
    setSelectedDeliveryId(null);
    setSelectedAttemptId(null);
  };

  const requestRetry = (eventId: number, deliveryId: number) => {
    const confirmed = window.confirm("Requeue this one delivery? This will create a new processing attempt for the selected consumer. Continue only if the underlying issue is understood.");
    if (!confirmed) return;
    setRetryKey(createIdempotencyKey());
    setPendingRetry({ eventId, deliveryId });
  };

  if (capabilityQuery.isLoading) {
    return <Layout><div className="space-y-5"><div className="h-9 w-64 animate-pulse rounded-lg bg-slate-200" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-white" />)}</div><div className="h-96 animate-pulse rounded-2xl bg-white" /></div></Layout>;
  }

  if (!canView) {
    return (
      <Layout>
        <div className="mx-auto flex min-h-[55vh] max-w-lg items-center justify-center">
          <Card className="w-full border-slate-200 bg-white shadow-sm">
            <CardContent className="flex flex-col items-center px-8 py-12 text-center">
              <div className="rounded-2xl bg-amber-50 p-4 text-amber-700"><ShieldCheck className="h-8 w-8" /></div>
              <h1 className="mt-5 font-display text-xl font-bold text-slate-900">Automation health is restricted</h1>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">Your account does not have the automation event visibility capability. Ask an administrator to grant <span className="font-mono text-xs text-slate-700">automation_events.view</span>.</p>
              <Button variant="outline" className="mt-6 rounded-xl" onClick={() => navigate(AUTOMATION_ROUTES.index)}>Back to Automations</Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
              <Activity className="h-4 w-4" />
              <span>Operations cockpit</span>
              <span className="text-slate-300">/</span>
              <button type="button" onClick={() => navigate(AUTOMATION_ROUTES.index)} className="text-slate-400 hover:text-primary">Automations</button>
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">Automation health</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">A calm view of business events moving through Superior. Investigate safely, then requeue one delivery when the path is clear.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-slate-400 sm:block">Event stream · {response?.total ?? 0} total</span>
            <Button variant="outline" className="rounded-xl border-slate-200 bg-white" onClick={() => eventList.refetch()} disabled={eventList.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${eventList.isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="All events" value={response?.total ?? 0} note="In the current stream" tone="text-slate-900" icon={Layers3} />
          <StatCard label="Completed" value={counts.completed ?? counts.succeeded ?? 0} note="Processed without issue" tone="text-emerald-700" icon={CheckCircle2} />
           <StatCard label="Needs attention" value={(counts.retrying ?? 0) + (counts.failed ?? 0) + (counts.dead_letter ?? 0)} note="Retrying or dead-lettered" tone="text-rose-700" icon={AlertTriangle} />
          <StatCard label="Waiting" value={(counts.pending ?? 0) + (counts.processing ?? 0)} note="Pending or in flight" tone="text-amber-700" icon={TimerReset} />
        </div>

        <Card className="border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(20,42,54,0.03)]">
          <CardContent className="p-4">
            <form onSubmit={submitFilters} className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={draftFilters.search} onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search event number, aggregate, or correlation key" className="h-10 border-slate-200 pl-9 text-sm" />
                </div>
                <select value={draftFilters.status} onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">All statuses</option>
                  {Object.entries(STATUS_CONFIG).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
                </select>
                <select value={draftFilters.aggregateType} onChange={(event) => setDraftFilters((current) => ({ ...current, aggregateType: event.target.value }))} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">All aggregates</option>
                  <option value="job">Job</option><option value="invoice">Invoice</option><option value="customer">Customer</option><option value="quote">Quote</option>
                </select>
                <Input value={draftFilters.eventType} onChange={(event) => setDraftFilters((current) => ({ ...current, eventType: event.target.value }))} placeholder="Event type" className="h-10 w-36 text-sm" />
                <Button type="submit" className="h-10 rounded-lg px-4"><SlidersHorizontal className="mr-2 h-4 w-4" /> Apply</Button>
                {(Object.values(filters).some(Boolean)) && <Button type="button" variant="ghost" className="h-10 text-slate-500" onClick={clearFilters}>Clear</Button>}
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Occurred between</span>
                <Input type="date" value={draftFilters.from} onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))} className="h-8 w-auto text-xs text-slate-600" />
                <span className="text-xs text-slate-300">and</span>
                <Input type="date" value={draftFilters.to} onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))} className="h-8 w-auto text-xs text-slate-600" />
                <span className="ml-auto text-xs text-slate-400">{events.length} shown</span>
              </div>
            </form>
          </CardContent>
        </Card>

        {eventList.isError ? (
          <Card className="border-rose-200 bg-rose-50/50"><CardContent className="flex flex-col items-center px-6 py-12 text-center"><AlertCircle className="h-8 w-8 text-rose-600" /><h2 className="mt-3 font-semibold text-slate-800">The event stream is unavailable</h2><p className="mt-1 text-sm text-slate-500">We could not load automation health right now.</p><Button variant="outline" className="mt-5 rounded-lg bg-white" onClick={() => eventList.refetch()}>Try again</Button></CardContent></Card>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(340px,0.9fr)_minmax(480px,1.35fr)]">
            <Card className="min-w-0 overflow-hidden border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(20,42,54,0.03)]">
              <CardHeader className="border-b border-slate-100 px-4 py-4"><SectionLabel detail={eventList.isFetching ? "Refreshing…" : `${events.length} results`}>Event stream</SectionLabel></CardHeader>
              {eventList.isLoading ? <div className="space-y-3 p-4">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div> : events.length === 0 ? <CardContent className="flex flex-col items-center px-6 py-16 text-center"><Inbox className="h-9 w-9 text-slate-300" /><h3 className="mt-3 font-semibold text-slate-700">No events match these filters</h3><p className="mt-1 max-w-xs text-sm text-slate-400">Try clearing a filter or widening the date range. The event stream itself is healthy.</p><Button variant="outline" className="mt-5 rounded-lg" onClick={clearFilters}>Clear filters</Button></CardContent> : <div>{events.map((event) => <EventRow key={event.id} event={event} selected={selectedId === event.id} onSelect={() => handleSelectEvent(event.id)} />)}</div>}
            </Card>

            <Card className="min-w-0 border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(20,42,54,0.03)]">
              <CardHeader className="border-b border-slate-100 px-5 py-4"><SectionLabel detail={selectedDetail ? `Event #${selectedDetail.event.id}` : undefined}>Event detail</SectionLabel></CardHeader>
              {!selectedId ? <CardContent className="flex min-h-[460px] flex-col items-center justify-center text-center"><ArrowDownToLine className="h-8 w-8 text-slate-300" /><h3 className="mt-3 font-semibold text-slate-700">Select an event to inspect</h3><p className="mt-1 max-w-xs text-sm text-slate-400">Delivery status, safe payload fields, and consumer attempts will appear here.</p></CardContent> : detailQuery.isLoading ? <div className="space-y-4 p-5"><div className="h-24 animate-pulse rounded-xl bg-slate-100" /><div className="h-36 animate-pulse rounded-xl bg-slate-100" /><div className="h-48 animate-pulse rounded-xl bg-slate-100" /></div> : detailQuery.isError || !selectedDetail ? <CardContent className="flex min-h-[460px] flex-col items-center justify-center text-center"><AlertCircle className="h-8 w-8 text-rose-500" /><h3 className="mt-3 font-semibold text-slate-700">Event detail could not be loaded</h3><Button variant="outline" className="mt-4 rounded-lg" onClick={() => detailQuery.refetch()}>Try again</Button></CardContent> : (
                <CardContent className="space-y-5 p-5">
                  <div className="rounded-xl border border-slate-200 bg-[#f8fbfb] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><p className="font-mono text-xs font-semibold text-slate-500">{selectedDetail.event.eventNumber}</p><h2 className="mt-1 font-display text-lg font-bold text-slate-900">{eventTypeLabel(selectedDetail.event.eventType)}</h2></div>
                      <StatusBadge status={selectedDetail.event.status} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
                      <div><p className="text-slate-400">Aggregate</p><p className="mt-1 font-medium text-slate-700">{selectedDetail.event.aggregateType} #{selectedDetail.event.aggregateId}</p></div>
                      <div><p className="text-slate-400">Occurred</p><p className="mt-1 font-medium text-slate-700">{safeDate(selectedDetail.event.occurredAt)}</p></div>
                      <div><p className="text-slate-400">Attempts</p><p className="mt-1 font-medium text-slate-700">{selectedDetail.event.attemptCount}</p></div>
                      <div><p className="text-slate-400">Source</p><p className="mt-1 truncate font-medium text-slate-700">{selectedDetail.event.source}</p></div>
                    </div>
                    {eventExplanation(selectedDetail.event) && <div className="mt-4 flex gap-2 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-600"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>{eventExplanation(selectedDetail.event)}</p></div>}
                  </div>

                  <div>
                    <SectionLabel detail={`${deliveries.length} consumer${deliveries.length === 1 ? "" : "s"}`}>Consumer deliveries</SectionLabel>
                    <div className="mt-3 space-y-2">{deliveries.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">No consumer deliveries were recorded for this event.</div> : deliveries.map((delivery) => <DeliveryRow key={delivery.id} delivery={delivery} selected={selectedDelivery?.id === delivery.id} onSelect={() => { setSelectedDeliveryId(delivery.id); setSelectedAttemptId(null); }} onRetry={() => requestRetry(selectedDetail.event.id, delivery.id)} canRetry={canRetry} retrying={retryMutation.isPending && pendingRetry?.deliveryId === delivery.id} />)}</div>
                  </div>

                  {selectedDelivery && (
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2"><div><SectionLabel detail={`Delivery #${selectedDelivery.id}`}>Attempt history</SectionLabel><p className="mt-1 text-xs text-slate-400">{selectedDelivery.consumerKey} · updated {safeDate(selectedDelivery.updatedAt)}</p></div>{attemptsQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-primary" />}</div>
                      <div className="mt-3 divide-y divide-slate-100">{visibleAttempts.length === 0 ? <p className="py-5 text-center text-sm text-slate-400">No attempts have been recorded yet.</p> : visibleAttempts.map((attempt: AutomationEventAttempt) => { const attemptStatus = statusConfig(attempt.status); return <button type="button" key={attempt.id} onClick={() => setSelectedAttemptId(attempt.id)} className={`flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50 ${selectedAttemptId === attempt.id ? "rounded-lg bg-slate-50 px-2" : ""}`}><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 font-mono text-[11px] font-bold text-slate-600">#{attempt.attemptNumber}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-700">{attemptStatus.label}</span><span className="text-[11px] text-slate-400">{safeDate(attempt.startedAt)}</span></span>{attempt.error && <span className="mt-1 block truncate text-xs text-rose-600">{attempt.error}</span>}</span><ChevronRight className="h-4 w-4 text-slate-300" /></button>; })}</div>
                      {selectedAttempt && <div className="mt-3 rounded-lg bg-[#f8fbfb] p-3 text-xs"><div className="flex items-center gap-2 font-semibold text-slate-700"><Code2 className="h-3.5 w-3.5 text-primary" /> Attempt #{selectedAttempt.attemptNumber} detail</div><div className="mt-2 grid grid-cols-2 gap-2 text-slate-500"><span>Started {safeDate(selectedAttempt.startedAt)}</span><span>Finished {safeDate(selectedAttempt.finishedAt)}</span><span>Status {statusConfig(selectedAttempt.status).label}</span><span>Retry after {selectedAttempt.retryAfterSeconds ? `${selectedAttempt.retryAfterSeconds}s` : "Not set"}</span></div>{selectedAttempt.error && <p className="mt-2 border-t border-slate-200 pt-2 leading-relaxed text-rose-700">{selectedAttempt.error}</p>}</div>}
                    </div>
                  )}

                  <div>
                    <SectionLabel>Safe event summary</SectionLabel>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(selectedDetail.event.payloadSummary ?? {}).length === 0 ? <div className="col-span-full rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">No safe payload fields were provided.</div> : Object.entries(selectedDetail.event.payloadSummary ?? {}).map(([key, value]) => <div key={key} className="rounded-lg bg-slate-50 px-3 py-2.5"><p className="truncate text-[11px] font-semibold text-slate-400">{eventTypeLabel(key)}</p><p className="mt-1 truncate text-xs font-medium text-slate-700">{payloadValue(value)}</p></div>)}</div>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}