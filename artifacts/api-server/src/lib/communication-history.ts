/**
 * One communication history — A6 (Kyle, Video 8): "we can see what the
 * communication has been for this customer … click on a link, and a screen pops
 * up that shows the actual email we sent out."
 *
 * Each message is recorded where it was sent from, and an email in up to three
 * places (email_logs with its content, a redacted message_logs line, an
 * activity line). The history takes each message once, from the record that
 * holds it best:
 *   email     email_logs — every email Corstead sent or tried to send
 *   message   message_logs — texts, and automatic emails that never went out
 *             (an email that went out or failed is already in email_logs)
 *   delivery  estimate_delivery_requests made before per-recipient links (A2);
 *             later ones also wrote an email_log
 *   letter    printed_letters
 * Pure: the route reads the rows, this shapes them.
 */
import { emailHistoryEntry, type CampaignRow, type EmailLogRow } from "./email-history.ts";

export const HISTORY_SOURCES = ["email", "message", "delivery", "letter"] as const;
export type HistorySource = (typeof HISTORY_SOURCES)[number];
export type HistoryType = "email" | "text" | "letter";
export const MAX_DELETE_AT_ONCE = 200;

export interface HistoryItem {
  /** "email:12" — stable across reloads, and what a deletion names. */
  key: string;
  source: HistorySource;
  sourceId: number;
  type: HistoryType;
  title: string;
  to: string | null;
  /** The bare address or number, for Resend. */
  address: string | null;
  by: string | null;
  at: string;
  status: string;
  related: { type: "quote" | "invoice" | "job"; id: number; label: string } | null;
  /** Whether "View" can show the message itself (a redacted line cannot). */
  viewable: boolean;
  template: string | null;
}

export type RelatedLabels = { quote: Map<number, string>; invoice: Map<number, string>; job: Map<number, string> };

const relatedOf = (type: string | null, id: number | null, labels: RelatedLabels): HistoryItem["related"] => {
  if ((type !== "quote" && type !== "invoice" && type !== "job") || id == null) return null;
  const number = labels[type].get(id);
  const noun = type === "quote" ? "Estimate" : type === "invoice" ? "Invoice" : "Job";
  return { type, id, label: number ? `${noun} ${number}` : `${noun} #${id}` };
};
const iso = (value: Date | string | null | undefined, fallback: Date | string) => {
  const date = new Date(value ?? fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
};

export function emailItem(log: EmailLogRow & { relatedType: string | null; relatedId: number | null }, campaign: CampaignRow | undefined, labels: RelatedLabels): HistoryItem {
  const entry = emailHistoryEntry(log, campaign);
  return {
    key: `email:${log.id}`, source: "email", sourceId: log.id, type: "email",
    title: log.subject, to: entry.toName ? `${entry.toName} <${entry.to}>` : entry.to, address: entry.to, by: entry.sender,
    at: entry.at, status: log.status, related: relatedOf(log.relatedType, log.relatedId, labels),
    viewable: true, template: log.templateName,
  };
}

export interface MessageRow {
  id: number; channel: string; triggerType: string; relatedType: string | null; relatedId: number | null;
  recipient: string | null; subject: string | null; body: string; status: string; sentAt: string | null; createdAt: Date;
}
const TRIGGER_WORDS: Record<string, string> = {
  manual: "Sent from Corstead", estimate_accepted: "Estimate accepted", estimate_sent: "Estimate sent",
  job_scheduled: "Appointment scheduled", job_completed: "Job completed", invoice_sent: "Invoice sent", payment_received: "Payment received",
};
const triggerTitle = (trigger: string) => TRIGGER_WORDS[trigger] ?? trigger.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Texts, and automatic emails that never reached email_logs; null for one the history takes from email_logs. */
export function messageItem(row: MessageRow, labels: RelatedLabels): HistoryItem | null {
  const isEmail = row.channel === "email";
  if (isEmail && (row.status === "sent" || row.status === "failed")) return null;
  if (!isEmail && row.channel !== "sms") return null;
  return {
    key: `message:${row.id}`, source: "message", sourceId: row.id, type: isEmail ? "email" : "text",
    title: row.subject?.trim() || triggerTitle(row.triggerType), to: row.recipient, address: null,
    by: row.triggerType === "manual" ? null : "Automatic",
    at: iso(row.sentAt, row.createdAt), status: row.status, related: relatedOf(row.relatedType, row.relatedId, labels),
    viewable: row.body !== "[redacted]" && row.body.trim().length > 0, template: null,
  };
}

export interface DeliveryRow {
  id: number; quoteId: number; channel: string; recipient: string; status: string; requestedBy: string | null; requestedAt: Date; openKeyHash: string | null;
}
/** Only the older delivery requests; a later one is the same email as its email_log. */
export function deliveryItem(row: DeliveryRow, labels: RelatedLabels, names: Map<string, string>): HistoryItem | null {
  if (row.openKeyHash) return null;
  const related = relatedOf("quote", row.quoteId, labels);
  return {
    key: `delivery:${row.id}`, source: "delivery", sourceId: row.id, type: row.channel === "sms" ? "text" : "email",
    title: related?.label ?? "Estimate", to: row.recipient, address: row.recipient, by: row.requestedBy ? names.get(row.requestedBy) ?? null : null,
    at: row.requestedAt.toISOString(), status: row.status, related, viewable: false, template: null,
  };
}

export interface LetterRow { id: number; templateName: string | null; subject: string | null; recipientLines: string[]; printedBy: string | null; printedAt: Date }
export function letterItem(row: LetterRow): HistoryItem {
  return {
    key: `letter:${row.id}`, source: "letter", sourceId: row.id, type: "letter",
    title: row.subject?.trim() || row.templateName || "Letter", to: row.recipientLines.slice(1).join(", ") || row.recipientLines[0] || null, address: null,
    by: row.printedBy, at: row.printedAt.toISOString(), status: "printed", related: null, viewable: true, template: row.templateName,
  };
}

export interface HistoryFilter { type?: HistoryType | null; q?: string | null }

/** Newest first, without the deleted, narrowed by type and by words in the title, address or sender. */
export function historyOf(items: Array<HistoryItem | null>, deleted: ReadonlySet<string>, filter: HistoryFilter = {}): HistoryItem[] {
  const words = (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return items
    .filter((item): item is HistoryItem => item != null && !deleted.has(item.key))
    .filter((item) => !filter.type || item.type === filter.type)
    .filter((item) => {
      if (!words.length) return true;
      const haystack = [item.title, item.to, item.by, item.template, item.related?.label].filter(Boolean).join(" ").toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key));
}

export const historyTypeOf = (value: unknown): HistoryType | null =>
  value === "email" || value === "text" || value === "letter" ? value : null;

/** The entries named for deletion, checked: known sources, whole ids, no repeats, at most 200. */
export function deletionTargets(raw: unknown): { targets: Array<{ source: HistorySource; sourceId: number }> } | { error: string } {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) return { error: "Choose what to delete" };
  if (list.length > MAX_DELETE_AT_ONCE) return { error: `Delete at most ${MAX_DELETE_AT_ONCE} at once` };
  const seen = new Set<string>();
  const targets: Array<{ source: HistorySource; sourceId: number }> = [];
  for (const entry of list) {
    const match = typeof entry === "string" ? /^(email|message|delivery|letter):(\d+)$/.exec(entry) : null;
    if (!match) return { error: "That history entry does not exist" };
    if (seen.has(entry as string)) continue;
    seen.add(entry as string);
    targets.push({ source: match[1] as HistorySource, sourceId: Number(match[2]) });
  }
  return { targets };
}
