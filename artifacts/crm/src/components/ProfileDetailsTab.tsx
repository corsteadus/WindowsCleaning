import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MapPin, Phone, Plus, Save, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { protectedFetch } from "@/lib/auth-scope";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!response.ok) throw new Error((await response.text()) || "Request failed");
  return response.json() as Promise<T>;
}

type ChannelPurpose = "general" | "billing" | "estimates";
type Channel = { id: number; type: "email" | "phone"; label?: string | null; value: string; purposes?: ChannelPurpose[]; purpose?: ChannelPurpose | null; contactId?: number | null };
type FieldValue = { id?: number; fieldId?: number; label?: string; name?: string; value: string; position?: number };
type CatalogItem = { id?: number; value?: string; name?: string; label?: string };
type ProfileDetails = {
  profileTemplate?: "residential" | "commercial";
  profileType?: string | null;
  profileTypeId?: number | null;
  profileGroup?: string | null;
  profileGroupId?: number | null;
  isNonProfit?: boolean;
  taxExempt?: boolean;
  ccFeeExempt?: boolean;
  paymentTerms?: string | null;
  paymentTermsId?: number | null;
  effectivePaymentTerms?: string | null;
  paymentTermsSource?: "company_default" | "account_specific";
  marketingSource?: string | null;
  marketingSourceId?: number | null;
  channels?: Channel[];
  customFields?: FieldValue[];
  locations?: LocationSummary[];
};
type ContactOption = { id: number; firstName: string; lastName: string };
type LocationSummary = { id: number; name?: string | null; address: string; city?: string | null; state?: string | null; zip?: string | null; propertyType?: string | null; isPrimary?: boolean; serviceNotes?: string | null; accessNotes?: string | null };

type ChannelDraft = { type: "email" | "phone"; label: string; value: string; purposes: ChannelPurpose[]; contactId: string };
const EMPTY_CHANNEL: ChannelDraft = { type: "email", label: "", value: "", purposes: ["general"], contactId: "" };

export function ProfileDetailsTab({
  customerId, apiBase, contacts, fallbackLocations, entityLabel,
}: {
  customerId: number;
  apiBase: string;
  contacts: ContactOption[];
  fallbackLocations: LocationSummary[];
  entityLabel: "Customer" | "Prospect";
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [settings, setSettings] = useState<ProfileDetails>({});
  const [draftChannel, setDraftChannel] = useState(EMPTY_CHANNEL);

  const detailKey = ["profile-details", apiBase, customerId];
  const detailsQuery = useQuery<ProfileDetails>({
    queryKey: detailKey,
    queryFn: () => apiFetch(`${apiBase}/${customerId}/profile-details`),
  });
  const catalogsQuery = useQuery<Record<string, CatalogItem[]>>({
    queryKey: ["profile-catalogs"],
    queryFn: async () => {
      const [profileTypes, profileGroups, paymentTerms, marketingSources] = await Promise.all(
        ["profile-types", "profile-groups", "payment-terms", "marketing-sources"].map(type =>
          apiFetch<CatalogItem[] | { items?: CatalogItem[] }>(`/api/catalogs/${type}`).then(result => Array.isArray(result) ? result : result.items ?? []),
        ),
      );
      return { profileTypes, profileGroups, paymentTerms, marketingSources };
    },
  });

  useEffect(() => {
    if (detailsQuery.data) setSettings(detailsQuery.data);
  }, [detailsQuery.data]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: detailKey });
    queryClient.invalidateQueries({ queryKey: ["customer", String(customerId)] });
  };
  const saveSettings = useMutation({
    mutationFn: () => apiFetch(`${apiBase}/${customerId}/profile-settings`, { method: "PUT", body: JSON.stringify(settings) }),
    onSuccess: () => { refresh(); toast({ title: "Profile settings saved" }); },
    onError: () => toast({ title: "Could not save profile settings", variant: "destructive" }),
  });
  const saveFields = useMutation({
    mutationFn: (customFields: FieldValue[]) => apiFetch(`${apiBase}/${customerId}/custom-fields`, { method: "PUT", body: JSON.stringify({ customFields }) }),
    onSuccess: () => { refresh(); toast({ title: "Custom fields saved" }); },
    onError: () => toast({ title: "Could not save custom fields", variant: "destructive" }),
  });
  const addChannel = useMutation({
    mutationFn: () => apiFetch(`${apiBase}/${customerId}/channels`, { method: "POST", body: JSON.stringify({ ...draftChannel, contactId: draftChannel.contactId ? Number(draftChannel.contactId) : null }) }),
    onSuccess: () => { setDraftChannel(EMPTY_CHANNEL); refresh(); toast({ title: "Channel added" }); },
    onError: () => toast({ title: "Could not add channel", variant: "destructive" }),
  });
  const updateChannel = useMutation({
    mutationFn: (channel: Channel) => apiFetch(`/api/contact-channels/${channel.id}`, { method: "PATCH", body: JSON.stringify(channel) }),
    onSuccess: refresh,
    onError: () => toast({ title: "Could not update channel", variant: "destructive" }),
  });
  const deleteChannel = useMutation({
    mutationFn: (channel: Channel) => apiFetch(`/api/contact-channels/${channel.id}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); toast({ title: "Channel removed" }); },
    onError: () => toast({ title: "Could not remove channel", variant: "destructive" }),
  });

  if (detailsQuery.isLoading) return <div className="py-10 text-center text-sm text-slate-400">Loading profile details…</div>;
  if (detailsQuery.error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Profile details could not be loaded.</div>;

  const customFields = [...(settings.customFields ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const locations = settings.locations?.length ? settings.locations : fallbackLocations;
  const catalogOptions = (name: string) => (catalogsQuery.data?.[name] ?? []).map(item => item.value ?? item.name ?? item.label ?? "").filter(Boolean);
  const update = (next: Partial<ProfileDetails>) => setSettings(current => ({ ...current, ...next }));

  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div><h2 className="font-bold text-slate-900">Profile details</h2><p className="text-xs text-slate-500 mt-1">Account classification, billing policy, and acquisition settings.</p></div>
        <button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Save className="w-3.5 h-3.5" />{saveSettings.isPending ? "Saving…" : "Save settings"}</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Profile template"><div className="flex rounded-lg border border-slate-200 p-1">{(["residential", "commercial"] as const).map(template => <button key={template} onClick={() => update({ profileTemplate: template })} className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold capitalize ${settings.profileTemplate === template ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}>{template}</button>)}</div></Field>
        <SelectField label="Profile type" value={settings.profileType ?? ""} options={catalogOptions("profileTypes")} onChange={profileType => update({ profileType, profileTypeId: null })} />
        <SelectField label="Profile group" value={settings.profileGroup ?? ""} options={catalogOptions("profileGroups")} onChange={profileGroup => update({ profileGroup, profileGroupId: null })} />
        <Field label="Payment terms"><select value={settings.paymentTerms ?? ""} onChange={e => update({ paymentTerms: e.target.value || null, paymentTermsId: null })} className="input-lite"><option value="">Use company default</option>{catalogOptions("paymentTerms").map(option => <option key={option} value={option}>{option}</option>)}</select>{settings.paymentTermsSource === "company_default" && settings.effectivePaymentTerms && <span className="block text-[10px] text-slate-400">Current company default: {settings.effectivePaymentTerms}</span>}</Field>
        <SelectField label="Marketing source" value={settings.marketingSource ?? ""} options={catalogOptions("marketingSources")} onChange={marketingSource => update({ marketingSource, marketingSourceId: null })} />
        <div className="grid grid-cols-3 gap-2 content-end">{([["isNonProfit", "Nonprofit"], ["taxExempt", "Tax exempt"], ["ccFeeExempt", "No CC fee"]] as const).map(([key, label]) => <label key={key} className="flex min-h-16 cursor-pointer flex-col justify-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700"><input type="checkbox" checked={Boolean(settings[key])} onChange={e => update({ [key]: e.target.checked })} className="mb-1 accent-primary" />{label}</label>)}</div>
      </div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold text-slate-900">Contact channels</h2><p className="mt-1 text-xs text-slate-500">Add as many labeled email addresses and phone numbers as needed. A channel may belong to the account or a named contact.</p>
      <div className="mt-4 space-y-2">{(settings.channels ?? []).map(channel => <ChannelRow key={channel.id} channel={channel} contacts={contacts} onSave={updateChannel.mutate} onDelete={() => deleteChannel.mutate(channel)} />)}</div>
       <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-[90px_1fr_1fr_1.4fr_150px_auto]">
        <select aria-label="Channel type" value={draftChannel.type} onChange={e => setDraftChannel(d => ({ ...d, type: e.target.value as "email" | "phone" }))} className="input-lite"><option value="email">Email</option><option value="phone">Phone</option></select>
        <input aria-label="Channel label" value={draftChannel.label} onChange={e => setDraftChannel(d => ({ ...d, label: e.target.value }))} placeholder="Label (e.g. Office)" className="input-lite" />
        <input aria-label="Channel value" value={draftChannel.value} onChange={e => setDraftChannel(d => ({ ...d, value: e.target.value }))} placeholder={draftChannel.type === "email" ? "name@example.com" : "(555) 555-5555"} className="input-lite" />
        <PurposePicker value={draftChannel.purposes} onChange={purposes => setDraftChannel(d => ({ ...d, purposes }))} />
        <select aria-label="Named contact" value={draftChannel.contactId} onChange={e => setDraftChannel(d => ({ ...d, contactId: e.target.value }))} className="input-lite"><option value="">Account (no contact)</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select>
        <button onClick={() => addChannel.mutate()} disabled={!draftChannel.value.trim() || addChannel.isPending} className="rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50"><Plus className="inline w-3.5 h-3.5" /> Add</button>
      </div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex justify-between gap-3"><div><h2 className="font-bold text-slate-900">Custom fields</h2><p className="mt-1 text-xs text-slate-500">Values retain their configured display order.</p></div><button onClick={() => saveFields.mutate(customFields)} disabled={saveFields.isPending} className="text-xs font-semibold text-primary disabled:opacity-50">Save custom fields</button></div><div className="mt-4 space-y-2">{customFields.length ? customFields.map((field, index) => <label key={field.id ?? field.fieldId ?? index} className="grid gap-2 text-xs font-semibold text-slate-600 md:grid-cols-[190px_1fr]"><span className="py-2">{field.label ?? field.name ?? `Field ${index + 1}`}</span><input value={field.value ?? ""} onChange={e => { const next = [...customFields]; next[index] = { ...field, value: e.target.value, position: index }; update({ customFields: next }); }} className="input-lite" /></label>) : <p className="text-sm text-slate-400">No custom fields are configured.</p>}</div></section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold text-slate-900">Locations</h2><p className="mt-1 text-xs text-slate-500"><strong>General notes</strong> belong to this {entityLabel.toLowerCase()}; <strong>location notes</strong> stay with each address; <strong>estimate and job notes</strong> stay with the individual estimate or job.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{locations.length ? locations.map(location => <div key={location.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /><p className="text-sm font-bold text-slate-800">{location.name || location.address}</p>{location.isPrimary && <span className="ml-auto text-[10px] font-bold uppercase text-primary">Primary</span>}</div>{location.name && <p className="ml-6 mt-1 text-xs text-slate-500">{location.address}</p>}<p className="ml-6 text-xs text-slate-500">{[location.city, location.state, location.zip].filter(Boolean).join(", ")}</p>{location.serviceNotes || location.accessNotes ? <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">{location.serviceNotes || location.accessNotes}</p> : null}</div>) : <p className="text-sm text-slate-400">No locations on this profile.</p>}</div></section>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1.5"><span className="text-xs font-semibold text-slate-600">{label}</span>{children}</label>; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <Field label={label}><select value={value} onChange={e => onChange(e.target.value)} className="input-lite"><option value="">Not set</option>{value && !options.includes(value) && <option value={value}>{value}</option>}{options.map(option => <option key={option} value={option}>{option}</option>)}</select></Field>; }
function PurposePicker({ value, onChange }: { value: ChannelPurpose[]; onChange: (value: ChannelPurpose[]) => void }) { return <fieldset className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1" aria-label="Channel purposes">{(["general", "billing", "estimates"] as const).map(purpose => <label key={purpose} className="flex items-center gap-1 text-[10px] font-semibold capitalize text-slate-600"><input type="checkbox" checked={value.includes(purpose)} onChange={event => { const next = event.target.checked ? [...value, purpose] : value.filter(item => item !== purpose); if (next.length) onChange(next); }} className="accent-primary" />{purpose}</label>)}</fieldset>; }
function ChannelRow({ channel, contacts, onSave, onDelete }: { channel: Channel; contacts: ContactOption[]; onSave: (channel: Channel) => void; onDelete: () => void }) { const normalized = { ...channel, purposes: channel.purposes?.length ? channel.purposes : [channel.purpose ?? "general"] as ChannelPurpose[] }; const [draft, setDraft] = useState(normalized); useEffect(() => setDraft({ ...channel, purposes: channel.purposes?.length ? channel.purposes : [channel.purpose ?? "general"] }), [channel]); return <div className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[90px_1fr_1fr_1.4fr_150px_auto]"><span className="flex items-center gap-1 text-xs font-semibold text-slate-600">{draft.type === "email" ? <Mail className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}{draft.type}</span><input value={draft.label ?? ""} onChange={e => setDraft({ ...draft, label: e.target.value })} aria-label="Channel label" className="input-lite" /><input value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} aria-label="Channel value" className="input-lite" /><PurposePicker value={draft.purposes} onChange={purposes => setDraft({ ...draft, purposes })} /><select value={draft.contactId ?? ""} onChange={e => setDraft({ ...draft, contactId: e.target.value ? Number(e.target.value) : null })} aria-label="Named contact" className="input-lite"><option value="">Account</option>{contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.firstName} {contact.lastName}</option>)}</select><div className="flex gap-1"><button onClick={() => onSave(draft)} className="rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary/5">Save</button><button onClick={onDelete} className="rounded-lg px-2 text-red-500 hover:bg-red-50" aria-label="Delete channel"><Trash2 className="h-3.5 w-3.5" /></button></div></div>; }