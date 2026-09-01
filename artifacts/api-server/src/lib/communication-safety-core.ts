import { createHash } from "node:crypto";

export type CommunicationChannel = "email" | "sms";
export type MessageClassification = "marketing" | "transactional";
export type EligibilityOutcome = "eligible" | "blocked" | "deferred";

export type Destination = {
  channel: CommunicationChannel;
  normalized: string;
  hash: string;
};

export type PreferenceState = {
  emailMarketingStatus?:
    | "subscribed"
    | "unsubscribed"
    | "invalid"
    | "bounced"
    | "complained"
    | null;
  smsConsentStatus?: "unknown" | "opted_in" | "opted_out" | "invalid" | null;
};

export type SuppressionState = {
  channel: CommunicationChannel;
  destinationHash: string;
  reason:
    | "complaint"
    | "invalid"
    | "provider_permanent_failure"
    | "manual"
    | "marketing_unsubscribe";
  scope: "global" | "marketing" | "transactional";
  active: boolean;
};

export type QuietHoursWindow = { start: string; end: string };
export type QuietHoursState = {
  timezone: string;
  email?: QuietHoursWindow | null;
  sms?: QuietHoursWindow | null;
};

export type EligibilityInput = {
  channel: CommunicationChannel;
  normalizedDestination: string;
  classification: MessageClassification;
  requestedAt: Date;
  source: string;
  sourceEvent?: string | null;
};

export type EligibilityDecision = {
  outcome: EligibilityOutcome;
  reasonCode:
    | "eligible"
    | "invalid_destination"
    | "hard_suppression"
    | "email_invalid"
    | "email_bounced"
    | "email_complained"
    | "marketing_unsubscribed"
    | "marketing_consent_missing"
    | "sms_opted_out"
    | "sms_invalid"
    | "sms_consent_missing"
    | "quiet_hours";
  allowedAt: Date | null;
  destinationHash: string;
  source: string;
  sourceEvent: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_DIGITS_RE = /^\d{10,15}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const OPT_OUT_PHRASES = new Set([
  "STOP",
  "QUIT",
  "END",
  "REVOKE",
  "OPT OUT",
  "CANCEL",
  "UNSUBSCRIBE",
]);

export function hashCommunicationDestination(
  normalizedDestination: string,
): string {
  return createHash("sha256")
    .update(normalizedDestination, "utf8")
    .digest("hex");
}

export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized) || normalized.length > 320) {
    throw new Error("Invalid email destination");
  }
  return normalized;
}

export function normalizePhone(value: string): string {
  const input = value.trim();
  const hasPlus = input.startsWith("+");
  const digits = input.replace(/[^\d]/g, "");
  if (!PHONE_DIGITS_RE.test(digits))
    throw new Error("Invalid phone destination");
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new Error(
    "Phone destination must include an international country code",
  );
}

export function normalizeCommunicationDestination(
  channel: CommunicationChannel,
  value: string,
): Destination {
  const normalized =
    channel === "email" ? normalizeEmail(value) : normalizePhone(value);
  return {
    channel,
    normalized,
    hash: hashCommunicationDestination(normalized),
  };
}

export function parseOptOutPhrase(value: string): boolean {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, " ");
  return OPT_OUT_PHRASES.has(normalized);
}

function localMinute(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

function validateQuietWindow(window: QuietHoursWindow): void {
  if (!TIME_RE.test(window.start) || !TIME_RE.test(window.end)) {
    throw new Error("Quiet-hours times must use HH:MM");
  }
}

function isQuietMinute(minute: number, window: QuietHoursWindow): boolean {
  validateQuietWindow(window);
  const [startHour, startMinute] = window.start.split(":").map(Number);
  const [endHour, endMinute] = window.end.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  // Equal endpoints are explicitly treated as disabled, not as a
  // 24-hour quiet window. This avoids an unresolvable "next allowed" time.
  if (start === end) return false;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

export function nextAllowedCommunicationTime(
  requestedAt: Date,
  channel: CommunicationChannel,
  quietHours?: QuietHoursState | null,
): Date | null {
  if (!quietHours) return null;
  // Intl throws for an invalid IANA timezone. Let that validation reach callers.
  new Intl.DateTimeFormat("en-US", { timeZone: quietHours.timezone }).format(
    requestedAt,
  );
  const window = channel === "email" ? quietHours.email : quietHours.sms;
  if (!window) return null;
  validateQuietWindow(window);
  if (!isQuietMinute(localMinute(requestedAt, quietHours.timezone), window))
    return null;

  // Walk UTC minutes so spring-forward and fall-back transitions are handled
  // by the runtime's IANA timezone data rather than hand-written DST rules.
  for (let step = 1; step <= 72 * 60; step += 1) {
    const candidate = new Date(requestedAt.getTime() + step * 60_000);
    if (!isQuietMinute(localMinute(candidate, quietHours.timezone), window))
      return candidate;
  }
  throw new Error("Quiet-hours window did not produce a next allowed time");
}

export function decideCommunicationEligibility(
  input: EligibilityInput,
  state: {
    preference?: PreferenceState | null;
    suppressions?: readonly SuppressionState[];
    quietHours?: QuietHoursState | null;
  } = {},
): EligibilityDecision {
  if (!input.normalizedDestination.trim()) {
    return decision(
      input,
      hashCommunicationDestination(""),
      "blocked",
      "invalid_destination",
    );
  }
  const destinationHash = hashCommunicationDestination(
    input.normalizedDestination,
  );
  const hardSuppression = (state.suppressions ?? []).some((suppression) => {
    if (
      !suppression.active ||
      suppression.channel !== input.channel ||
      suppression.destinationHash !== destinationHash
    )
      return false;
    if (suppression.scope === "global") return true;
    return suppression.scope === input.classification;
  });
  if (hardSuppression)
    return decision(input, destinationHash, "blocked", "hard_suppression");

  const preference = state.preference ?? {};
  if (input.channel === "email") {
    if (preference.emailMarketingStatus === "invalid")
      return decision(input, destinationHash, "blocked", "email_invalid");
    if (preference.emailMarketingStatus === "bounced")
      return decision(input, destinationHash, "blocked", "email_bounced");
    if (preference.emailMarketingStatus === "complained")
      return decision(input, destinationHash, "blocked", "email_complained");
    if (
      input.classification === "marketing" &&
      preference.emailMarketingStatus === "unsubscribed"
    ) {
      return decision(
        input,
        destinationHash,
        "blocked",
        "marketing_unsubscribed",
      );
    }
    if (
      input.classification === "marketing" &&
      preference.emailMarketingStatus !== "subscribed"
    ) {
      return decision(
        input,
        destinationHash,
        "blocked",
        "marketing_consent_missing",
      );
    }
  } else {
    if (preference.smsConsentStatus === "opted_out")
      return decision(input, destinationHash, "blocked", "sms_opted_out");
    if (preference.smsConsentStatus === "invalid")
      return decision(input, destinationHash, "blocked", "sms_invalid");
    if (preference.smsConsentStatus !== "opted_in")
      return decision(input, destinationHash, "blocked", "sms_consent_missing");
  }

  const allowedAt = nextAllowedCommunicationTime(
    input.requestedAt,
    input.channel,
    state.quietHours,
  );
  if (allowedAt)
    return decision(
      input,
      destinationHash,
      "deferred",
      "quiet_hours",
      allowedAt,
    );
  return decision(input, destinationHash, "eligible", "eligible");
}

function decision(
  input: EligibilityInput,
  destinationHash: string,
  outcome: EligibilityOutcome,
  reasonCode: EligibilityDecision["reasonCode"],
  allowedAt: Date | null = null,
): EligibilityDecision {
  return {
    outcome,
    reasonCode,
    allowedAt,
    destinationHash,
    source: input.source,
    sourceEvent: input.sourceEvent ?? null,
  };
}
