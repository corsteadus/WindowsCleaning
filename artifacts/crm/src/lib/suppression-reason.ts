/**
 * Why an address stopped receiving mail, in words — Kyle's correction note #6.
 *
 * He asked to see "Customer Unsubscribed, Email Bounced, or Manually
 * Deactivated". Those three already exist as codes on the suppression row;
 * the screen simply never read them, and said "Durably suppressed for this
 * channel" instead — true, and of no use to anybody deciding what to do next.
 *
 * Must stay in step with `suppressionReasonLabel` on the server, which says
 * the same thing for the activity history.
 */

const LABELS: Record<string, string> = {
  marketing_unsubscribe: "Customer unsubscribed",
  provider_permanent_failure: "Email bounced",
  manual: "Manually deactivated",
  complaint: "Reported as spam",
  invalid: "Address is not valid",
};

export function suppressionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Deactivated";
  // A code we have no words for is better shown as the plain fact than as
  // `provider_permanent_failure` with its underscores on screen.
  return LABELS[reason] ?? "Deactivated";
}

/** The three Kyle named, for anywhere that lists them. */
export const SUPPRESSION_REASONS_KYLE_NAMED = [
  "marketing_unsubscribe",
  "provider_permanent_failure",
  "manual",
] as const;
