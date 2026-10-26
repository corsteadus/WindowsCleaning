/**
 * Callbacks — phase 4, Kyle's Video 4: a list to call through, and for each call
 * whether they spoke, left a message or neither, and when to call next. Times are
 * the business's (America/Chicago), whoever is looking.
 */
import { chicagoAppointmentStartsAt, isoToChicagoDateTimeLocal } from "./chicago-time.ts";

export type CallbackOutcome = "spoke" | "left_message" | "no_answer";
export const CALLBACK_OUTCOMES: { id: CallbackOutcome; label: string }[] = [
  { id: "spoke", label: "Spoke with them" },
  { id: "left_message", label: "Left a message" },
  { id: "no_answer", label: "No answer, no message" },
];
export const outcomeLabel = (outcome: string | null) => CALLBACK_OUTCOMES.find((o) => o.id === outcome)?.label ?? "Cancelled";

export interface Callback {
  id: number; customerId: number; dueAt: string; reason: string | null; status: "open" | "done" | "cancelled";
  outcome: CallbackOutcome | null; outcomeNote: string | null; completedAt: string | null; completedBy: string | null;
  createdBy: string | null; createdAt: string; assignedUserId: string | null; assignedTo: string | null;
}
export interface CallbackProfile { id: number; name: string; list: "prospect" | "customer"; email: string | null; phone: string | null }
export interface ListedCallback extends Callback { profile: CallbackProfile }
export interface CallbackAssignee { id: string; name: string }

/** The Chicago calendar day of an instant, as YYYY-MM-DD. */
const chicagoDay = (iso: string) => isoToChicagoDateTimeLocal(iso).slice(0, 10);

export type DueBucket = "overdue" | "today" | "upcoming";
/** Overdue = its time has passed; today = later today; upcoming = a later day. */
export function dueBucket(dueAt: string, now: Date): DueBucket {
  if (new Date(dueAt).getTime() < now.getTime()) return "overdue";
  return chicagoDay(dueAt) === chicagoDay(now.toISOString()) ? "today" : "upcoming";
}

export const BUCKET_LABELS: Record<DueBucket, string> = { overdue: "Overdue", today: "Today", upcoming: "Coming up" };

export function groupByDue<T extends { dueAt: string }>(callbacks: T[], now: Date): { bucket: DueBucket; callbacks: T[] }[] {
  return (["overdue", "today", "upcoming"] as const)
    .map((bucket) => ({ bucket, callbacks: callbacks.filter((c) => dueBucket(c.dueAt, now) === bucket) }))
    .filter((group) => group.callbacks.length > 0);
}

/** The next business day (Mon–Fri) in Chicago, at 10:00 — a sensible next try, always editable. */
export function defaultNextCallback(now: Date): { date: string; time: string } {
  const [y, m, d] = chicagoDay(now.toISOString()).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  do day.setUTCDate(day.getUTCDate() + 1); while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
  return { date: day.toISOString().slice(0, 10), time: "10:00" };
}

/** A Chicago date and time as the instant the API stores; null when it is not one. */
export const callbackDueAt = (date: string, time: string) => (date && time ? chicagoAppointmentStartsAt(date, time) : null);

export const whenLabel = (iso: string) => new Date(iso).toLocaleString("en-US", {
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
});

/** Where "book the work" goes: a prospect's estimate to convert, a new estimate, or a job for a customer. */
export function bookingTarget(profile: { list: "prospect" | "customer"; estimates: number }): "convert" | "estimate" | "job" {
  if (profile.list === "customer") return "job";
  return profile.estimates > 0 ? "convert" : "estimate";
}
