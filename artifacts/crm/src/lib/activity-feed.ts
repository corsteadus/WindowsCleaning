/**
 * One feed of everything that has happened on a profile.
 *
 * Kyle (Random Edits #5 and #6) asked for a single "Communication & Activity"
 * tab: every email and text sent from Corstead, and who did what to the
 * profile, newest first, filterable by All / Email / Text / Profile changes.
 * The profile already carries both lists; this merges them.
 */

export type FeedKind = "email" | "text" | "change";
export type FeedFilter = "all" | "email" | "text" | "change";

export interface MessageEntry {
  id: number;
  channel: string;
  triggerType?: string | null;
  subject?: string | null;
  recipient?: string | null;
  status?: string | null;
  relatedType?: string | null;
  relatedId?: number | null;
  sentAt?: string | null;
  createdAt: string;
}

export interface ChangeEntry {
  id: number;
  action: string;
  fromValue?: string | null;
  toValue?: string | null;
  note?: string | null;
  reason?: string | null;
  performedBy?: string | null;
  createdAt: string;
}

export interface FeedItem {
  key: string;
  kind: FeedKind;
  /** ISO time the item happened; a message uses when it was sent. */
  at: string;
  title: string;
  detail: string | null;
  /** The person, when Corstead knows who. A customer's own reply has none. */
  actor: string | null;
  /** The estimate, job or invoice it belongs to, when it belongs to one. */
  related: { type: string; id: number } | null;
  /** Delivery state, for messages only. */
  status: string | null;
}

const CHANNEL_KIND: Record<string, FeedKind> = {
  email: "email",
  sms: "text",
  text: "text",
};

/** "Estimate #1042 sent" rather than "estimate_sent". */
export function humanAction(action: string): string {
  const words = action.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Updated";
}

function messageTitle(message: MessageEntry): string {
  const channel = CHANNEL_KIND[message.channel] === "text" ? "Text" : "Email";
  const purpose = message.triggerType ? humanAction(message.triggerType) : null;
  return purpose ? `${channel}: ${purpose}` : channel;
}

export function feedFromMessage(message: MessageEntry): FeedItem {
  return {
    key: `message-${message.id}`,
    kind: CHANNEL_KIND[message.channel] ?? "email",
    at: message.sentAt ?? message.createdAt,
    title: messageTitle(message),
    detail: [message.subject, message.recipient].filter(Boolean).join(" · ") || null,
    actor: null,
    related: message.relatedType && message.relatedId
      ? { type: message.relatedType, id: message.relatedId }
      : null,
    status: message.status ?? null,
  };
}

export function feedFromChange(change: ChangeEntry): FeedItem {
  const movement = change.fromValue && change.toValue && change.fromValue !== change.toValue
    ? `${change.fromValue} → ${change.toValue}`
    : change.toValue ?? null;
  return {
    key: `change-${change.id}`,
    kind: "change",
    at: change.createdAt,
    title: humanAction(change.action),
    detail: [change.note, movement, change.reason].filter(Boolean).join(" · ") || null,
    actor: change.performedBy ?? null,
    related: null,
    status: null,
  };
}

const time = (value: string | null | undefined): number => {
  if (!value) return 0;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? 0 : at.getTime();
};

export function buildActivityFeed(
  messages: readonly MessageEntry[] = [],
  changes: readonly ChangeEntry[] = [],
): FeedItem[] {
  return [...messages.map(feedFromMessage), ...changes.map(feedFromChange)]
    .sort((a, b) => time(b.at) - time(a.at) || b.key.localeCompare(a.key));
}

export function filterFeed(items: readonly FeedItem[], filter: FeedFilter): FeedItem[] {
  return filter === "all" ? [...items] : items.filter((item) => item.kind === filter);
}

export function countFeed(items: readonly FeedItem[]): Record<FeedFilter, number> {
  return {
    all: items.length,
    email: items.filter((item) => item.kind === "email").length,
    text: items.filter((item) => item.kind === "text").length,
    change: items.filter((item) => item.kind === "change").length,
  };
}

/**
 * Who created the profile and who touched it last (Random Edits #6, shown on
 * Overview). Taken from the recorded history, so it needs no new columns.
 */
export function profileStewardship(
  changes: readonly ChangeEntry[],
  fallback: { createdAt?: string | null; updatedAt?: string | null } = {},
): { createdBy: string | null; createdAt: string | null; updatedBy: string | null; updatedAt: string | null } {
  const ordered = [...changes].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  const withActor = ordered.filter((change) => change.performedBy);
  const first = withActor[0] ?? null;
  const last = withActor[withActor.length - 1] ?? null;
  return {
    createdBy: first?.performedBy ?? null,
    createdAt: fallback.createdAt ?? ordered[0]?.createdAt ?? null,
    updatedBy: last?.performedBy ?? null,
    updatedAt: fallback.updatedAt ?? ordered[ordered.length - 1]?.createdAt ?? null,
  };
}

/** The last time someone touched the general notes, and who (Random Edits #3). */
export function lastNoteChange(changes: readonly ChangeEntry[]): ChangeEntry | null {
  const notes = changes
    .filter((change) => change.action === "note_updated" || change.action === "note_added")
    .filter((change) => !change.note || /general/i.test(change.note))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt));
  return notes[0] ?? null;
}
