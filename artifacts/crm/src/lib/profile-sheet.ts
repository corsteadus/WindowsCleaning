/**
 * The one-page profile — the redesign Kyle asked for in Videos 1–3 and his
 * answers of 2026-10-19 and 2026-10-21.
 *
 * Everything the office uses daily sits on one page, always editable, and one
 * **Update** button saves it. Behind that button sit several existing,
 * already-tested endpoints (the account, its settings, its phone and email
 * channels, its addresses, its custom fields). This file decides, from what
 * was loaded and what is on screen now, **which of them need calling and with
 * what** — and nothing else, so it can be tested without a browser.
 *
 * Two rules run through it:
 *
 *  - **Send only what changed.** An untouched section is not saved, so one
 *    person's edit cannot overwrite another's unrelated change.
 *  - **Lose nothing.** A profile from before the redesign keeps its numbers in
 *    the old flat columns and has no channels. Those numbers are shown in
 *    their slots, and only become channels when someone edits them.
 */

export type ContactRef = number | null | "new";

export interface ChannelLike {
  id: number;
  type: "email" | "phone";
  label?: string | null;
  value: string;
  contactId?: number | null;
  purposes?: string[];
  sendingPaused?: boolean;
}

export interface FlatContactValues {
  homePhone?: string | null;
  workPhone?: string | null;
  cellPhone?: string | null;
  altPhone?: string | null;
  fax?: string | null;
  email?: string | null;
}

export type FlatField = keyof FlatContactValues;

/** Kyle's six phones, in his order. Must match lib/contact-mirror.ts on the server. */
export const PHONE_SLOTS: ReadonlyArray<{ label: string; flat: FlatField | null }> = [
  { label: "Home", flat: "homePhone" },
  { label: "Work", flat: "workPhone" },
  { label: "Cell", flat: "cellPhone" },
  { label: "Cell 2", flat: null },
  { label: "Alt", flat: "altPhone" },
  { label: "Fax", flat: "fax" },
];

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

export function slotLabelOf(label: string | null | undefined): string | null {
  return PHONE_SLOTS.find((slot) => norm(slot.label) === norm(label))?.label ?? null;
}

export interface PersonDraft { firstName: string; lastName: string }

export interface PhoneRow {
  slot: string;
  channelId: number | null;
  value: string;
  contact: ContactRef;
  newPerson?: PersonDraft;
  /** The value came from the old flat column, not a channel. */
  fromFlat: boolean;
}

export interface EmailRow {
  key: string;
  channelId: number | null;
  value: string;
  contact: ContactRef;
  newPerson?: PersonDraft;
  fromFlat: boolean;
  sendingPaused?: boolean;
  /** Kyle #7's routing for this address. Absent means the default, General. */
  purposes?: string[];
}

const DEFAULT_PURPOSES = ["general"];
const samePurposes = (a: string[] | undefined, b: string[] | undefined) =>
  [...(a ?? DEFAULT_PURPOSES)].sort().join("+") === [...(b ?? DEFAULT_PURPOSES)].sort().join("+");

/** The six slots, filled from channels first and the old columns second. */
export function phoneRowsFrom(channels: readonly ChannelLike[], flat: FlatContactValues): PhoneRow[] {
  return PHONE_SLOTS.map((slot) => {
    const channel = channels
      .filter((item) => item.type === "phone" && slotLabelOf(item.label) === slot.label)
      .sort((a, b) => a.id - b.id)[0];
    if (channel) {
      return { slot: slot.label, channelId: channel.id, value: channel.value, contact: channel.contactId ?? null, fromFlat: false };
    }
    const legacy = slot.flat ? (flat[slot.flat] ?? "") : "";
    return { slot: slot.label, channelId: null, value: legacy ?? "", contact: null, fromFlat: Boolean(legacy) };
  });
}

/**
 * Phones that are not one of the six — "Office", a second "Home". Nothing is
 * thrown away: they are listed under the slots, and remain editable where they
 * always were.
 */
export function otherPhones(channels: readonly ChannelLike[]): ChannelLike[] {
  const used = new Set<number>();
  for (const slot of PHONE_SLOTS) {
    const first = channels
      .filter((item) => item.type === "phone" && slotLabelOf(item.label) === slot.label)
      .sort((a, b) => a.id - b.id)[0];
    if (first) used.add(first.id);
  }
  return channels.filter((item) => item.type === "phone" && !used.has(item.id));
}

/**
 * Every email, with its person. The old single column comes first whenever no
 * channel holds it: on a profile from before the redesign it is the account's
 * own address, and adding a second one must not hide it.
 */
export function emailRowsFrom(channels: readonly ChannelLike[], flat: FlatContactValues): EmailRow[] {
  const emails = channels.filter((item) => item.type === "email").sort((a, b) => a.id - b.id);
  const rows: EmailRow[] = emails.map((item) => ({
    key: `c${item.id}`, channelId: item.id, value: item.value,
    contact: item.contactId ?? null, fromFlat: false, sendingPaused: item.sendingPaused,
    purposes: item.purposes ?? DEFAULT_PURPOSES,
  }));
  const legacy = (flat.email ?? "").trim();
  if (legacy && !emails.some((item) => sameEmail(item.value, legacy))) {
    rows.unshift({ key: "flat", channelId: null, value: legacy, contact: null, fromFlat: true, purposes: DEFAULT_PURPOSES });
  }
  return rows;
}

export type ChannelOp =
  | { kind: "create"; type: "phone" | "email"; label: string; value: string; contact: ContactRef; newPerson?: PersonDraft; rowKey: string; purposes?: string[] }
  | { kind: "update"; id: number; value: string; contact: ContactRef; newPerson?: PersonDraft; rowKey: string; purposes?: string[]; sendingPaused?: boolean }
  | { kind: "remove"; id: number; rowKey: string };

export interface ContactPlan {
  ops: ChannelOp[];
  /** Old flat columns cleared directly, for a number that never became a channel. */
  flatClear: Partial<Record<FlatField, null>>;
}

const sameContact = (a: ContactRef, b: ContactRef) => a === b;
const samePhone = (a: string, b: string) => digits(a) === digits(b);
const sameEmail = (a: string, b: string) => norm(a) === norm(b);

/** What must happen to the phones and emails for the screen to become true. */
export function contactPlan(input: {
  phonesBefore: readonly PhoneRow[];
  phonesAfter: readonly PhoneRow[];
  emailsBefore: readonly EmailRow[];
  emailsAfter: readonly EmailRow[];
}): ContactPlan {
  const ops: ChannelOp[] = [];
  const flatClear: Partial<Record<FlatField, null>> = {};

  for (const after of input.phonesAfter) {
    const before = input.phonesBefore.find((row) => row.slot === after.slot);
    if (!before) continue;
    const value = after.value.trim();
    const changedValue = !samePhone(before.value, value);
    const changedContact = !sameContact(before.contact, after.contact);
    const rowKey = `phone:${after.slot}`;
    if (before.channelId != null) {
      if (!value) ops.push({ kind: "remove", id: before.channelId, rowKey });
      else if (changedValue || changedContact) {
        ops.push({ kind: "update", id: before.channelId, value, contact: after.contact, newPerson: after.newPerson, rowKey });
      }
    } else if (value && (changedValue || changedContact || after.contact === "new")) {
      ops.push({ kind: "create", type: "phone", label: after.slot, value, contact: after.contact, newPerson: after.newPerson, rowKey });
    } else if (!value && before.fromFlat) {
      const flat = PHONE_SLOTS.find((slot) => slot.label === after.slot)?.flat;
      if (flat) flatClear[flat] = null;
    }
  }

  for (const before of input.emailsBefore) {
    const after = input.emailsAfter.find((row) => row.key === before.key);
    const rowKey = `email:${before.key}`;
    const value = after?.value.trim() ?? "";
    if (!after || !value) {
      if (before.channelId != null) ops.push({ kind: "remove", id: before.channelId, rowKey });
      else if (before.fromFlat) flatClear.email = null;
      continue;
    }
    const changed = !sameEmail(before.value, value) || !sameContact(before.contact, after.contact)
      || !samePurposes(before.purposes, after.purposes);
    // Pausing keeps the address on the profile and stops sending to it, as the
    // old Profile Details tab allowed. Only a saved address can be paused.
    const pauseChanged = before.channelId != null && Boolean(before.sendingPaused) !== Boolean(after.sendingPaused);
    if (!changed && !pauseChanged) continue;
    const purposes = after.purposes ?? DEFAULT_PURPOSES;
    if (before.channelId != null) {
      ops.push({
        kind: "update", id: before.channelId, value, contact: after.contact, newPerson: after.newPerson, rowKey, purposes,
        ...(pauseChanged ? { sendingPaused: Boolean(after.sendingPaused) } : {}),
      });
    } else {
      ops.push({ kind: "create", type: "email", label: "Email", value, contact: after.contact, newPerson: after.newPerson, rowKey, purposes });
    }
  }
  for (const after of input.emailsAfter) {
    if (input.emailsBefore.some((row) => row.key === after.key)) continue;
    const value = after.value.trim();
    if (!value) continue;
    ops.push({
      kind: "create", type: "email", label: "Email", value, contact: after.contact,
      newPerson: after.newPerson, rowKey: `email:${after.key}`, purposes: after.purposes ?? DEFAULT_PURPOSES,
    });
  }

  // A legacy email that is being turned into a channel must not also be
  // cleared: the server's mirror writes the new value over it.
  if (flatClear.email === null && ops.some((op) => op.kind === "create" && op.type === "email")) {
    delete flatClear.email;
  }
  return { ops, flatClear };
}

// ─── Addresses ────────────────────────────────────────────────────────────────

export interface AddressRow {
  key: string;
  propertyId: number | null;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary: boolean;
}

export const ADDRESS_FIELDS = ["name", "address", "city", "state", "zip"] as const;
type AddressField = (typeof ADDRESS_FIELDS)[number];

export type AddressOp =
  | { kind: "create"; key: string; data: Pick<AddressRow, AddressField> & { isPrimary: boolean } }
  | { kind: "update"; key: string; propertyId: number; data: Partial<Pick<AddressRow, AddressField>> };

/** A new or edited address needs a street, city, state and zip; a name is optional. */
export function addressProblems(row: AddressRow): string[] {
  const missing = (["address", "city", "state", "zip"] as const).filter((field) => !row[field].trim());
  return missing.length ? [`${row.name.trim() || "Address"} needs ${missing.join(", ")}`] : [];
}

export function addressPlan(before: readonly AddressRow[], after: readonly AddressRow[]): {
  ops: AddressOp[]; problems: string[];
} {
  const ops: AddressOp[] = [];
  const problems: string[] = [];
  for (const row of after) {
    const original = before.find((item) => item.key === row.key);
    if (!original || original.propertyId == null) {
      const blank = ADDRESS_FIELDS.every((field) => !row[field].trim());
      if (blank) continue;
      problems.push(...addressProblems(row));
      ops.push({
        kind: "create", key: row.key,
        data: { name: row.name.trim(), address: row.address.trim(), city: row.city.trim(), state: row.state.trim(), zip: row.zip.trim(), isPrimary: row.isPrimary },
      });
      continue;
    }
    const data: Partial<Pick<AddressRow, AddressField>> = {};
    for (const field of ADDRESS_FIELDS) {
      if (row[field].trim() !== original[field].trim()) data[field] = row[field].trim();
    }
    if (Object.keys(data).length) {
      problems.push(...addressProblems(row));
      ops.push({ kind: "update", key: row.key, propertyId: original.propertyId, data });
    }
  }
  return { ops, problems };
}

// ─── The account's own fields ─────────────────────────────────────────────────

/**
 * Fields the Update button may write onto the account. Phones and email are
 * not here — they go through their channels — and nor are the flags or the
 * residential/commercial choice, which the settings save owns. One field, one
 * path: two paths writing the same column is how the old screen came to have
 * four kinds of Save.
 */
export const ACCOUNT_FIELDS = [
  "salutation", "firstName", "lastName", "companyName",
  "county", "subdivision", "birthday",
  "notes", "directions", "specificNotes", "callbackNotes",
  "tags", "starRating", "prospectDate",
  // Older single-value fields, superseded by naming each number but kept, and
  // still editable under More Details: nothing that worked is taken away.
  "altContact", "altPhoneType",
] as const;
export type AccountField = (typeof ACCOUNT_FIELDS)[number];

export function accountPatch(
  before: Partial<Record<AccountField, unknown>>,
  after: Partial<Record<AccountField, unknown>>,
): Partial<Record<AccountField, unknown>> {
  const patch: Partial<Record<AccountField, unknown>> = {};
  const same = (a: unknown, b: unknown) => (a ?? "") === (b ?? "")
    || (typeof a === "string" && typeof b === "string" && a.trim() === b.trim());
  for (const field of ACCOUNT_FIELDS) {
    if (!(field in after)) continue;
    if (!same(before[field], after[field])) {
      const value = after[field];
      patch[field] = typeof value === "string" ? (value.trim() === "" ? null : value.trim()) : value;
    }
  }
  return patch;
}

// ─── The whole Update ─────────────────────────────────────────────────────────

export type UpdateStep = "people" | "account" | "settings" | "contact" | "addresses" | "customFields";

/**
 * The order the Update runs in. People first, because a phone may belong to a
 * person who does not exist yet; the account before its settings, because the
 * settings save is a full replacement and must see the latest; and only the
 * steps with something to do.
 */
export function updateSteps(dirty: Partial<Record<UpdateStep, boolean>>): UpdateStep[] {
  const order: UpdateStep[] = ["people", "account", "settings", "contact", "addresses", "customFields"];
  return order.filter((step) => dirty[step]);
}

/** What the sticky bar says, in plain words. */
export function unsavedSummary(dirty: Partial<Record<UpdateStep, boolean>>): string {
  const names: Record<UpdateStep, string> = {
    people: "contacts", account: "details", settings: "account settings",
    contact: "phones and emails", addresses: "addresses", customFields: "custom fields",
  };
  const changed = updateSteps(dirty).filter((step) => step !== "people").map((step) => names[step]);
  if (!changed.length) return "No unsaved changes";
  if (changed.length === 1) return `Unsaved changes: ${changed[0]}`;
  return `Unsaved changes: ${changed.slice(0, -1).join(", ")} and ${changed.at(-1)}`;
}
