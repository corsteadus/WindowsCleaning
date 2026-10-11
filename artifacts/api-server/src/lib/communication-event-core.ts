import { createHash } from "node:crypto";
import type {
  CommunicationEventStatus,
  CommunicationEventType,
} from "./communication-event-types.js";

export class CommunicationEventValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CommunicationEventValidationError";
    this.code = code;
  }
}

export const COMMUNICATION_EVENT_TYPES = [
  "quote.sent",
  "quote.accepted",
  "appointment.scheduled",
  "appointment.changed",
  "job.completed",
  "invoice.sent",
  "payment.received",
  "recurring_plan.due",
] as const satisfies readonly CommunicationEventType[];

export const COMMUNICATION_EVENT_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "retrying",
  "dead_letter",
] as const satisfies readonly CommunicationEventStatus[];

export const MAX_COMMUNICATION_DELIVERY_ATTEMPTS = 5;
export const COMMUNICATION_LEASE_SECONDS = 300;

export function stableCommunicationValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableCommunicationValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableCommunicationValue(item)]),
    );
  }
  return value;
}

export function canonicalCommunicationPayload(value: unknown): string {
  return JSON.stringify(stableCommunicationValue(value));
}

export function communicationPayloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalCommunicationPayload(value)).digest("hex");
}

export function communicationRetryDelaySeconds(attemptNumber: number): number {
  return Math.min(900, 5 * 2 ** Math.max(0, attemptNumber - 1));
}

export function communicationEventStatusFromDeliveryStatuses(
  statuses: ReadonlyArray<"succeeded" | "retrying" | "dead_letter">,
): "succeeded" | "retrying" | "dead_letter" {
  if (statuses.includes("retrying")) return "retrying";
  if (statuses.includes("dead_letter")) return "dead_letter";
  return "succeeded";
}

export function eventAutomationTrigger(eventType: CommunicationEventType): string {
  return eventType.replace(".", "_");
}

/**
 * Fill an automation rule's subject and body.
 *
 * A placeholder with no value is removed, not left standing. It used to be
 * left in place — which is fine while the provider is a mock that logs, and
 * is not fine the moment a real one is connected: `{{amount}}` is exactly the
 * kind of thing a customer would receive. And it is easy to hit, because
 * `invoices` has no `amount` column at all; it has `totalAmount`.
 *
 * Whatever is left is tidied: a placeholder usually sits in a sentence, and
 * removing it should not leave a double space or a space before the full
 * stop.
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = vars[key];
      return value === undefined || value === null ? "" : String(value);
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/>\s+</g, (match) => (match.includes("\n") ? match : "><"));
}

export function safeCommunicationPayloadSummary(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const allowed = new Set([
    "customerId",
    "quoteId",
    "jobId",
    "invoiceId",
    "paymentId",
    "recurringPlanId",
    "scheduledDate",
    "changeKind",
    "status",
    "amount",
  ]);
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, typeof value === "number" || typeof value === "string" || value === null ? value : "[omitted]"]),
  );
}