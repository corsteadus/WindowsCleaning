import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Building2, ChevronLeft, ChevronRight, Edit2, Eye, Link2, MapPin, Plus, RotateCcw, Search, Star, Archive, X } from "lucide-react";
import {
  useArchiveProperty, useCreateProperty, useLinkPropertyAccount, useListProperties,
  useRestoreProperty, useSetPrimaryProperty, useUnlinkPropertyAccount, useUpdateProperty,
  getListPropertiesQueryKey,
} from "@/lib/property-client";
import { Layout } from "@/components/Layout";
import { CustomerCombobox, type CustomerComboboxRecord } from "@/components/CustomerCombobox";
import { propertyAddress, propertyLabel, propertyRelationshipLabel, type PropertyLike } from "@/lib/property";
import { propertySearchParams } from "@/lib/property-search";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { hasClientCapability } from "@/lib/rbac";
import { getPropertiesEmptyStateDescription } from "@/lib/schedule-empty-state";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";

type Property = PropertyLike & {
  customerId: number;
  propertyType: string;
  accessNotes?: string | null;
  gateCode?: string | null;
  serviceNotes?: string | null;
  county?: string | null;
  subdivision?: string | null;
  directions?: string | null;
  locationNotes?: string | null;
  hasTracks?: boolean;
  ownerName?: string;
  accountLinks?: Array<{ customerId: number; customerName: string; relationshipType: string; isOwner: boolean }>;
  stories?: number | null;
  windowCount?: number | null;
  hasScreens?: boolean;
  hasHardWater?: boolean;
  isPrimary?: boolean;
  isBillingAddress?: boolean;
};
type Draft = {
  name: string; address: string; city: string; state: string; zip: string; county: string; subdivision: string;
  propertyType: string; stories: string; windowCount: string; accessNotes: string;
  gateCode: string; serviceNotes: string; directions: string; locationNotes: string; hasScreens: boolean; hasHardWater: boolean; hasTracks: boolean;
  isBillingAddress: boolean;
};
const emptyDraft: Draft = {
  name: "", address: "", city: "", state: "", zip: "", county: "", subdivision: "", propertyType: "residential",
  stories: "", windowCount: "", accessNotes: "", gateCode: "", serviceNotes: "", directions: "", locationNotes: "",
  hasScreens: false, hasHardWater: false, hasTracks: false, isBillingAddress: false,
};
const customerLabel = (c: CustomerComboboxRecord & { firstName?: string; lastName?: string; companyName?: string | null }) =>
  c.companyName || [c.firstName, c.lastName].filter(Boolean).join(" ") || `Customer #${c.id}`;

function normalize(data: unknown): { rows: Property[]; total: number; hasMore: boolean } {
  if (Array.isArray(data)) return { rows: data as Property[], total: data.length, hasMore: false };
  const envelope = (data ?? {}) as { data?: Property[]; total?: number; hasMore?: boolean };
  return { rows: envelope.data ?? [], total: envelope.total ?? 0, hasMore: !!envelope.hasMore };
}

function draftFrom(property?: Property): Draft {
  return property ? {
    name: property.name ?? "", address: property.address ?? "", city: property.city ?? "",
    state: property.state ?? "", zip: property.zip ?? "", propertyType: property.propertyType ?? "residential",
    county: property.county ?? "", subdivision: property.subdivision ?? "",
    stories: property.stories == null ? "" : String(property.stories),
    windowCount: property.windowCount == null ? "" : String(property.windowCount),
    accessNotes: property.accessNotes ?? "", gateCode: property.gateCode ?? "", serviceNotes: property.serviceNotes ?? "",
    directions: property.directions ?? "", locationNotes: property.locationNotes ?? "",
    hasScreens: !!property.hasScreens, hasHardWater: !!property.hasHardWater, hasTracks: !!property.hasTracks,
    isBillingAddress: !!property.isBillingAddress,
  } : emptyDraft;
}

export default function Properties() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = hasClientCapability(user, "properties.manage");
  const emptyStateDescription = getPropertiesEmptyStateDescription(user);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [relationship, setRelationship] = useState<"all" | "owned" | "shared">("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [account, setAccount] = useState<(CustomerComboboxRecord & { firstName?: string; lastName?: string; companyName?: string | null }) | null>(null);
  const [editing, setEditing] = useState<Property | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [showEditor, setShowEditor] = useState(false);
  const [detailProperty, setDetailProperty] = useState<Property | null>(null);
  const [linking, setLinking] = useState<Property | null>(null);
  const [linkAccount, setLinkAccount] = useState<(CustomerComboboxRecord & { firstName?: string; lastName?: string; companyName?: string | null }) | null>(null);

  const params = useMemo(
    () => propertySearchParams({ page, pageSize, search, status, relationship }),
    [page, pageSize, relationship, search, status],
  );
  const { data, isLoading, isError, refetch } = useListProperties(params, {
    query: { queryKey: authScopedQueryKey(user, getListPropertiesQueryKey(params)) },
  });
  const result = normalize(data);
  const invalidate = () => queryClient.invalidateQueries({
    queryKey: authScopedQueryKey(user, ["/api/properties"]),
  });
  const mutationOptions = { onSuccess: () => invalidate(), onError: () => toast({ title: "Property action failed", variant: "destructive" }) };
  const archive = useArchiveProperty({ mutation: { ...mutationOptions, onSuccess: () => { invalidate(); toast({ title: "Property archived" }); } } });
  const restore = useRestoreProperty({ mutation: { ...mutationOptions, onSuccess: () => { invalidate(); toast({ title: "Property restored" }); } } });
  const primary = useSetPrimaryProperty({ mutation: { ...mutationOptions, onSuccess: () => { invalidate(); toast({ title: "Primary property updated" }); } } });
  const update = useUpdateProperty({ mutation: { ...mutationOptions, onSuccess: () => { invalidate(); setShowEditor(false); setEditing(null); toast({ title: "Property saved" }); } } });
  const create = useCreateProperty({ mutation: { ...mutationOptions, onSuccess: () => { invalidate(); setShowEditor(false); setAccount(null); toast({ title: "Property added" }); } } });
  const link = useLinkPropertyAccount({ mutation: { ...mutationOptions, onSuccess: () => { invalidate(); setLinking(null); setLinkAccount(null); toast({ title: "Account linked" }); } } });
  const unlink = useUnlinkPropertyAccount({ mutation: { ...mutationOptions, onSuccess: () => { invalidate(); toast({ title: "Account unlinked" }); } } });

  const openNew = () => { setEditing(null); setDraft(emptyDraft); setAccount(null); setShowEditor(true); };
  const openEdit = (property: Property) => { setEditing(property); setDraft(draftFrom(property)); setShowEditor(true); };
  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.address.trim() || !draft.city.trim() || !draft.state.trim() || !draft.zip.trim()) {
      toast({ title: "Address fields are required", variant: "destructive" }); return;
    }
    const payload = {
      ...draft, name: draft.name || null, address: draft.address, city: draft.city, state: draft.state, zip: draft.zip,
      stories: draft.stories ? Number(draft.stories) : null, windowCount: draft.windowCount ? Number(draft.windowCount) : null,
    };
    if (editing) update.mutate({ id: editing.id, data: payload });
    else if (account) create.mutate({ data: { ...payload, customerId: account.id } });
    else toast({ title: "Choose an account first", variant: "destructive" });
  };
  const changeAccountDefault = async (property: Property, reset = false) => {
    if (!property.customerId) return;
    try {
      const response = await protectedFetch(`/api/customers/${property.customerId}/${reset ? "reset-default-property" : "set-default-property"}`, {
        method: "POST",
        credentials: "include",
        headers: reset ? undefined : { "Content-Type": "application/json" },
        body: reset ? undefined : JSON.stringify({ propertyId: property.id }),
      });
      if (!response.ok) throw new Error("Default update failed");
      invalidate();
      toast({ title: reset ? "Default reset to automatic" : "Default property updated" });
    } catch {
      toast({ title: "Could not update account default", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Operations workspace</p>
            <h1 className="mt-1 text-3xl font-display font-bold text-slate-900">Properties</h1>
            <p className="mt-1 text-sm text-slate-500">Service locations that keep every customer, quote, job, and repeat visit grounded.</p>
          </div>
          {canManage && <Button onClick={openNew} className="rounded-xl gap-2"><Plus className="h-4 w-4" /> Add property</Button>}
        </div>
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[minmax(0,1fr)_150px_150px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search label, address, city, or account" className="rounded-xl pl-9" data-testid="input-property-search" />
          </div>
          <Select value={status} onValueChange={(value: "active" | "archived" | "all") => { setStatus(value); setPage(1); }}>
            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="active">Active only</SelectItem><SelectItem value="archived">Archived</SelectItem><SelectItem value="all">All statuses</SelectItem></SelectContent>
          </Select>
          <Select value={relationship} onValueChange={(value: "all" | "owned" | "shared") => { setRelationship(value); setPage(1); }}>
            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All accounts</SelectItem><SelectItem value="owned">Owned</SelectItem><SelectItem value="shared">Shared</SelectItem></SelectContent>
          </Select>
          <Button variant="outline" onClick={() => refetch()} className="rounded-xl">Refresh</Button>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{result.total} location{result.total === 1 ? "" : "s"} · page {page}</span>
          <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg"><ChevronLeft className="h-4 w-4" /> Previous</Button><Button variant="outline" size="sm" disabled={!result.hasMore} onClick={() => setPage((p) => p + 1)} className="rounded-lg">Next <ChevronRight className="h-4 w-4" /></Button></div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {isLoading ? <div className="space-y-3 p-5">{[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
            : isError ? <div className="p-12 text-center"><p className="font-semibold text-slate-800">Properties could not load.</p><Button onClick={() => refetch()} variant="outline" className="mt-3 rounded-xl">Try again</Button></div>
            : result.rows.length === 0 ? <div className="p-14 text-center"><Building2 className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 font-semibold text-slate-800">No properties match this view.</p><p className="mt-1 text-sm text-slate-500">{emptyStateDescription}</p></div>
            : <div className="divide-y divide-slate-100">
              {result.rows.map((property) => {
                const archived = !!property.archivedAt;
                const links = property.accountLinks ?? [];
                return <div key={property.id} className="grid gap-4 p-4 transition-colors hover:bg-slate-50/70 md:grid-cols-[minmax(0,1.45fr)_180px_160px_auto] md:items-center" data-testid={`row-property-${property.id}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={`mt-0.5 rounded-xl p-2.5 ${archived ? "bg-slate-100 text-slate-400" : "bg-primary/10 text-primary"}`}><MapPin className="h-4 w-4" /></div>
                    <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{propertyLabel(property)}</p><p className="truncate text-sm text-slate-500">{propertyAddress(property)}</p><div className="mt-1 flex flex-wrap items-center gap-1.5"><Badge variant="outline" className="capitalize">{property.propertyType}</Badge><Badge className={propertyRelationshipLabel(property) === "Shared" ? "bg-violet-50 text-violet-700 hover:bg-violet-50" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}>{propertyRelationshipLabel(property)}</Badge>{property.isBillingAddress && <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">Billing</Badge>}{property.isPrimary && <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Primary</Badge>}</div></div>
                  </div>
                  <div className="text-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Account</p>{property.customerId ? <Link href={`/customers/${property.customerId}`} className="font-semibold text-primary hover:underline">{property.ownerName ?? `Customer #${property.customerId}`}</Link> : <span className="text-slate-500">Unassigned</span>}{links.length > 1 && <p className="mt-0.5 text-xs text-slate-400">{links.length} linked accounts</p>}</div>
                  <div className="text-sm text-slate-500">{property.stories ? `${property.stories} stories` : "—"}{property.windowCount ? ` · ${property.windowCount} windows` : ""}<p className="text-xs text-slate-400">{archived ? "Archived" : "Available for new work"}</p></div>
                   <div className="flex flex-wrap justify-start gap-1.5 md:justify-end"><Button variant="ghost" size="sm" onClick={() => setDetailProperty(property)} className="rounded-lg text-slate-600"><Eye className="mr-1 h-3.5 w-3.5" /> View</Button>{canManage && <><Button variant="ghost" size="sm" onClick={() => openEdit(property)} className="rounded-lg text-slate-600"><Edit2 className="mr-1 h-3.5 w-3.5" /> Edit</Button>{!archived && property.customerId && !property.isManualDefault && property.isOwner !== false && <Button variant="ghost" size="sm" onClick={() => changeAccountDefault(property)} className="rounded-lg text-amber-700"><Star className="mr-1 h-3.5 w-3.5" /> Default</Button>}{!archived && property.customerId && property.isManualDefault && property.isOwner !== false && <Button variant="ghost" size="sm" onClick={() => changeAccountDefault(property, true)} className="rounded-lg text-slate-600">Auto</Button>}{!archived && !property.isPrimary && property.isOwner !== false && <Button variant="ghost" size="sm" onClick={() => primary.mutate({ id: property.id })} className="rounded-lg text-amber-700"><Star className="mr-1 h-3.5 w-3.5" /> Primary</Button>}{!archived && property.isOwner !== false && !property.isBillingAddress && <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: property.id, data: { isBillingAddress: true } })} className="rounded-lg text-slate-600">Billing</Button>}{archived ? <Button variant="ghost" size="sm" onClick={() => restore.mutate({ id: property.id })} className="rounded-lg text-emerald-700"><RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore</Button> : <Button variant="ghost" size="sm" onClick={() => archive.mutate({ id: property.id })} className="rounded-lg text-orange-700"><Archive className="mr-1 h-3.5 w-3.5" /> Archive</Button>}{!archived && <Button variant="ghost" size="sm" onClick={() => { setLinking(property); setLinkAccount(null); }} className="rounded-lg text-violet-700"><Link2 className="mr-1 h-3.5 w-3.5" /> Link</Button>}</>}</div>
                </div>;
              })}
            </div>}
        </div>
      </div>

      {canManage && <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit property" : "Add service location"}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4">
            {!editing && <div className="space-y-1.5"><Label>Account</Label><CustomerCombobox selectedCustomer={account} onSelect={setAccount} labelFor={customerLabel} placeholder="Choose the customer account" showClientTypeIcon /></div>}
            <div className="space-y-1.5"><Label>Label</Label><Input value={draft.name} onChange={(e) => setField("name", e.target.value)} placeholder="Main house, north campus, storefront" className="rounded-xl" /></div>
            <div className="space-y-1.5"><Label>Street address</Label><Input required value={draft.address} onChange={(e) => setField("address", e.target.value)} className="rounded-xl" /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div><Label>City</Label><Input required value={draft.city} onChange={(e) => setField("city", e.target.value)} className="mt-1 rounded-xl" /></div><div><Label>State</Label><Input required value={draft.state} onChange={(e) => setField("state", e.target.value)} className="mt-1 rounded-xl" /></div><div><Label>ZIP</Label><Input required value={draft.zip} onChange={(e) => setField("zip", e.target.value)} className="mt-1 rounded-xl" /></div></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><Label>County</Label><Input value={draft.county} onChange={(e) => setField("county", e.target.value)} className="mt-1 rounded-xl" /></div><div><Label>Subdivision</Label><Input value={draft.subdivision} onChange={(e) => setField("subdivision", e.target.value)} className="mt-1 rounded-xl" /></div></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div><Label>Type</Label><Select value={draft.propertyType} onValueChange={(v) => setField("propertyType", v)}><SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="residential">Residential</SelectItem><SelectItem value="commercial">Commercial</SelectItem><SelectItem value="multi_unit">Multi-unit</SelectItem></SelectContent></Select></div><div><Label>Stories</Label><Input type="number" min="1" value={draft.stories} onChange={(e) => setField("stories", e.target.value)} className="mt-1 rounded-xl" /></div><div><Label>Windows</Label><Input type="number" min="0" value={draft.windowCount} onChange={(e) => setField("windowCount", e.target.value)} className="mt-1 rounded-xl" /></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label>Gate code</Label><Input value={draft.gateCode} onChange={(e) => setField("gateCode", e.target.value)} className="mt-1 rounded-xl" /></div><div><Label>Access notes</Label><Input value={draft.accessNotes} onChange={(e) => setField("accessNotes", e.target.value)} className="mt-1 rounded-xl" /></div></div>
            <div><Label>Directions</Label><textarea value={draft.directions} onChange={(e) => setField("directions", e.target.value)} className="mt-1 min-h-16 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder="Arrival, parking, or entrance directions" /></div>
            <div><Label>Location notes</Label><textarea value={draft.locationNotes} onChange={(e) => setField("locationNotes", e.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder="Notes that belong to this location only" /></div>
            <div><Label>Service notes</Label><textarea value={draft.serviceNotes} onChange={(e) => setField("serviceNotes", e.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm" /></div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-600">{(["hasScreens", "hasHardWater", "hasTracks", "isBillingAddress"] as const).map((key) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={draft[key]} onChange={(e) => setField(key, e.target.checked)} className="accent-primary" />{key === "isBillingAddress" ? "Billing address" : key === "hasHardWater" ? "Hard water" : key === "hasScreens" ? "Screens" : "Tracks"}</label>)}</div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowEditor(false)} className="rounded-xl">Cancel</Button><Button type="submit" disabled={create.isPending || update.isPending} className="rounded-xl">{create.isPending || update.isPending ? "Saving…" : editing ? "Save property" : "Add property"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>}
      <Dialog open={!!detailProperty} onOpenChange={(open) => { if (!open) setDetailProperty(null); }}>
        <DialogContent className="max-w-xl rounded-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> {detailProperty ? propertyLabel(detailProperty) : "Property details"}</DialogTitle></DialogHeader>
          {detailProperty && (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">{propertyAddress(detailProperty)}</p>
                <p className="mt-1 text-xs capitalize text-slate-500">{detailProperty.propertyType} · {propertyRelationshipLabel(detailProperty)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Stories</p><p className="font-semibold text-slate-800">{detailProperty.stories ?? "—"}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Windows</p><p className="font-semibold text-slate-800">{detailProperty.windowCount ?? "—"}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Access notes</p><p className="font-semibold text-slate-800">{detailProperty.accessNotes || "—"}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Service notes</p><p className="font-semibold text-slate-800">{detailProperty.serviceNotes || "—"}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">County / subdivision</p><p className="font-semibold text-slate-800">{[detailProperty.county, detailProperty.subdivision].filter(Boolean).join(" · ") || "—"}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Directions</p><p className="font-semibold text-slate-800">{detailProperty.directions || "—"}</p></div>
                <div className="col-span-2"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Location notes</p><p className="font-semibold text-slate-800">{detailProperty.locationNotes || "—"}</p></div>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Linked accounts</p>
                <div className="space-y-1.5">
                  {(detailProperty.accountLinks ?? []).map((link) => <Link key={link.customerId} href={`/customers/${link.customerId}`} onClick={() => setDetailProperty(null)} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm text-primary hover:bg-primary/5"><span>{link.customerName}</span><span className="text-xs text-slate-400">{link.isOwner ? "Owner" : link.relationshipType}</span></Link>)}
                </div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setDetailProperty(null)} className="rounded-xl">Close</Button>{canManage && <Button onClick={() => { openEdit(detailProperty); setDetailProperty(null); }} className="rounded-xl">Edit property</Button>}</DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {canManage && <Dialog open={!!linking} onOpenChange={(open) => { if (!open) { setLinking(null); setLinkAccount(null); } }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Link an account</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Share <span className="font-semibold text-slate-800">{linking ? propertyLabel(linking) : ""}</span> with another customer account. The owning account stays unchanged.</p>
          <CustomerCombobox selectedCustomer={linkAccount} onSelect={setLinkAccount} labelFor={customerLabel} placeholder="Choose account to link" showClientTypeIcon />
          <DialogFooter><Button variant="outline" onClick={() => setLinking(null)} className="rounded-xl">Cancel</Button><Button disabled={!linkAccount || link.isPending} onClick={() => linking && linkAccount && link.mutate({ id: linking.id, data: { customerId: linkAccount.id, relationshipType: "shared" } })} className="rounded-xl">Link account</Button></DialogFooter>
          {linking?.accountLinks && linking.accountLinks.filter((item) => !item.isOwner).length > 0 && <div className="border-t pt-3"><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Existing shared links</p>{linking.accountLinks.filter((item) => !item.isOwner).map((item) => <div key={item.customerId} className="flex items-center justify-between py-1.5 text-sm"><span>{item.customerName}</span><Button variant="ghost" size="sm" className="rounded-lg text-red-600" onClick={() => { if (window.confirm("Unlink this account from the property?")) unlink.mutate({ id: linking.id, customerId: item.customerId }); }}><X className="mr-1 h-3.5 w-3.5" /> Unlink</Button></div>)}</div>}
        </DialogContent>
      </Dialog>}
    </Layout>
  );
}