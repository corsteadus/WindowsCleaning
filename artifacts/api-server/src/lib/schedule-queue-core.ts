import { isDateOnly } from "./date.ts";

/**
 * The scheduling queue's rules, with no database in sight.
 *
 * Spec §4. Work that is not on the calendar still has to be visible and
 * actionable: estimates that became jobs but have no date yet, and jobs pulled
 * off the calendar without being cancelled. Both live in `schedule_entries` —
 * `status = 'queued'` and `status = 'on_hold'` — so moving between the queue
 * and the calendar is a status change on one row rather than a copy between
 * tables.
 *
 * Everything here is pure. The route layer parses and responds, a repository
 * runs the SQL, and these functions decide.
 */

/**
 * Why a queued or held job is waiting.
 *
 * Spec §4.3 asks for plain language in place of the reference system's
 * abbreviations. This is deliberately separate from the entry's calendar state
 * (`queued` / `scheduled` / `on_hold`): the state says where the work sits, and
 * this says what it is waiting on.
 */
export const QUEUE_STATUSES = [
  "needs_contact",
  "contacted",
  "callback_scheduled",
  "waiting_on_customer",
  "waiting_on_materials",
  "weather_hold",
  "ready_to_schedule",
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** The three tabs of §4.1. `due` is sourced from recurring plans, not entries. */
export const QUEUE_TABS = ["ready", "on_hold", "due"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

/** Entry states this module moves work between. Mirrors the DB check constraint. */
export type EntryState = "queued" | "scheduled" | "on_hold" | "canceled";

export function isQueueStatus(value: unknown): value is QueueStatus {
  return typeof value === "string" && (QUEUE_STATUSES as readonly string[]).includes(value);
}

export function isQueueTab(value: unknown): value is QueueTab {
  return typeof value === "string" && (QUEUE_TABS as readonly string[]).includes(value);
}

/* ── Bounded reads ─────────────────────────────────────────────────────── */

/**
 * Row ceiling for one queue page.
 *
 * The queue has no natural bound the way a month grid does — a busy office can
 * accumulate hundreds of unscheduled jobs, and `GET /jobs/unscheduled` returns
 * every one of them today. A page cap keeps one response predictable, and the
 * cursor below lets a caller walk the rest.
 */
export const MAX_QUEUE_PAGE = 100;
export const DEFAULT_QUEUE_PAGE = 50;

export type QueuePageError = "bad_tab" | "bad_limit" | "bad_cursor" | "bad_status";

export type QueuePageRequest = {
  tab: QueueTab;
  limit: number;
  /** Keyset position: everything ordered after this entry. */
  cursor: QueueCursor | null;
  /** Optional narrowing to one waiting reason. */
  status: QueueStatus | null;
};

/**
 * Keyset pagination, not offset.
 *
 * The queue reorders as people work it — a job scheduled from page one shifts
 * everything after it. With OFFSET that silently skips a row; anchoring on the
 * last row's sort key does not. Ties on the timestamp are broken by id, which
 * is why both travel in the cursor.
 */
export type QueueCursor = {
  /** ISO instant the entry entered the queue. */
  queuedAt: string;
  id: number;
};

export type QueuePageResult =
  | { ok: true; request: QueuePageRequest }
  | { ok: false; error: QueuePageError; message: string };

export function encodeQueueCursor(cursor: QueueCursor): string {
  return Buffer.from(`${cursor.queuedAt}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeQueueCursor(raw: string): QueueCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) return null;
  const queuedAt = decoded.slice(0, separator);
  const id = Number(decoded.slice(separator + 1));
  if (!Number.isInteger(id) || id <= 0) return null;
  if (Number.isNaN(Date.parse(queuedAt))) return null;
  return { queuedAt, id };
}

/**
 * Validates a caller's queue window.
 *
 * Returns a discriminated result rather than throwing, matching
 * `parseCalendarRange`, so the route maps each failure to its own message
 * without wrapping request parsing in a try/catch.
 */
export function parseQueuePage(query: {
  tab?: unknown;
  limit?: unknown;
  cursor?: unknown;
  status?: unknown;
}): QueuePageResult {
  const tab = query.tab ?? "ready";
  if (!isQueueTab(tab)) {
    return {
      ok: false,
      error: "bad_tab",
      message: `tab must be one of ${QUEUE_TABS.join(", ")}`,
    };
  }

  let limit = DEFAULT_QUEUE_PAGE;
  if (query.limit !== undefined && query.limit !== "") {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_QUEUE_PAGE) {
      return {
        ok: false,
        error: "bad_limit",
        message: `limit must be a whole number between 1 and ${MAX_QUEUE_PAGE}`,
      };
    }
    limit = parsed;
  }

  let cursor: QueueCursor | null = null;
  if (query.cursor !== undefined && query.cursor !== "") {
    if (typeof query.cursor !== "string") {
      return { ok: false, error: "bad_cursor", message: "cursor must be a string" };
    }
    cursor = decodeQueueCursor(query.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: "bad_cursor",
        message: "cursor is not one this endpoint issued; start from the first page",
      };
    }
  }

  let status: QueueStatus | null = null;
  if (query.status !== undefined && query.status !== "") {
    if (!isQueueStatus(query.status)) {
      return {
        ok: false,
        error: "bad_status",
        message: `status must be one of ${QUEUE_STATUSES.join(", ")}`,
      };
    }
    status = query.status;
  }

  return { ok: true, request: { tab, limit, cursor, status } };
}

/* ── Moving work in and out of the queue ───────────────────────────────── */

export type QueueMoveRefusal =
  | "not_queueable"
  | "already_there"
  | "hold_needs_reason"
  | "invoiced"
  | "completed";

export type QueueMoveDecision =
  | { ok: true; nextState: EntryState }
  | { ok: false; reason: QueueMoveRefusal; message: string };

export type EntrySnapshot = {
  state: EntryState;
  hasInvoice: boolean;
  jobStatus: string;
};

const FINISHED_JOB_STATUSES = new Set(["completed", "canceled", "cancelled"]);

/**
 * Whether work may be pulled off the calendar and held.
 *
 * Spec §4.6 is explicit that holding is not cancelling: the job, its price,
 * notes and history all survive, and a reason is always required. Finished and
 * billed work is refused for the same reason `scheduleChangeLock` refuses to
 * move it — the date it happened on is a fact, not a plan.
 */
export function decideHold(
  entry: EntrySnapshot,
  input: { reason?: string | null },
): QueueMoveDecision {
  if (entry.state === "on_hold") {
    return { ok: false, reason: "already_there", message: "This job is already on hold." };
  }
  if (entry.state === "canceled") {
    return {
      ok: false,
      reason: "not_queueable",
      message: "A cancelled job cannot be put on hold. Reopen it first.",
    };
  }
  if (FINISHED_JOB_STATUSES.has(entry.jobStatus.trim().toLowerCase())) {
    return {
      ok: false,
      reason: "completed",
      message: "Completed work keeps the date it happened on. Reopen the job before holding it.",
    };
  }
  if (entry.hasInvoice) {
    return {
      ok: false,
      reason: "invoiced",
      message: "This job has an invoice, so its schedule is fixed. Void or credit the invoice first.",
    };
  }
  if (!input.reason || !input.reason.trim()) {
    return {
      ok: false,
      reason: "hold_needs_reason",
      message: "Putting a job on hold needs a reason, so the office knows what it is waiting on.",
    };
  }
  return { ok: true, nextState: "on_hold" };
}

/**
 * Whether held work may return to the queue, ready to be scheduled again.
 *
 * Spec §4.4 lists "Return the job to Ready to Schedule" as its own action,
 * separate from scheduling it, because the office often knows a job is
 * unblocked before it knows which day it will run.
 */
export function decideRelease(entry: EntrySnapshot): QueueMoveDecision {
  if (entry.state === "queued") {
    return { ok: false, reason: "already_there", message: "This job is already in the queue." };
  }
  if (entry.state !== "on_hold") {
    return {
      ok: false,
      reason: "not_queueable",
      message: "Only work that is on hold can be returned to the queue.",
    };
  }
  return { ok: true, nextState: "queued" };
}

/* ── Card facts ────────────────────────────────────────────────────────── */

/**
 * Whole days a job has been waiting, spec §4.2.
 *
 * Counted in whole days from the queued instant, never negative — a clock skew
 * between writer and reader should read as "today", not as "-1 days waiting".
 */
export function daysWaiting(queuedAt: string | Date, now: Date = new Date()): number {
  const queued = queuedAt instanceof Date ? queuedAt.getTime() : Date.parse(String(queuedAt));
  if (Number.isNaN(queued)) return 0;
  return Math.max(0, Math.floor((now.getTime() - queued) / 86_400_000));
}

/**
 * The default waiting reason for work entering the queue.
 *
 * A job that arrives with no date has not been discussed with anyone yet, so
 * it needs contact. Work returning from hold has been discussed, and the
 * caller says where it stands.
 */
export function initialQueueStatus(source: "new_job" | "released_from_hold"): QueueStatus {
  return source === "new_job" ? "needs_contact" : "ready_to_schedule";
}

/* ── Shaping a page ────────────────────────────────────────────────────── */

/**
 * One queue row as the database hands it back.
 *
 * Deliberately loose about numeric types: `allocated_value_cents` is
 * `numeric(18,0)`, which `pg` returns as a string rather than a number to
 * avoid silently truncating values past `Number.MAX_SAFE_INTEGER`. Mapping is
 * this module's job precisely so the route never has to think about it.
 */
export type QueueEntryRow = {
  entryId: number;
  jobId: number;
  jobNumber: string | null;
  status: string;
  queueStatus: string | null;
  onHoldReason: string | null;
  callbackDate: string | null;
  queuedAt: string | Date;
  valueCents: string | number | null;
  serviceType: string | null;
  jobStatus: string | null;
  durationMinutes: number | null;
  customerLabel: string | null;
  clientType: string | null;
  propertyLabel: string | null;
};

/** A queue card, spec §4.2 — what the office needs to act without opening the job. */
export type QueueCard = {
  entryId: number;
  jobId: number;
  jobNumber: string | null;
  status: string;
  queueStatus: QueueStatus | null;
  onHoldReason: string | null;
  callbackDate: string | null;
  queuedAt: string;
  daysWaiting: number;
  valueCents: number | null;
  serviceType: string | null;
  jobStatus: string | null;
  durationMinutes: number | null;
  customerLabel: string | null;
  clientType: string | null;
  propertyLabel: string | null;
};

function toInstant(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}

export function toQueueCard(row: QueueEntryRow, now: Date = new Date()): QueueCard {
  const queuedAt = toInstant(row.queuedAt);
  return {
    entryId: row.entryId,
    jobId: row.jobId,
    jobNumber: row.jobNumber,
    status: row.status,
    // An unrecognised reason reads as "no reason given" rather than leaking a
    // raw database value into the UI. The check constraint should make this
    // unreachable; if it is ever reached, the constraint is the thing to fix.
    queueStatus: isQueueStatus(row.queueStatus) ? row.queueStatus : null,
    onHoldReason: row.onHoldReason,
    callbackDate: row.callbackDate,
    queuedAt,
    daysWaiting: daysWaiting(queuedAt, now),
    valueCents: row.valueCents === null ? null : Number(row.valueCents),
    serviceType: row.serviceType,
    jobStatus: row.jobStatus,
    durationMinutes: row.durationMinutes,
    customerLabel: row.customerLabel,
    clientType: row.clientType,
    propertyLabel: row.propertyLabel,
  };
}

export type QueuePage = {
  items: QueueCard[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

/**
 * Turns a raw result set into a page.
 *
 * The repository asks for `limit + 1` rows. That extra row is never returned —
 * it exists only to answer "is there another page?" without a second COUNT
 * query over the whole queue, which is the usual way a paginated list quietly
 * becomes two full table scans.
 */
export function toQueuePage(
  rows: readonly QueueEntryRow[],
  limit: number,
  now: Date = new Date(),
): QueuePage {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const items = visible.map((row) => toQueueCard(row, now));
  const last = items.at(-1);
  return {
    items,
    // Only issue a cursor when there is something after it, so a client that
    // follows cursors until null stops at exactly the right place.
    nextCursor: hasMore && last ? encodeQueueCursor({ queuedAt: last.queuedAt, id: last.entryId }) : null,
    hasMore,
    limit,
  };
}

/**
 * The entry state each tab reads. `due` comes from recurring plans instead.
 *
 * The return type is narrower than `EntryState` on purpose: it is what the
 * repository accepts, so a tab can never ask it for scheduled or cancelled
 * work.
 */
export function tabState(tab: Exclude<QueueTab, "due">): "queued" | "on_hold" {
  return tab === "ready" ? "queued" : "on_hold";
}

/* ── Putting queued work on the calendar ───────────────────────────────── */

export type ScheduleFromQueueInput = {
  scheduledDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
};

export type ScheduleFromQueueRefusal =
  | QueueMoveRefusal
  | "bad_date"
  | "bad_time"
  | "reversed_time";

export type ScheduleDecision =
  | { ok: true; scheduledDate: string; startTime: string | null; endTime: string | null }
  | { ok: false; reason: ScheduleFromQueueRefusal; message: string };

/** The API has always accepted both shapes, so existing rows carry both. */
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;

function normalizeTime(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) return undefined;
  return value;
}

/**
 * Whether queued or held work may move onto the calendar, and on what terms.
 *
 * Spec §4.4: scheduling from the queue is the queue's whole purpose, so this
 * refuses for the same reasons `decideHold` does — finished and invoiced work
 * keeps the date it happened on — and additionally insists on a real date. The
 * database enforces the same rule through
 * `schedule_entries_scheduled_needs_date_check`; catching it here turns a
 * constraint name into a sentence the office can act on.
 */
export function decideSchedule(
  entry: EntrySnapshot,
  input: ScheduleFromQueueInput,
): ScheduleDecision {
  if (entry.state === "scheduled") {
    return {
      ok: false,
      reason: "already_there",
      message: "This job is already on the calendar. Use reschedule to move it.",
    };
  }
  if (entry.state === "canceled") {
    return {
      ok: false,
      reason: "not_queueable",
      message: "A cancelled job cannot be scheduled. Reopen it first.",
    };
  }
  if (FINISHED_JOB_STATUSES.has(entry.jobStatus.trim().toLowerCase())) {
    return {
      ok: false,
      reason: "completed",
      message: "Completed work keeps the date it happened on.",
    };
  }
  if (!isDateOnly(input.scheduledDate)) {
    return {
      ok: false,
      reason: "bad_date",
      message: "scheduledDate is required, as a real calendar date in YYYY-MM-DD form",
    };
  }

  const startTime = normalizeTime(input.startTime);
  const endTime = normalizeTime(input.endTime);
  if (startTime === undefined || endTime === undefined) {
    return {
      ok: false,
      reason: "bad_time",
      message: "Times must be HH:mm or HH:mm:ss on a 24-hour clock",
    };
  }
  // Compared as strings, which is safe because both are zero-padded and
  // same-length once normalized to the minute.
  if (startTime && endTime && endTime.slice(0, 5) < startTime.slice(0, 5)) {
    return {
      ok: false,
      reason: "reversed_time",
      message: "The end time is before the start time",
    };
  }

  return { ok: true, scheduledDate: input.scheduledDate, startTime, endTime };
}

/**
 * Whether a waiting reason may be set on this entry.
 *
 * `schedule_entries_queue_status_scope_check` allows a reason only on queued or
 * held work. Scheduled work is not waiting on anything, and saying so plainly
 * beats surfacing the constraint name.
 */
export function decideQueueStatusChange(
  entry: EntrySnapshot,
  next: unknown,
): { ok: true; queueStatus: QueueStatus } | { ok: false; reason: QueueMoveRefusal | "bad_status"; message: string } {
  if (!isQueueStatus(next)) {
    return {
      ok: false,
      reason: "bad_status",
      message: `status must be one of ${QUEUE_STATUSES.join(", ")}`,
    };
  }
  if (entry.state !== "queued" && entry.state !== "on_hold") {
    return {
      ok: false,
      reason: "not_queueable",
      message: "Only work in the queue or on hold is waiting on something.",
    };
  }
  return { ok: true, queueStatus: next };
}
