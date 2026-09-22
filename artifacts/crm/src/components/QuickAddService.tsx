import { useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { getListServicesQueryKey, useCreateService, type Service } from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasClientCapability } from "@/lib/rbac";
import {
  canSubmitService, emptyServiceDraft, isServiceCategory, isServicePricingType,
  newServiceIdempotencyKey, serviceDraftToBody, serviceIdempotencyHeaders,
  SERVICE_CATEGORIES, SERVICE_PRICING, type ServiceDraft,
} from "@/lib/service-form";

/**
 * Adds a service to the company-wide Service Catalog from wherever a service is
 * being picked — a quote, a job — so it never has to be recreated per customer
 * (Kyle, Prospect Profile Notes #22).
 *
 * Deliberately not a <form>: it is rendered inside the job form, and forms
 * cannot nest. Enter in any field submits it.
 */
export function QuickAddService({
  initialName = "",
  onCreated,
  onCancel,
}: {
  initialName?: string;
  onCreated: (service: Service) => void;
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ServiceDraft>(() => ({ ...emptyServiceDraft(), name: initialName }));
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newServiceIdempotencyKey);

  const create = useCreateService({
    request: { headers: serviceIdempotencyHeaders(idempotencyKey) },
    mutation: {
      onSuccess: (service) => {
        queryClient.setQueryData<Service[]>(getListServicesQueryKey(), (current) =>
          [...(current ?? []), service].sort((a, b) => a.name.localeCompare(b.name)),
        );
        void queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
        setDraft(emptyServiceDraft());
        setError(null);
        setIdempotencyKey(newServiceIdempotencyKey());
        onCreated(service);
      },
      onError: (cause: unknown) => {
        const message = cause && typeof cause === "object" && "data" in cause
          && (cause as { data?: { error?: string } }).data?.error;
        setError(typeof message === "string" ? message : "Could not add the service. Please try again.");
      },
    },
  });

  if (!hasClientCapability(user, "services.manage")) {
    return (
      <p className="text-xs text-slate-500" role="note">
        Only an admin can add services to the catalog. Ask one to add it, then pick it here.
      </p>
    );
  }

  const update = (field: keyof ServiceDraft, value: string | boolean) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const submit = () => {
    if (!canSubmitService(create.isPending)) return;
    const prepared = serviceDraftToBody(draft);
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    setError(null);
    create.mutate({ data: prepared.body });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  const SELECT = "mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3" onKeyDown={onKeyDown}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New catalog service</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">
          Name
          <Input
            aria-label="Service name"
            value={draft.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="e.g. Exterior window cleaning"
            className="mt-1 h-9"
            disabled={create.isPending}
            autoFocus
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Category
          <select
            aria-label="Service category"
            className={SELECT}
            value={draft.category}
            onChange={(e) => { if (isServiceCategory(e.target.value)) update("category", e.target.value); }}
            disabled={create.isPending}
          >
            {SERVICE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Pricing
          <select
            aria-label="Service pricing"
            className={SELECT}
            value={draft.pricingType}
            onChange={(e) => { if (isServicePricingType(e.target.value)) update("pricingType", e.target.value); }}
            disabled={create.isPending}
          >
            {SERVICE_PRICING.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Price ($)
          <Input
            aria-label="Service price"
            type="number"
            min={0}
            step="0.01"
            value={draft.basePrice}
            onChange={(e) => update("basePrice", e.target.value)}
            placeholder="0.00"
            className="mt-1 h-9"
            disabled={create.isPending}
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={create.isPending}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {create.isPending ? "Adding…" : "Add to catalog"}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={create.isPending}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-[11px] text-slate-400">Saved to the Service Catalog and available on every profile.</p>
    </div>
  );
}
