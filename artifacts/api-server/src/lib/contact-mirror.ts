/**
 * Keep the profile's old flat phone and email columns in step with its
 * contact channels — the profile redesign, decided 2026-10-21.
 *
 * Two models were holding the same facts. The flat columns on `customers`
 * (`homePhone`, `cellPhone`, `email`, …) are what sending, search, the
 * duplicate check, the legacy import and the crew's phone lookup all read.
 * The `contact_channels` rows are what can say whose number it is, hold more
 * than one email, carry routing (#7) and be switched off (#6) — and nothing
 * that sends read them.
 *
 * Kyle asked for six fixed phones, each naming whose number it is, and
 * several emails with names. Only the channels can hold that, so they became
 * the source, and this keeps the flat columns a faithful copy of them. That
 * way nothing that reads the old columns had to change.
 *
 * The slot is decided by the channel's label. A channel labelled anything
 * else ("Office") is kept and shown, but has no flat column to copy into.
 */

export interface MirrorChannel {
  id: number;
  channelType: string;
  label: string | null;
  value: string;
  isPrimary?: boolean | null;
  archivedAt?: Date | string | null;
}

export type FlatContactField = "homePhone" | "workPhone" | "cellPhone" | "altPhone" | "fax" | "email";
export type FlatContact = Partial<Record<FlatContactField, string | null>>;

/** Kyle's six phones, in his order. "Cell 2" has no flat column of its own. */
export const PHONE_SLOTS: ReadonlyArray<{ label: string; flat: FlatContactField | null }> = [
  { label: "Home", flat: "homePhone" },
  { label: "Work", flat: "workPhone" },
  { label: "Cell", flat: "cellPhone" },
  { label: "Cell 2", flat: null },
  { label: "Alt", flat: "altPhone" },
  { label: "Fax", flat: "fax" },
];

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/** "home", "Home " and "HOME" are one slot; anything else is not a slot. */
export function slotLabelOf(label: string | null | undefined): string | null {
  const wanted = norm(label);
  return PHONE_SLOTS.find((slot) => norm(slot.label) === wanted)?.label ?? null;
}

const active = (channel: MirrorChannel) => !channel.archivedAt;
const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
const sameValue = (field: FlatContactField, a: string | null | undefined, b: string | null | undefined) =>
  field === "email" ? norm(a) === norm(b) : digits(a) === digits(b) && digits(a) !== "";

/** The email the account is reached on: the primary one, else the oldest. */
export function mainEmail(channels: readonly MirrorChannel[]): MirrorChannel | null {
  const emails = channels
    .filter((channel) => active(channel) && channel.channelType === "email" && channel.value.trim())
    .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) || a.id - b.id);
  return emails[0] ?? null;
}

/**
 * What to write onto `customers` after a change to its channels.
 *
 * - A slot with a channel copies that channel's value.
 * - A slot with no channel is **left alone** — a profile from before the
 *   redesign still has its flat numbers and no channels, and they must not
 *   be wiped by an unrelated edit.
 * - The one exception: when the channel just removed was the slot's only
 *   source and the flat column still holds exactly its value, the column is
 *   cleared too. Otherwise a number the office deleted would come back.
 *
 * Only fields that actually change are returned.
 */
export function mirrorPatch(input: {
  channels: readonly MirrorChannel[];
  customer: FlatContact;
  removed?: MirrorChannel | null;
}): FlatContact {
  const patch: FlatContact = {};
  const live = input.channels.filter(active);
  const removed = input.removed ?? null;

  for (const slot of PHONE_SLOTS) {
    if (!slot.flat) continue;
    const field = slot.flat;
    const match = live
      .filter((channel) => channel.channelType === "phone" && slotLabelOf(channel.label) === slot.label)
      .sort((a, b) => a.id - b.id)[0];
    const current = input.customer[field] ?? null;
    if (match) {
      if (!sameValue(field, current, match.value)) patch[field] = match.value.trim();
    } else if (
      removed && removed.channelType === "phone" && slotLabelOf(removed.label) === slot.label
      && current && sameValue(field, current, removed.value)
    ) {
      patch[field] = null;
    }
  }

  const email = mainEmail(live);
  const currentEmail = input.customer.email ?? null;
  // An account email that no channel holds, and that was not just edited or
  // removed, is a profile's own address from before the redesign. Adding a
  // second address (a spouse's) must not replace it.
  const ownLegacyEmail = Boolean(currentEmail?.trim())
    && !live.some((channel) => channel.channelType === "email" && sameValue("email", currentEmail, channel.value))
    && !(removed && removed.channelType === "email" && sameValue("email", currentEmail, removed.value));
  if (email && !ownLegacyEmail) {
    if (!sameValue("email", currentEmail, email.value)) patch.email = email.value.trim();
  } else if (
    !email && removed && removed.channelType === "email" && currentEmail && sameValue("email", currentEmail, removed.value)
  ) {
    patch.email = null;
  }

  return patch;
}
