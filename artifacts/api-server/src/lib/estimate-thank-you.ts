/**
 * The thank-you email a customer gets after accepting an estimate online — Video 9:
 * "it thanks them for accepting their proposal, confirms the acceptance, and lets
 * them know that we will be contacting them shortly". Sent to the addresses the
 * estimate was sent to (or the profile's email when the link was copied by hand),
 * through the same communication safety as any email, and written to the profile's
 * Email History. Never for an office user's conversion: that is not the customer
 * accepting.
 */
import { eq } from "drizzle-orm";
import {
  activityLogsTable, db, emailLogsTable, estimateActivitiesTable, estimateDeliveryRequestsTable, messageLogsTable,
} from "@workspace/db";
import { sendEmail } from "./email.ts";
import { evaluateRecipientEligibility, maskCommunicationDestination } from "./communication-safety-store.ts";
import { businessDateStr } from "./date.ts";
import { readQuoteSettings } from "./quote-settings-store.ts";
import { readCompanyProfile } from "./company-profile.ts";
import { acceptanceEmail, acceptanceValues, thankYouRecipients } from "./estimate-acceptance-content.ts";

export interface ThankYouInput {
  quoteId: number;
  quoteNumber: string;
  customerId: number | null;
  publicLinkId: number;
  customer: { firstName?: string | null; lastName?: string | null; companyName?: string | null; email?: string | null } | null;
  accepted: ReadonlyArray<{ description: string }>;
  acceptedTotal: number;
  customerNotes: string | null;
}

const SENDER = "Corstead (automatic)";

export async function thankCustomerForAcceptance(input: ThankYouInput): Promise<void> {
  const settings = await readQuoteSettings();
  const record = (activityType: string, detail: Record<string, unknown>) => db.insert(estimateActivitiesTable).values({
    quoteId: input.quoteId, publicLinkId: input.publicLinkId, activityType, actorType: "system", detail,
  });
  if (!settings.acceptanceEmailEnabled || !input.customerId) {
    await record("customer_thank_you_skipped", { reason: !input.customerId ? "no_profile" : "turned_off" });
    return;
  }
  const deliveries = await db.select({ channel: estimateDeliveryRequestsTable.channel, recipient: estimateDeliveryRequestsTable.recipient })
    .from(estimateDeliveryRequestsTable).where(eq(estimateDeliveryRequestsTable.publicLinkId, input.publicLinkId));
  const recipients = thankYouRecipients(deliveries, input.customer?.email);
  if (!recipients.length) { await record("customer_thank_you_skipped", { reason: "no_email_address" }); return; }

  const customerName = input.customer?.companyName?.trim()
    || [input.customer?.firstName, input.customer?.lastName].filter(Boolean).join(" ").trim();
  const email = acceptanceEmail(settings, acceptanceValues({
    firstName: input.customer?.firstName, customerName, quoteNumber: input.quoteNumber,
    businessName: (await readCompanyProfile()).businessName,
    accepted: input.accepted, acceptedTotal: input.acceptedTotal, customerNotes: input.customerNotes,
  }));

  for (const to of recipients) {
    const eligibility = await db.transaction((tx) => evaluateRecipientEligibility(tx, {
      customerId: input.customerId!, channel: "email", rawDestination: to, classification: "transactional",
      requestedAt: new Date(), source: "estimates.thank_you", sourceEvent: `estimate-thank-you:${input.publicLinkId}`,
    }));
    if (eligibility.outcome !== "eligible") {
      await record("customer_thank_you_skipped", { to: maskCommunicationDestination("email", to), reason: eligibility.reasonCode });
      continue;
    }
    const [log] = await db.insert(emailLogsTable).values({
      entityType: "customer", entityId: input.customerId, recipientEmail: to, recipientName: customerName || null,
      subject: email.subject, bodyHtml: email.html, status: "pending", sentBy: SENDER,
      relatedType: "quote", relatedId: input.quoteId,
    }).returning();
    const result = await sendEmail({ to: [{ email: to, name: customerName || undefined }], subject: email.subject, html: email.html, text: email.text });
    await db.update(emailLogsTable).set({
      status: result.success ? "sent" : "failed", provider: result.provider, providerMessageId: result.messageId ?? null,
      errorMessage: result.error ?? null, sentAt: result.success ? new Date() : null,
    }).where(eq(emailLogsTable.id, log.id));
    await db.insert(messageLogsTable).values({
      channel: "email", triggerType: "estimate_accepted", relatedType: "customer", relatedId: input.customerId,
      recipient: maskCommunicationDestination("email", to), subject: email.subject, body: "[redacted]",
      status: result.success ? "sent" : "failed", sentAt: result.success ? new Date().toISOString() : null, runDate: businessDateStr(),
    });
    await db.insert(activityLogsTable).values({
      entityType: "customer", entityId: input.customerId, action: "email_sent", toValue: result.success ? "sent" : "failed",
      note: `Thank-you for accepting estimate ${input.quoteNumber} emailed to ${to}`, performedBy: SENDER,
    }).catch(() => {});
    await record(result.success ? "customer_thanked" : "customer_thank_you_failed", {
      to: maskCommunicationDestination("email", to), provider: result.provider, error: result.error ?? null,
    });
  }
}
