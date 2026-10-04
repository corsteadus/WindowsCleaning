import { useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { getListServicesQueryKey, useCreateService, type Service } from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasClientCapability } from "@/lib/rbac";
import { ServiceCategoryPicker } from "@/components/ServiceCategoryPicker";
import {
  canSubmitService, emptyServiceDraft,
  newServiceIdempotencyKey, serviceDraftToBody, serviceIdempotencyHeaders,
  type ServiceDraft,
} from "@/lib/service-form";

/**
 * Adds a service to the company-wide Service Catalog from wherever a service is
 * being picked — a quote, a job — so it never has to be recreated per customer
 * (Kyle, Prospect Profile Notes #22).
 *
 * Kyle (Testing Edits, 2026-10-01, #8): the catalogue keeps a name and a
 * category, nothing else. No price is asked for here; it is entered on the quote
 * or job that uses the service.
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
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3" onKeyDown={onKeyDown}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New catalog service</p>

      <label className="block text-xs font-medium text-slate-600">
        Name
        <Input
          aria-label="Service name"
          value={draft.name}
          onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
          placeholder="e.g. Exterior window cleaning"
          className="mt-1 h-9"
          disabled={create.isPending}
          autoFocus
        />
      </label>

      <div className="text-xs font-medium text-slate-600">
        Category
        <ServiceCategoryPicker
          value={draft.category}
          onChange={(code) => setDraft((current) => ({ ...current, category: code }))}
          disabled={create.isPending}
          onError={setError}
        />
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
      <p className="text-[11px] text-slate-400">
        Saved to the Service Catalog and available on every profile. The price is set on the quote or job that uses it.
      </p>
    </div>
  );
}
