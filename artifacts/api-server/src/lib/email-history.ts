/**
 * A profile's email history — phase 2, Kyle's Video 4: "you can see the date
 * and time, what we emailed, and who sent the email. We can open the email and
 * view its content … if we need to look back at an earlier email or resend
 * that same email, we can easily find it."
 *
 * The full message lives in `email_logs`; the profile's activity feed only has
 * a redacted line for it (communication safety), so this reads the log itself.
 */

export type EmailOrigin = "manual" | "automation" | "campaign";

export interface EmailLogRow {
  id: number;
  subject: string;
  recipientEmail: string;
  recipientName: string | null;
  status: string;
  sentAt: Date | null;
  createdAt: Date;
  errorMessage: string | null;
  templateName: string | null;
  sentBy: string | null;
  campaignId: number | null;
}

export interface CampaignRow { id: number; name: string; createdBy: string | null; automationRuleId: number | null }

export interface EmailHistoryEntry {
  id: number;
  subject: string;
  to: string;
  toName: string | null;
  status: string;
  at: string;
  /** Who sent it, in words; null for an email from before the sender was recorded. */
  sender: string | null;
  origin: EmailOrigin;
  error: string | null;
}

export function emailOrigin(campaign: CampaignRow | undefined): EmailOrigin {
  if (!campaign) return "manual";
  return campaign.automationRuleId != null || campaign.createdBy === "automation-engine" ? "automation" : "campaign";
}

/** "[Auto] Estimate sent — 2026-10-10" reads as "Automatic: Estimate sent". */
function automationName(name: string): string {
  return name.replace(/^\[Auto\]\s*/, "").replace(/\s+—\s+\d{4}-\d{2}-\d{2}$/, "").trim() || name;
}

export function emailHistoryEntry(log: EmailLogRow, campaign: CampaignRow | undefined): EmailHistoryEntry {
  const origin = emailOrigin(campaign);
  const sender = log.sentBy?.trim()
    || (origin === "automation" && campaign ? `Automatic: ${automationName(campaign.name)}` : null)
    || (origin === "campaign" && campaign ? `Campaign: ${campaign.name}` : null);
  return {
    id: log.id,
    subject: log.subject,
    to: log.recipientEmail,
    toName: log.recipientName?.trim() || null,
    status: log.status,
    at: (log.sentAt ?? log.createdAt).toISOString(),
    sender: sender || null,
    origin,
    error: log.errorMessage,
  };
}

/** Newest first. */
export function emailHistory(logs: readonly EmailLogRow[], campaigns: readonly CampaignRow[]): EmailHistoryEntry[] {
  return logs
    .map((log) => emailHistoryEntry(log, campaigns.find((campaign) => campaign.id === log.campaignId)))
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
}
