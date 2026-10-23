import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { ChevronDown, Mail, MapPin, Phone, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";
import { hasClientCapability } from "@/lib/rbac";
import { formatPhoneAsTyped } from "@/lib/phone-format";
import { ROUTING_CHOICES, purposesForChoice, routingChoiceFor } from "@/lib/channel-routing";
import { CustomFieldInput, type CustomFieldValue } from "@/components/CustomFieldInput";
import { MainProfileCard, type ProfileLink } from "@/components/MainProfileCard";
import { lastNoteChange, profileStewardship } from "@/lib/activity-feed";
import {
  ACCOUNT_FIELDS, accountPatch, addressPlan, contactPlan, emailRowsFrom, otherPhones,
  phoneRowsFrom, unsavedSummary, updateSteps,
  type AccountField, type AddressRow, type ChannelLike, type ContactRef, type EmailRow,
  type PersonDraft, type PhoneRow, type UpdateStep,
} from "@/lib/profile-sheet";

/**
 * The profile on one page — Kyle's Videos 1–3 and his answers of 19 and 21
 * October 2026.
 *
 * Order, top to bottom, as he set it: name and status, contact information
 * (phones and emails with whose they are), service address, the less frequent
 * fields toward the bottom of that block (Fax with the phones; County,
 * Subdivision and Birthday below the addresses), then notes, then custom
 * fields. Everything else is folded into **More Details**, where it is one
 * click away rather than gone.
 *
 * Every field is always editable. Nothing saves until **Update**, which stays
 * on screen while you scroll and says what is unsaved. What it sends is
 * decided by lib/profile-sheet.ts, so only the parts that changed are saved.
 */

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const body = await response.text();
  if (!response.ok) {
    let message = body || "Request failed";
    try { message = (JSON.parse(body) as { error?: string }).error ?? message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  return (body ? JSON.parse(body) : undefined) as T;
}

interface SheetContact { id: number; firstName: string; lastName: string; archivedAt?: string | null }
interface SheetProperty {
  id: number; name?: string | null; address: string; city: string; state: string; zip: string;
  isPrimary: boolean; archivedAt?: string | null;
}
export interface SheetCustomer {
  id: number;
  firstName: string;
  lastName: string;
  salutation?: string | null;
  companyName?: string | null;
  email?: string | null;
  homePhone?: string | null;
  workPhone?: string | null;
  cellPhone?: string | null;
  altPhone?: string | null;
  fax?: string | null;
  altContact?: string | null;
  altPhoneType?: string | null;
  billingAddress?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingZip?: string | null;
  county?: string | null;
  subdivision?: string | null;
  birthday?: string | null;
  notes?: string | null;
  directions?: string | null;
  specificNotes?: string | null;
  callbackNotes?: string | null;
  tags?: string | null;
  starRating?: number | null;
  prospectDate?: string | null;
  customerDate?: string | null;
  howHeard?: string | null;
  mainProfile?: ProfileLink | null;
  subProfiles?: ProfileLink[];
  properties: SheetProperty[];
  contacts: SheetContact[];
  activityLogs?: unknown[];
  createdAt: string;
  updatedAt: string;
}

interface Settings {
  profileTemplate?: "residential" | "commercial";
  profileType?: string | null;
  profileGroup?: string | null;
  paymentTerms?: string | null;
  effectivePaymentTerms?: string | null;
  paymentTermsSource?: "company_default" | "account_specific";
  marketingSource?: string | null;
  isNonProfit?: boolean;
  taxExempt?: boolean;
  ccFeeExempt?: boolean;
  channels?: ChannelLike[];
  customFields?: CustomFieldValue[];
}

type CatalogItem = { value?: string; name?: string; label?: string };
const CATALOG_SLUGS = {
  profileTypes: "profile-types",
  profileGroups: "profile-groups",
  paymentTerms: "payment-terms",
  marketingSources: "marketing-sources",
} as const;

const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr."];
const NEW_PERSON = "new";

type AccountValues = Partial<Record<AccountField, string | number | null>>;

interface Draft {
  account: AccountValues;
  settings: Settings;
  phones: PhoneRow[];
  emails: EmailRow[];
  addresses: AddressRow[];
  customFields: CustomFieldValue[];
}

function addressRowsFrom(customer: SheetCustomer): AddressRow[] {
  const active = customer.properties
    .filter((property) => !property.archivedAt)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id - b.id);
  if (active.length) {
    return active.map((property) => ({
      key: `p${property.id}`, propertyId: property.id, name: property.name ?? "",
      address: property.address ?? "", city: property.city ?? "", state: property.state ?? "",
      zip: property.zip ?? "", isPrimary: property.isPrimary,
    }));
  }
  // No property yet: the old billing columns fill the main row, and Update
  // makes it a real address.
  return [{
    key: "main", propertyId: null, name: "", address: customer.billingAddress ?? "",
    city: customer.billingCity ?? "", state: customer.billingState ?? "", zip: customer.billingZip ?? "",
    isPrimary: true,
  }];
}

function draftFrom(customer: SheetCustomer, settings: Settings): Draft {
  const channels = settings.channels ?? [];
  const flat = {
    homePhone: customer.homePhone, workPhone: customer.workPhone, cellPhone: customer.cellPhone,
    altPhone: customer.altPhone, fax: customer.fax, email: customer.email,
  };
  const account: AccountValues = {};
  for (const field of ACCOUNT_FIELDS) {
    account[field] = (customer as unknown as Record<string, string | number | null | undefined>)[field] ?? null;
  }
  return {
    account,
    settings: {
      profileTemplate: settings.profileTemplate ?? "residential",
      profileType: settings.profileType ?? null,
      profileGroup: settings.profileGroup ?? null,
      paymentTerms: settings.paymentTerms ?? null,
      marketingSource: settings.marketingSource ?? null,
      isNonProfit: Boolean(settings.isNonProfit),
      taxExempt: Boolean(settings.taxExempt),
      ccFeeExempt: Boolean(settings.ccFeeExempt),
    },
    phones: phoneRowsFrom(channels, flat),
    emails: emailRowsFrom(channels, flat),
    addresses: addressRowsFrom(customer),
    customFields: [...(settings.customFields ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  };
}

const settingsKeys = ["profileTemplate", "profileType", "profileGroup", "paymentTerms", "marketingSource", "isNonProfit", "taxExempt", "ccFeeExempt"] as const;
const sameSettings = (a: Settings, b: Settings) => settingsKeys.every((key) => (a[key] ?? null) === (b[key] ?? null));
const sameFields = (a: CustomFieldValue[], b: CustomFieldValue[]) =>
  a.length === b.length && a.every((field, index) => (field.value ?? "") === (b[index]?.value ?? ""));

export function ProfileSheet({
  customer, apiBase, canManage, onSaved, onDirtyChange, onEmail, entityLabel,
}: {
  customer: SheetCustomer;
  apiBase: string;
  canManage: boolean;
  /** Refreshes the profile; the page stays locked until it settles. */
  onSaved: () => Promise<unknown> | void;
  onDirtyChange?: (dirty: boolean) => void;
  onEmail?: (address: string) => void;
  entityLabel: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManageCatalogs = hasClientCapability(user, "catalogs.manage");
  const detailsKey = authScopedQueryKey(user, ["profile-sheet", apiBase, customer.id]);

  const details = useQuery<Settings>({
    queryKey: detailsKey,
    queryFn: () => apiFetch<Settings>(`${apiBase}/${customer.id}/profile-details`),
  });
  const catalogs = useQuery<Record<string, string[]>>({
    queryKey: authScopedQueryKey(user, ["profile-sheet-catalogs"]),
    queryFn: async () => {
      const entries = await Promise.all(Object.entries(CATALOG_SLUGS).map(async ([key, slug]) => {
        const items = await apiFetch<CatalogItem[] | { items?: CatalogItem[] }>(`/api/catalogs/${slug}`);
        const list = Array.isArray(items) ? items : items.items ?? [];
        return [key, list.map((item) => item.value ?? item.name ?? item.label ?? "").filter(Boolean)] as const;
      }));
      return Object.fromEntries(entries);
    },
  });

  const initial = useMemo(
    () => (details.data ? draftFrom(customer, details.data) : null),
    [customer, details.data],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  // Fresh data replaces the draft only when nothing is being edited, so a
  // background refetch can never wipe what someone is typing.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (initial && !dirtyRef.current) setDraft(initial);
  }, [initial]);

  const plan = useMemo(() => {
    if (!initial || !draft) return null;
    const contact = contactPlan({
      phonesBefore: initial.phones, phonesAfter: draft.phones,
      emailsBefore: initial.emails, emailsAfter: draft.emails,
    });
    const account = { ...accountPatch(initial.account, draft.account), ...contact.flatClear };
    const addresses = addressPlan(initial.addresses, draft.addresses);
    const needsPeople = contact.ops.some((op) => op.kind !== "remove" && op.contact === "new");
    const dirty: Partial<Record<UpdateStep, boolean>> = {
      people: needsPeople,
      account: Object.keys(account).length > 0,
      settings: !sameSettings(initial.settings, draft.settings),
      contact: contact.ops.length > 0,
      addresses: addresses.ops.length > 0,
      customFields: !sameFields(initial.customFields, draft.customFields),
    };
    return { contact, account, addresses, dirty, any: updateSteps(dirty).length > 0 };
  }, [initial, draft]);

  const isDirty = Boolean(plan?.any);
  useEffect(() => {
    dirtyRef.current = isDirty;
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  if (details.isLoading || !draft || !initial || !plan) {
    return <div className="py-16 text-center text-sm text-slate-400">Loading profile…</div>;
  }
  if (details.error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">This profile could not be loaded.</div>;
  }

  const contacts = customer.contacts.filter((contact) => !contact.archivedAt);
  const set = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const setAccount = (field: AccountField, value: string | number | null) =>
    set({ account: { ...draft.account, [field]: value } });
  const setSettings = (patch: Partial<Settings>) => set({ settings: { ...draft.settings, ...patch } });
  const catalog = (key: keyof typeof CATALOG_SLUGS) => catalogs.data?.[key] ?? [];

  async function update() {
    if (!plan || !draft || !initial) return;
    const addressIssues = plan.addresses.problems;
    if (addressIssues.length) { setProblems(addressIssues); return; }
    setProblems([]);
    setSaving(true);
    const failed: string[] = [];
    try {
      // People first: a number may belong to someone created in this same edit.
      const people = new Map<string, number>();
      const personFor = async (rowKey: string, contact: ContactRef, person?: PersonDraft): Promise<number | null> => {
        if (contact !== "new") return contact;
        if (people.has(rowKey)) return people.get(rowKey)!;
        if (!person?.firstName.trim() || !person.lastName.trim()) throw new Error("A new person needs a first and last name");
        const created = await apiFetch<{ id: number }>("/api/contacts", {
          method: "POST",
          body: JSON.stringify({ customerId: customer.id, firstName: person.firstName.trim(), lastName: person.lastName.trim() }),
        });
        people.set(rowKey, created.id);
        return created.id;
      };

      for (const step of updateSteps(plan.dirty)) {
        try {
          if (step === "account") {
            await apiFetch(`${apiBase}/${customer.id}`, { method: "PATCH", body: JSON.stringify(plan.account) });
          } else if (step === "settings") {
            // A full replacement on the server, so it is sent whole.
            await apiFetch(`${apiBase}/${customer.id}/profile-settings`, {
              method: "PUT", body: JSON.stringify(draft.settings),
            });
          } else if (step === "contact") {
            for (const op of plan.contact.ops) {
              if (op.kind === "remove") {
                await apiFetch(`/api/contact-channels/${op.id}`, { method: "DELETE" });
              } else if (op.kind === "update") {
                const contactId = await personFor(op.rowKey, op.contact, op.newPerson);
                await apiFetch(`/api/contact-channels/${op.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    value: op.value, contactId,
                    ...(op.purposes ? { purposes: op.purposes } : {}),
                    ...(op.sendingPaused !== undefined ? { sendingPaused: op.sendingPaused } : {}),
                  }),
                });
              } else {
                const contactId = await personFor(op.rowKey, op.contact, op.newPerson);
                await apiFetch(`${apiBase}/${customer.id}/channels`, {
                  method: "POST",
                  body: JSON.stringify({
                    channelType: op.type, label: op.label, value: op.value, contactId,
                    ...(op.purposes ? { purposes: op.purposes } : {}),
                  }),
                });
              }
            }
          } else if (step === "addresses") {
            for (const op of plan.addresses.ops) {
              if (op.kind === "update") {
                await apiFetch(`/api/properties/${op.propertyId}`, { method: "PATCH", body: JSON.stringify(op.data) });
              } else {
                await apiFetch("/api/properties", {
                  method: "POST",
                  body: JSON.stringify({ customerId: customer.id, ...op.data, name: op.data.name || null }),
                });
              }
            }
          } else if (step === "customFields") {
            await apiFetch(`${apiBase}/${customer.id}/custom-fields`, {
              method: "PUT",
              body: JSON.stringify({
                customFields: draft.customFields.map((field, index) => ({ ...field, position: index })),
              }),
            });
          }
        } catch (error) {
          failed.push(`${step === "contact" ? "phones and emails" : step}: ${error instanceof Error ? error.message : "failed"}`);
        }
      }
    } finally {
      dirtyRef.current = false;
      // Both halves of the page refresh before it unlocks. Unlocking between
      // them would let an edit start on a half-old page, and its Update would
      // write the old values back.
      await Promise.all([queryClient.invalidateQueries({ queryKey: detailsKey }), onSaved()]);
      setSaving(false);
    }
    if (failed.length) {
      setProblems(failed);
      toast({ title: "Some changes were not saved", description: failed.join(" · "), variant: "destructive" });
    } else {
      toast({ title: `${entityLabel} updated` });
    }
  }

  const discard = () => { dirtyRef.current = false; setDraft(initial); setProblems([]); };

  const noteChange = lastNoteChange((customer.activityLogs ?? []) as never);
  const stewardship = profileStewardship((customer.activityLogs ?? []) as never, {
    createdAt: customer.createdAt, updatedAt: customer.updatedAt,
  });
  const when = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");
  const isCommercial = draft.settings.profileTemplate === "commercial";

  return (
    <div data-testid="profile-sheet" className="space-y-4 pb-4">
      {/* Locked while Update runs: the page reloads from the server when it
          finishes, and anything typed in between would be lost. */}
      <fieldset disabled={saving} aria-busy={saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
      {/* ── Name and type ─────────────────────────────────────────────── */}
      <Card title="Name" testId="sheet-name">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="radiogroup" aria-label="Account type">
            {(["residential", "commercial"] as const).map((type) => (
              <button
                key={type} type="button" role="radio" aria-checked={draft.settings.profileTemplate === type}
                disabled={!canManage}
                onClick={() => setSettings({ profileTemplate: type })}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${draft.settings.profileTemplate === type ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >{type}</button>
            ))}
          </div>
        </div>
        <div className={`mt-3 grid gap-3 ${isCommercial ? "sm:grid-cols-[1fr]" : ""}`}>
          {isCommercial && (
            <Text label="Company name" value={draft.account.companyName} onChange={(v) => setAccount("companyName", v)} disabled={!canManage} />
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[110px_1fr_1fr]">
          <label className="block">
            <span className="field-label">Salutation</span>
            <select aria-label="Salutation" className="input-lite mt-1 w-full" value={(draft.account.salutation as string) ?? ""} disabled={!canManage}
              onChange={(e) => setAccount("salutation", e.target.value || null)}>
              <option value="">—</option>
              {[...new Set([...SALUTATIONS, ...(draft.account.salutation ? [draft.account.salutation as string] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <Text label="First name" value={draft.account.firstName} onChange={(v) => setAccount("firstName", v)} disabled={!canManage} />
          <Text label="Last name" value={draft.account.lastName} onChange={(v) => setAccount("lastName", v)} disabled={!canManage} />
        </div>
        {!isCommercial && (
          <div className="mt-3">
            <Text label="Company name" value={draft.account.companyName} onChange={(v) => setAccount("companyName", v)} disabled={!canManage} placeholder="Optional" />
          </div>
        )}
      </Card>

      {/* ── Contact information ───────────────────────────────────────── */}
      <Card title="Contact information" testId="sheet-contact">
        <div className="space-y-2">
          {draft.phones.map((row) => (
            <PhoneSlot
              key={row.slot} row={row} contacts={contacts} accountName={`${customer.firstName} ${customer.lastName}`.trim()}
              disabled={!canManage}
              onChange={(next) => set({ phones: draft.phones.map((item) => (item.slot === row.slot ? next : item)) })}
            />
          ))}
          {otherPhones(details.data?.channels ?? []).map((channel) => (
            <div key={channel.id} className="grid items-center gap-2 text-sm sm:grid-cols-[90px_1fr]">
              <span className="text-xs font-semibold text-slate-500">{channel.label || "Other"}</span>
              <a href={`tel:${channel.value.replace(/[^\d+]/g, "")}`} className="text-primary hover:underline">{channel.value}</a>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between">
            <span className="field-label">Email addresses</span>
            {canManage && (
              <button type="button" data-testid="add-email" onClick={() => set({ emails: [...draft.emails, { key: `n${Date.now()}`, channelId: null, value: "", contact: null, fromFlat: false, purposes: ["general"] }] })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                <Plus className="h-3.5 w-3.5" /> Add email
              </button>
            )}
          </div>
          {draft.emails.length === 0 && <p className="text-xs text-slate-400">No email on file.</p>}
          {draft.emails.map((row) => (
            <EmailSlot
              key={row.key} row={row} contacts={contacts} accountName={`${customer.firstName} ${customer.lastName}`.trim()}
              disabled={!canManage} onEmail={onEmail}
              onChange={(next) => set({ emails: draft.emails.map((item) => (item.key === row.key ? next : item)) })}
              onRemove={() => set({ emails: draft.emails.filter((item) => item.key !== row.key) })}
            />
          ))}
        </div>
      </Card>

      {/* ── Service address ───────────────────────────────────────────── */}
      <Card title="Service address" testId="sheet-addresses">
        <div className="space-y-3">
          {draft.addresses.map((row, index) => (
            <AddressSlot
              key={row.key} row={row} isMain={index === 0} disabled={!canManage}
              onChange={(next) => set({ addresses: draft.addresses.map((item) => (item.key === row.key ? next : item)) })}
              onRemove={row.propertyId == null && index > 0 ? () => set({ addresses: draft.addresses.filter((item) => item.key !== row.key) }) : undefined}
            />
          ))}
        </div>
        {canManage && (
          <button type="button" data-testid="add-location"
            onClick={() => set({ addresses: [...draft.addresses, { key: `n${Date.now()}`, propertyId: null, name: "", address: "", city: "", state: "", zip: "", isPrimary: false }] })}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add location
          </button>
        )}
        {/* Kyle #10: kept visible, toward the bottom of the information block. */}
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <Text label="County" value={draft.account.county} onChange={(v) => setAccount("county", v)} disabled={!canManage} />
          <Text label="Subdivision" value={draft.account.subdivision} onChange={(v) => setAccount("subdivision", v)} disabled={!canManage} />
          <Text label="Birthday" value={draft.account.birthday} onChange={(v) => setAccount("birthday", v)} disabled={!canManage} placeholder="MM/DD" />
        </div>
        <div className="mt-3">
          <label className="block">
            <span className="field-label">How did they hear about us?</span>
            <select aria-label="How did they hear about us?" className="input-lite mt-1 w-full sm:w-1/2" disabled={!canManage}
              value={draft.settings.marketingSource ?? ""} onChange={(e) => setSettings({ marketingSource: e.target.value || null })}>
              <option value="">Not set</option>
              {draft.settings.marketingSource && !catalog("marketingSources").includes(draft.settings.marketingSource) && (
                <option value={draft.settings.marketingSource}>{draft.settings.marketingSource}</option>
              )}
              {catalog("marketingSources").map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          {/* What was typed before the dropdown existed is shown, not lost. */}
          {customer.howHeard && !draft.settings.marketingSource && (
            <p className="mt-1 text-[11px] text-slate-400">Previously recorded as: {customer.howHeard}</p>
          )}
        </div>
      </Card>

      {/* ── Notes ─────────────────────────────────────────────────────── */}
      <Card title="Notes" testId="sheet-notes">
        <div className="grid gap-3 md:grid-cols-2">
          <Area label="General notes" value={draft.account.notes} onChange={(v) => setAccount("notes", v)} disabled={!canManage}
            hint={noteChange ? `Last changed by ${noteChange.performedBy ?? "someone"}, ${when(noteChange.createdAt)}` : undefined} />
          <Area label="Directions" value={draft.account.directions} onChange={(v) => setAccount("directions", v)} disabled={!canManage}
            hint="The crew sees these on the job." />
          <Area label="Specific notes" value={draft.account.specificNotes} onChange={(v) => setAccount("specificNotes", v)} disabled={!canManage} />
          <Area label="Callback notes" value={draft.account.callbackNotes} onChange={(v) => setAccount("callbackNotes", v)} disabled={!canManage} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Internal only — none of these notes is shown to the customer. Job, estimate and location notes are kept with their own records.
        </p>
      </Card>

      {/* ── Custom fields ─────────────────────────────────────────────── */}
      {draft.customFields.length > 0 && (
        <Card title="Custom fields" testId="sheet-custom-fields">
          <div className="space-y-2">
            {draft.customFields.map((field, index) => (
              <div key={field.fieldId ?? field.id ?? index} className="grid items-center gap-2 text-sm md:grid-cols-[190px_1fr]">
                <span className="text-xs font-semibold text-slate-600">{field.label ?? field.name ?? `Field ${index + 1}`}</span>
                <CustomFieldInput field={field} onChange={(value) => set({
                  customFields: draft.customFields.map((item, i) => (i === index ? { ...item, value } : item)),
                })} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── More details ──────────────────────────────────────────────── */}
      <section data-testid="sheet-more" className="rounded-2xl border border-slate-200 bg-white">
        <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}
          className="flex w-full items-center justify-between px-5 py-3 text-left">
          <span className="font-bold text-slate-900">More details</span>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
        </button>
        {moreOpen && (
          <div className="space-y-4 border-t border-slate-100 px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Pick label="Profile type" value={draft.settings.profileType} options={catalog("profileTypes")} onChange={(v) => setSettings({ profileType: v })} disabled={!canManage} />
              <Pick label="Profile group" value={draft.settings.profileGroup} options={catalog("profileGroups")} onChange={(v) => setSettings({ profileGroup: v })} disabled={!canManage} />
              <div>
                <Pick label="Payment terms" value={draft.settings.paymentTerms} options={catalog("paymentTerms")} onChange={(v) => setSettings({ paymentTerms: v })} disabled={!canManage} empty="Use company default" />
                {details.data?.paymentTermsSource === "company_default" && details.data.effectivePaymentTerms && (
                  <span className="block text-[10px] text-slate-400">Company default: {details.data.effectivePaymentTerms}</span>
                )}
              </div>
            </div>
            {canManageCatalogs && (
              <p className="text-[11px] text-slate-400">The options in these lists, and the custom fields themselves, are managed in Settings.</p>
            )}
            <div className="flex flex-wrap gap-4">
              {([["isNonProfit", "Non-profit"], ["taxExempt", "Tax exempt"], ["ccFeeExempt", "No card fee"]] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!canManage}
                    checked={Boolean(draft.settings[key])} onChange={(e) => setSettings({ [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Text label="Tags" value={draft.account.tags} onChange={(v) => setAccount("tags", v)} disabled={!canManage} placeholder="comma-separated" />
              <label className="block">
                <span className="field-label">Star rating</span>
                <select aria-label="Star rating" className="input-lite mt-1 w-full" disabled={!canManage}
                  value={draft.account.starRating ?? ""} onChange={(e) => setAccount("starRating", e.target.value ? Number(e.target.value) : null)}>
                  <option value="">None</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}
                </select>
              </label>
              <Text label="Prospect date" value={draft.account.prospectDate} onChange={(v) => setAccount("prospectDate", v)} disabled={!canManage} placeholder="YYYY-MM-DD" />
              <Text label="Alt. contact name" value={draft.account.altContact} onChange={(v) => setAccount("altContact", v)} disabled={!canManage} />
              <Text label="Alt. phone type" value={draft.account.altPhoneType} onChange={(v) => setAccount("altPhoneType", v)} disabled={!canManage} />
              <div>
                <span className="field-label">Customer since</span>
                <p className="mt-1 text-sm text-slate-700">{customer.customerDate || "—"}</p>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="field-label mb-2">Linked profiles</p>
              <MainProfileCard customerId={customer.id} mainProfile={customer.mainProfile ?? null}
                subProfiles={customer.subProfiles ?? []} canManage={canManage} onChanged={onSaved} />
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm">
              <div>
                <p className="field-label">Created by</p>
                <p className="text-slate-800">{stewardship.createdBy ?? "—"}</p>
                <p className="text-xs text-slate-500">{when(stewardship.createdAt)}</p>
              </div>
              <div>
                <p className="field-label">Last updated by</p>
                <p className="text-slate-800">{stewardship.updatedBy ?? "—"}</p>
                <p className="text-xs text-slate-500">{when(stewardship.updatedAt)}</p>
              </div>
            </div>
          </div>
        )}
      </section>
      </fieldset>

      {/* ── The one Update button, always in reach ─────────────────────── */}
      {canManage && (
        <div data-testid="update-bar" className="sticky bottom-3 z-20">
          <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-lg ${isDirty ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white/95"}`}>
            <div className="min-w-0">
              <p data-testid="update-summary" className={`text-sm font-semibold ${isDirty ? "text-amber-900" : "text-slate-500"}`}>
                {unsavedSummary(plan.dirty)}
              </p>
              {problems.map((problem) => <p key={problem} className="text-xs text-red-700">{problem}</p>)}
            </div>
            <div className="flex items-center gap-2">
              {isDirty && (
                <button type="button" onClick={discard} disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  <RotateCcw className="h-3.5 w-3.5" /> Discard
                </button>
              )}
              <button type="button" data-testid="update-button" onClick={update} disabled={!isDirty || saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-sm font-bold text-white shadow-sm disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving ? "Updating…" : "Update"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Card({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Text({ label, value, onChange, disabled, placeholder }: {
  label: string; value: string | number | null | undefined; onChange: (value: string) => void;
  disabled?: boolean; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input aria-label={label} className="input-lite mt-1 w-full" value={value ?? ""} placeholder={placeholder}
        disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Area({ label, value, onChange, disabled, hint }: {
  label: string; value: string | number | null | undefined; onChange: (value: string) => void;
  disabled?: boolean; hint?: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <textarea aria-label={label} rows={3} className="input-lite mt-1 w-full resize-y" value={value ?? ""}
        disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Pick({ label, value, options, onChange, disabled, empty = "Not set" }: {
  label: string; value: string | null | undefined; options: string[]; onChange: (value: string | null) => void;
  disabled?: boolean; empty?: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select aria-label={label} className="input-lite mt-1 w-full" value={value ?? ""} disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{empty}</option>
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

/** "Whose is it?" — the account holder, a named contact, or someone new. */
function Owner({ contact, newPerson, contacts, accountName, label, disabled, onChange }: {
  contact: ContactRef; newPerson?: PersonDraft; contacts: SheetContact[]; accountName: string; label: string;
  disabled?: boolean; onChange: (contact: ContactRef, newPerson?: PersonDraft) => void;
}) {
  const value = contact === "new" ? NEW_PERSON : contact == null ? "" : String(contact);
  return (
    <div className="space-y-1">
      <select aria-label={label} className="input-lite w-full" value={value} disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          if (next === NEW_PERSON) onChange("new", newPerson ?? { firstName: "", lastName: "" });
          else onChange(next ? Number(next) : null);
        }}>
        <option value="">{accountName || "Account holder"}</option>
        {contacts.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}
        <option value={NEW_PERSON}>+ Someone else…</option>
      </select>
      {contact === "new" && (
        <div className="grid grid-cols-2 gap-1">
          <input aria-label={`${label} first name`} className="input-lite" placeholder="First name" value={newPerson?.firstName ?? ""}
            onChange={(e) => onChange("new", { firstName: e.target.value, lastName: newPerson?.lastName ?? "" })} />
          <input aria-label={`${label} last name`} className="input-lite" placeholder="Last name" value={newPerson?.lastName ?? ""}
            onChange={(e) => onChange("new", { firstName: newPerson?.firstName ?? "", lastName: e.target.value })} />
        </div>
      )}
    </div>
  );
}

function PhoneSlot({ row, contacts, accountName, disabled, onChange }: {
  row: PhoneRow; contacts: SheetContact[]; accountName: string; disabled?: boolean; onChange: (row: PhoneRow) => void;
}) {
  const dial = row.value.replace(/[^\d+]/g, "");
  return (
    <div data-testid={`phone-${row.slot}`} className="grid items-start gap-2 sm:grid-cols-[70px_1fr_1fr_32px]">
      <span className="pt-2 text-xs font-semibold text-slate-500">{row.slot}</span>
      <input aria-label={`${row.slot} phone`} type="tel" inputMode="tel" className="input-lite w-full" placeholder="(555) 555-5555"
        value={row.value} disabled={disabled} onChange={(e) => onChange({ ...row, value: formatPhoneAsTyped(e.target.value) })} />
      <Owner label={`Whose ${row.slot} number`} contact={row.contact} newPerson={row.newPerson} contacts={contacts}
        accountName={accountName} disabled={disabled || !row.value.trim()}
        onChange={(contact, newPerson) => onChange({ ...row, contact, newPerson })} />
      {dial.length >= 7 ? (
        <a href={`tel:${dial}`} aria-label={`Call ${row.slot}`} title="Call"
          className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-primary hover:bg-primary/10">
          <Phone className="h-4 w-4" />
        </a>
      ) : <span />}
    </div>
  );
}

function EmailSlot({ row, contacts, accountName, disabled, onChange, onRemove, onEmail }: {
  row: EmailRow; contacts: SheetContact[]; accountName: string; disabled?: boolean;
  onChange: (row: EmailRow) => void; onRemove: () => void; onEmail?: (address: string) => void;
}) {
  const routing = routingChoiceFor(row.purposes ?? ["general"]);
  return (
    <div data-testid="email-row" className="grid items-start gap-2 sm:grid-cols-[1.3fr_1fr_150px_32px_28px]">
      <input aria-label="Email address" type="email" className="input-lite w-full" placeholder="name@example.com"
        value={row.value} disabled={disabled} onChange={(e) => onChange({ ...row, value: e.target.value })} />
      <Owner label="Whose email" contact={row.contact} newPerson={row.newPerson} contacts={contacts} accountName={accountName}
        disabled={disabled} onChange={(contact, newPerson) => onChange({ ...row, contact, newPerson })} />
      <select aria-label="Email routing" className="input-lite w-full" disabled={disabled} value={routing.key}
        onChange={(e) => onChange({ ...row, purposes: purposesForChoice(e.target.value) })}>
        {ROUTING_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
      </select>
      {/* Through Corstead's own Send Email: logged in the history, and it
          honours an unsubscribe. A mailto: link would do neither. */}
      {row.value.trim() && (row.channelId != null || row.fromFlat) && onEmail ? (
        <button type="button" aria-label={`Email ${row.value}`} title="Send email" onClick={() => onEmail(row.value.trim())}
          className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-primary hover:bg-primary/10">
          <Mail className="h-4 w-4" />
        </button>
      ) : <span />}
      {!disabled ? (
        <button type="button" aria-label={`Remove ${row.value || "email"}`} onClick={onRemove}
          className="mt-1 inline-flex h-8 w-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-50">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : <span />}
      {row.channelId != null && (
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 sm:col-span-5" title="Keep this address on the profile but stop sending to it">
          <input type="checkbox" className="h-3.5 w-3.5 accent-amber-600" disabled={disabled}
            aria-label={`Pause sending to ${row.value}`}
            checked={Boolean(row.sendingPaused)} onChange={(e) => onChange({ ...row, sendingPaused: e.target.checked })} />
          {row.sendingPaused
            ? <span className="text-amber-700">Sending to this address is paused.</span>
            : "Pause sending"}
        </label>
      )}
    </div>
  );
}

function AddressSlot({ row, isMain, disabled, onChange, onRemove }: {
  row: AddressRow; isMain: boolean; disabled?: boolean; onChange: (row: AddressRow) => void; onRemove?: () => void;
}) {
  const line = [row.address, row.city, row.state, row.zip].filter((part) => part.trim()).join(", ");
  const field = (key: "address" | "city" | "state" | "zip" | "name", label: string, className = "") => (
    <input aria-label={`${isMain ? "Main" : row.name || "Location"} ${label}`} className={`input-lite ${className}`} placeholder={label}
      value={row[key]} disabled={disabled} onChange={(e) => onChange({ ...row, [key]: e.target.value })} />
  );
  return (
    <div data-testid={isMain ? "address-main" : "address-other"} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-primary" />
        {isMain
          ? <span className="text-xs font-bold uppercase tracking-wide text-primary">Main</span>
          : field("name", "Location name (e.g. Mom's house)", "max-w-xs py-1 text-xs")}
        {line.length > 8 && (
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`} target="_blank" rel="noreferrer"
            className="ml-auto text-xs font-semibold text-primary hover:underline">Open in Maps</a>
        )}
        {onRemove && (
          <button type="button" aria-label="Remove this location" onClick={onRemove} className="ml-1 rounded p-1 text-red-500 hover:bg-red-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_70px_100px]">
        {field("address", "Street")}
        {field("city", "City")}
        {field("state", "State")}
        {field("zip", "Zip")}
      </div>
    </div>
  );
}
