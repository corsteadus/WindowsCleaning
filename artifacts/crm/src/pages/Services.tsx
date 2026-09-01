import { FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import {
  getListServicesQueryKey,
  useCreateService,
  useListServices,
  type Service,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Wrench, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hasClientCapability } from "@/lib/rbac";
import { formatCurrency } from "@/lib/utils";
import {
  canSubmitService, emptyServiceDraft, isServiceCategory, isServicePricingType,
  serviceIdempotencyHeaders, SERVICE_CATEGORIES, SERVICE_PRICING, type ServiceDraft, validateServiceDraft,
} from "@/lib/service-form";

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `service-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Services() {
  const { data: services, isLoading } = useListServices();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = hasClientCapability(user, "services.manage");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ServiceDraft>(emptyServiceDraft);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const create = useCreateService({
    request: { headers: serviceIdempotencyHeaders(idempotencyKey) },
    mutation: {
      onSuccess: (service) => {
        queryClient.setQueryData<Service[]>(getListServicesQueryKey(), (current) =>
          [...(current ?? []), service].sort((a, b) => a.name.localeCompare(b.name)),
        );
        void queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
        setOpen(false);
        setDraft(emptyServiceDraft());
        setError(null);
        setIdempotencyKey(newIdempotencyKey());
        toast({ title: "Service added", description: `${service.name} is now in the catalog.` });
      },
      onError: (cause: unknown) => {
        const message = cause && typeof cause === "object" && "data" in cause
          && (cause as { data?: { error?: string } }).data?.error;
        setError(typeof message === "string" ? message : "Could not add the service. Please try again.");
      },
    },
  });

  const close = () => {
    if (create.isPending) return;
    setOpen(false);
    setError(null);
  };
  const start = () => {
    setDraft(emptyServiceDraft());
    setError(null);
    setIdempotencyKey(newIdempotencyKey());
    setOpen(true);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmitService(create.isPending)) return;
    const validation = validateServiceDraft(draft);
    if (validation) {
      setError(validation);
      return;
    }
    const pricing = SERVICE_PRICING.find(([value]) => value === draft.pricingType);
    if (!pricing) {
      setError("Select a valid pricing type.");
      return;
    }
    create.mutate({
      data: {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        category: draft.category,
        pricingType: draft.pricingType,
        basePrice: Number(draft.basePrice),
        unit: pricing[2],
        estimatedDuration: draft.estimatedDuration.trim() ? Number(draft.estimatedDuration) : null,
        isActive: draft.isActive,
      },
    });
  };
  const update = (field: keyof ServiceDraft, value: string | boolean) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (error) setError(null);
  };

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Service Catalog</h1>
          <p className="text-muted-foreground mt-1">Manage your pricing and offerings.</p>
        </div>
        {canManage && <Button onClick={start} className="rounded-xl shadow-lg shadow-primary/20" data-testid="button-add-service">
          <Plus className="w-5 h-5 mr-2" /> Add Service
        </Button>}
      </div>

      {isLoading ? <div className="text-center py-12 text-slate-500">Loading catalog...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services?.map((service) => <Card key={service.id} className="border-none shadow-sm hover:shadow-md transition-shadow bg-white rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-100 pb-4"><div className="flex justify-between items-start">
              <Badge variant={service.isActive ? "default" : "secondary"} className="capitalize">{service.category}</Badge>
              <span className="font-display font-bold text-lg text-primary">{formatCurrency(service.basePrice)}{service.unit && <span className="text-sm font-normal text-muted-foreground">/{service.unit}</span>}</span>
            </div><CardTitle className="text-xl mt-3 text-slate-900">{service.name}</CardTitle></CardHeader>
            <CardContent className="pt-4"><p className="text-sm text-slate-600 line-clamp-2 min-h-[40px]">{service.description || "No description provided."}</p>
              <div className="mt-4 flex items-center justify-between text-sm"><span className="text-slate-500 bg-slate-100 px-2 py-1 rounded-md capitalize">{service.pricingType.replace("_", " ")}</span>
                {service.estimatedDuration !== null && <span className="text-slate-500 flex items-center"><Wrench className="w-3.5 h-3.5 mr-1" />{service.estimatedDuration} mins</span>}
              </div></CardContent>
          </Card>)}
          {services?.length === 0 && <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-500 bg-white rounded-2xl border border-dashed border-slate-200"><Wrench className="w-12 h-12 mb-4 text-slate-300" /><h3 className="text-lg font-medium text-slate-900 mb-1">No services</h3><p>Build your service catalog to generate quotes easily.</p></div>}
        </div>
      )}

      <Dialog open={open} onOpenChange={(next) => next ? setOpen(true) : close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add service</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium">Service name<Input autoFocus value={draft.name} onChange={(e) => update("name", e.target.value)} disabled={create.isPending} data-testid="input-service-name" /></label>
            <label className="block text-sm font-medium">Description<Textarea value={draft.description} onChange={(e) => update("description", e.target.value)} disabled={create.isPending} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-medium">Category<select className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.category} onChange={(e) => { if (isServiceCategory(e.target.value)) update("category", e.target.value); }} disabled={create.isPending}>{SERVICE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-sm font-medium">Pricing type<select className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.pricingType} onChange={(e) => { if (isServicePricingType(e.target.value)) update("pricingType", e.target.value); }} disabled={create.isPending}>{SERVICE_PRICING.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            <div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium">Price<Input type="number" min="0" step="0.01" value={draft.basePrice} onChange={(e) => update("basePrice", e.target.value)} disabled={create.isPending} data-testid="input-service-price" /></label><label className="text-sm font-medium">Duration (minutes)<Input type="number" min="0" step="1" value={draft.estimatedDuration} onChange={(e) => update("estimatedDuration", e.target.value)} disabled={create.isPending} /></label></div>
            <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={draft.isActive} onChange={(e) => update("isActive", e.target.checked)} disabled={create.isPending} /> Active in catalog</label>
            {error && <p role="alert" className="text-sm text-destructive" data-testid="text-service-form-error">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={create.isPending}>Cancel</Button><Button type="submit" disabled={create.isPending} data-testid="button-save-service">{create.isPending ? "Adding…" : "Add Service"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}