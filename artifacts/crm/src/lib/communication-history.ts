/**
 * A6 (Kyle, Video 8): a profile's one communication history — every email,
 * text and letter, once each. The server builds the list and checks every
 * deletion; these helpers only shape what the screen shows.
 */
export type HistoryType = "email" | "text" | "letter";
export type HistoryFilter = "all" | HistoryType;

export interface HistoryItem {
  key: string;
  source: "email" | "message" | "delivery" | "letter";
  sourceId: number;
  type: HistoryType;
  title: string;
  to: string | null;
  address: string | null;
  by: string | null;
  at: string;
  status: string;
  related: { type: "quote" | "invoice" | "job"; id: number; label: string } | null;
  viewable: boolean;
  template: string | null;
}

export interface HistoryResponse {
  items: HistoryItem[];
  counts: Record<HistoryFilter, number>;
  canDelete: boolean;
}

export interface HistoryDetail extends HistoryItem {
  bodyHtml?: string;
  body?: string;
  subject?: string | null;
  recipientLines?: string[];
  error?: string | null;
}

export const FILTERS: Array<{ key: HistoryFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "email", label: "Emails" },
  { key: "text", label: "Texts" },
  { key: "letter", label: "Letters" },
];

const STATUS_WORDS: Record<string, string> = {
  sent: "Sent", failed: "Failed", pending: "Sending", printed: "Printed", delivered: "Delivered",
  provider_unconfigured: "Not sent — no provider", not_dispatched: "Not sent", skipped: "Not sent", blocked: "Blocked", queued: "Queued",
};
export const statusLabel = (status: string) => STATUS_WORDS[status] ?? status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const statusTone = (status: string): "good" | "bad" | "wait" | "plain" =>
  status === "sent" || status === "printed" || status === "delivered" ? "good"
    : status === "failed" || status === "blocked" ? "bad"
      : status === "pending" || status === "queued" ? "wait" : "plain";

/** Where the related record opens. */
export const relatedHref = (related: NonNullable<HistoryItem["related"]>) =>
  `/${related.type === "quote" ? "quotes" : related.type === "invoice" ? "invoices" : "jobs"}/${related.id}`;

/** "Delete 3 entries?" — the words of the confirm. */
export function deleteQuestion(count: number): string {
  return count === 1 ? "Delete this entry from the history?" : `Delete ${count} entries from the history?`;
}

/** The keys still on screen after a reload: a selection never names an entry that is gone. */
export function keepSelection(selected: ReadonlySet<string>, items: readonly HistoryItem[]): Set<string> {
  const present = new Set(items.map((item) => item.key));
  return new Set([...selected].filter((key) => present.has(key)));
}
