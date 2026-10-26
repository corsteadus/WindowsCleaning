/**
 * Callbacks — phase 4, Kyle's Video 4. "There are options to indicate whether
 * we actually spoke to the prospect, left a message, or neither, and there are
 * options for scheduling a callback or the appropriate follow-up." The rules
 * the route applies (lib/db schema/profile_callbacks.ts holds the table).
 */
import { MAX_NOTE_LENGTH } from "./profile-notes.ts";

export const CALLBACK_OUTCOMES = ["spoke", "left_message", "no_answer"] as const;
export type CallbackOutcome = (typeof CALLBACK_OUTCOMES)[number];
export const OUTCOME_LABELS: Record<CallbackOutcome, string> = {
  spoke: "Spoke with them",
  left_message: "Left a message",
  no_answer: "No answer, no message",
};

export const MAX_REASON_LENGTH = 500;

export function outcomeOf(value: unknown): CallbackOutcome | null {
  return CALLBACK_OUTCOMES.find((outcome) => outcome === value) ?? null;
}

/** A due time as sent by the browser (an ISO instant), or why it cannot be one. */
export function dueAtOf(value: unknown): { dueAt: Date } | { error: string } {
  if (typeof value !== "string" || !value.trim()) return { error: "Choose when to call" };
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) return { error: "That is not a date and time" };
  return { dueAt };
}

export function reasonOf(value: unknown): { reason: string | null } | { error: string } {
  if (value == null) return { reason: null };
  if (typeof value !== "string") return { error: "The reason must be text" };
  const reason = value.trim();
  if (reason.length > MAX_REASON_LENGTH) return { error: `A reason can be up to ${MAX_REASON_LENGTH} characters` };
  return { reason: reason || null };
}

export function outcomeNoteOf(value: unknown): { note: string | null } | { error: string } {
  if (value == null) return { note: null };
  if (typeof value !== "string") return { error: "The note must be text" };
  const note = value.trim();
  if (note.length > MAX_NOTE_LENGTH) return { error: `A note can be up to ${MAX_NOTE_LENGTH} characters` };
  return { note: note || null };
}

const chicago = (at: Date) => at.toLocaleString("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
});

/**
 * What a made call adds to the profile's callback notes, so the log Kyle reads
 * on the profile says what happened on every call, dated and signed like any note.
 */
export function callbackNoteText(outcome: CallbackOutcome, note: string | null, nextDueAt: Date | null): string {
  return [
    `Callback: ${OUTCOME_LABELS[outcome]}.`,
    note,
    nextDueAt ? `Next callback ${chicago(nextDueAt)}.` : null,
  ].filter(Boolean).join(" ");
}
