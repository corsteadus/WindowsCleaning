/**
 * How the scheduling queue reads on screen.
 *
 * Kept apart from the fetching so it can be unit-tested: this module has no
 * `fetch`, no `import.meta`, and no React, which is the same split
 * `calendar-totals.ts` makes for the month grid.
 */

/** Mirrors the server's `QUEUE_STATUSES`. The endpoint also serves this list. */
export const QUEUE_STATUS_LABELS: Record<string, string> = {
  needs_contact: "Needs Contact",
  contacted: "Contacted",
  callback_scheduled: "Callback Scheduled",
  waiting_on_customer: "Waiting on Customer",
  waiting_on_materials: "Waiting on Materials",
  weather_hold: "Weather Hold",
  ready_to_schedule: "Ready to Schedule",
};

/**
 * Spec §4.3 asks for plain language in place of the reference system's
 * abbreviations. An unknown value is title-cased rather than hidden, so a
 * reason added server-side still reads as words before the UI catches up.
 */
export function queueStatusLabel(status: string | null | undefined): string {
  if (!status) return "No status";
  return QUEUE_STATUS_LABELS[status]
    ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const QUEUE_TABS = [
  { key: "ready", label: "Ready to Schedule" },
  { key: "on_hold", label: "On Hold" },
  { key: "due", label: "Repeat Service Due" },
] as const;

export type QueueTabKey = (typeof QUEUE_TABS)[number]["key"];

export function isQueueTabKey(value: unknown): value is QueueTabKey {
  return QUEUE_TABS.some((tab) => tab.key === value);
}

/**
 * How long a job has been waiting, spec §4.2.
 *
 * Zero is "Today" rather than "0 days" — a card that has just arrived should
 * not read like a counter that failed.
 */
export function waitingLabel(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/**
 * Waiting badges escalate with age so a stale job is visible without reading.
 *
 * The thresholds are a week and a month, which match how an office actually
 * talks about a neglected job. They are not in the spec; change them freely.
 */
export function waitingTone(days: number): "fresh" | "aging" | "stale" {
  if (days >= 30) return "stale";
  if (days >= 7) return "aging";
  return "fresh";
}

/** Cents to a plain money string. Null means the viewer may not see amounts. */
export function formatCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return null;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export type QueueCounts = Record<string, number>;

/** Total across every waiting reason, for the tab's own badge. */
export function totalCount(counts: QueueCounts | undefined): number {
  if (!counts) return 0;
  return Object.values(counts).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
}

export type StatusChip = { status: string; label: string; count: number };

/**
 * Filter chips, ordered by the canonical reason order rather than by count.
 *
 * A list that reorders itself as work moves through it is hard to click
 * twice — the chip you want has moved. Reasons with no work are dropped, since
 * a chip that yields an empty list is only a way to reach one.
 */
export function statusChips(counts: QueueCounts | undefined): StatusChip[] {
  if (!counts) return [];
  const order = Object.keys(QUEUE_STATUS_LABELS);
  const known = order
    .filter((status) => (counts[status] ?? 0) > 0)
    .map((status) => ({ status, label: queueStatusLabel(status), count: counts[status] }));
  const extra = Object.keys(counts)
    .filter((status) => !order.includes(status) && status !== "unspecified" && counts[status] > 0)
    .map((status) => ({ status, label: queueStatusLabel(status), count: counts[status] }));
  return [...known, ...extra];
}

/**
 * Accumulates pages into one list, refusing to append a page twice.
 *
 * Keyset paging plus React strict-mode double-invocation makes a duplicate
 * append easy to write and hard to see: the list simply grows with repeats.
 * De-duplicating on entry id here means no caller has to remember.
 */
export function appendPage<T extends { entryId: number }>(existing: T[], incoming: T[]): T[] {
  if (existing.length === 0) return incoming;
  const seen = new Set(existing.map((item) => item.entryId));
  const added = incoming.filter((item) => !seen.has(item.entryId));
  return added.length === 0 ? existing : [...existing, ...added];
}

/** Removes a card that has moved to another tab, so the list does not flash stale. */
export function dropEntry<T extends { entryId: number }>(items: T[], entryId: number): T[] {
  return items.filter((item) => item.entryId !== entryId);
}

/**
 * What the empty state should say.
 *
 * An empty queue is usually good news, and a filtered-empty queue is not the
 * same thing at all — saying "nothing is waiting" while a filter is on would
 * be untrue.
 */
export function emptyCopy(tab: QueueTabKey, filtered: boolean): { title: string; body: string } {
  if (filtered) {
    return {
      title: "Nothing under this filter",
      body: "Clear the filter to see the rest of this tab.",
    };
  }
  if (tab === "on_hold") {
    return { title: "Nothing on hold", body: "Work you pause will appear here with its reason." };
  }
  if (tab === "due") {
    return { title: "No repeat service due", body: "Recurring work due in the next 30 days shows here." };
  }
  return {
    title: "The queue is clear",
    body: "Every job has a date. New work with no date yet will appear here.",
  };
}
