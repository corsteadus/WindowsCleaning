import { protectedFetch } from "./auth-scope.ts";

/**
 * Client for the scheduling queue, spec §4.
 *
 * Hand-written for the same reason `calendar-api.ts` is: these endpoints are
 * not in the OpenAPI surface the generated client is built from, and the
 * queue's contract is deliberately narrower than the job model — a card's
 * worth of fields and a cursor, not whole job rows.
 *
 * Every read is bounded. There is no "fetch the whole queue" form, by design:
 * a busy office accumulates hundreds of undated jobs, and the endpoint this
 * replaces returned all of them at once.
 */

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface QueueCard {
  entryId: number;
  jobId: number;
  jobNumber: string | null;
  status: string;
  queueStatus: string | null;
  onHoldReason: string | null;
  callbackDate: string | null;
  queuedAt: string;
  daysWaiting: number;
  /** Integer cents, or null when the viewer may not see amounts. */
  valueCents: number | null;
  serviceType: string | null;
  jobStatus: string | null;
  durationMinutes: number | null;
  customerLabel: string | null;
  clientType: string | null;
  propertyLabel: string | null;
}

export interface QueuePageResponse {
  tab: "ready" | "on_hold";
  entries: QueueCard[];
  counts: Record<string, number>;
  /** Null on the last page. Follow it until it is null; never build your own. */
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
  maxLimit: number;
}

export interface TransitionResponse {
  entryId: number;
  jobId: number;
  status: string;
}

/**
 * A refusal the office can act on.
 *
 * The server distinguishes 400 ("fix your input") from 409 ("someone else
 * moved this"), and `code` names the specific rule. Carrying both through
 * means the UI can reload on a conflict instead of showing a dead end.
 */
export class QueueRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "QueueRequestError";
  }

  /** True when the entry moved underneath us and the list should be refetched. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await protectedFetch(`${BASE}/api${path}`, init);
  if (!res.ok) {
    let message = res.statusText;
    let code: string | null = null;
    try {
      const body = await res.json();
      // Surface the server's own wording: it explains which rule was broken.
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      /* a non-JSON error body leaves the status text in place */
    }
    throw new QueueRequestError(message, res.status, code);
  }
  return res.json() as Promise<T>;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function fetchQueuePage(params: {
  tab: "ready" | "on_hold";
  cursor?: string | null;
  status?: string | null;
  limit?: number;
}): Promise<QueuePageResponse> {
  const query = new URLSearchParams({ tab: params.tab });
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.status) query.set("status", params.status);
  if (params.limit) query.set("limit", String(params.limit));
  return request<QueuePageResponse>(`/schedule-queue?${query}`);
}

/** The waiting reasons this deployment knows, so the UI never hardcodes them. */
export function fetchQueueStatuses(): Promise<{ statuses: string[] }> {
  return request<{ statuses: string[] }>("/schedule-queue/statuses");
}

export function scheduleFromQueue(
  entryId: number,
  input: { scheduledDate: string; startTime?: string | null; endTime?: string | null },
): Promise<TransitionResponse> {
  return post<TransitionResponse>(`/schedule-queue/${entryId}/schedule`, input);
}

/** Spec §4.6: a hold always carries a reason, so the office knows what it waits on. */
export function holdEntry(
  entryId: number,
  input: { reason: string; queueStatus?: string },
): Promise<TransitionResponse> {
  return post<TransitionResponse>(`/schedule-queue/${entryId}/hold`, input);
}

export function releaseEntry(
  entryId: number,
  input: { queueStatus?: string } = {},
): Promise<TransitionResponse> {
  return post<TransitionResponse>(`/schedule-queue/${entryId}/release`, input);
}

export function setQueueStatus(entryId: number, queueStatus: string): Promise<TransitionResponse> {
  return request<TransitionResponse>(`/schedule-queue/${entryId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queueStatus }),
  });
}
