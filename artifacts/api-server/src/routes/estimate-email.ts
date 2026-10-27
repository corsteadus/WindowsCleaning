import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  activityLogsTable, contactChannelsTable, contactsTable, customersTable, db, emailLogsTable, estimateDeliveryRequestsTable, estimateRevisionsTable,
  messageLogsTable, quotesTable,
} from "@workspace/db";
import { sendEmail, type EmailAttachment } from "../lib/email.ts";
import { evaluateRecipientEligibility, maskCommunicationDestination } from "../lib/communication-safety-store.ts";
import { normalizeCommunicationDestination } from "../lib/communication-safety-core.ts";
import { requireFinancialCapability } from "../lib/financial-permissions.ts";
import { businessDateStr } from "../lib/date.ts";
import { unpricedRefusal, type PricedLine } from "../lib/estimate-pricing.ts";
import { estimatePdfTotals, renderEstimatePdf, type EstimatePdfSnapshot } from "../lib/estimate-pdf.ts";
import { createEstimateLinkTx, EstimateLinkError } from "../lib/estimate-link.ts";
import {
  DEFAULT_ESTIMATE_BODY, DEFAULT_ESTIMATE_SUBJECT, ESTIMATE_EMAIL_TAGS, reachesEstimate, recipientsOf, renderEstimateEmail,
  type EstimateEmailValues,
} from "../lib/estimate-email.ts";
import { readQuoteSettings } from "../lib/quote-settings-store.ts";
import {
  claimIdempotencyKey, completeIdempotencyKey, getIdempotencyContext, markIdempotencyReplay, releaseIdempotencyKey,
} from "../lib/idempotency.ts";
import { estimateBranding, estimatePdfFilename } from "./estimates.ts";

/**
 * The basic estimate email — phase 7, Kyle's Video 6 and answer #5. The office
 * picks who receives it (any of the profile's own addresses; a new one is saved
 * to the profile first, Kyle's "save this address"), writes or keeps the message,
 * and may attach the estimate as a PDF. Each recipient goes through the same
 * communication safety as any email and is written to the profile's Email History.
 */
const router: IRouter = Router();
const sendCommunication = requireFinancialCapability("communication.send");

const idOf = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
function senderName(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || (req.user as { username?: string | null }).username || req.user.email || null;
}
const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const appUrl = () => (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");

/** The profile's own addresses, each with whose it is. */
async function addressesOf(customerId: number) {
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
  if (!customer) return null;
  const channels = await db.select({ value: contactChannelsTable.value, isPrimary: contactChannelsTable.isPrimary, contactFirst: contactsTable.firstName, contactLast: contactsTable.lastName })
    .from(contactChannelsTable).leftJoin(contactsTable, eq(contactsTable.id, contactChannelsTable.contactId))
    .where(and(eq(contactChannelsTable.customerId, customerId), eq(contactChannelsTable.channelType, "email"), isNull(contactChannelsTable.archivedAt)));
  const customerName = customer.companyName?.trim() || [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  const seen = new Map<string, { email: string; name: string; primary: boolean }>();
  const add = (raw: string | null | undefined, name: string, primary: boolean) => {
    if (!raw) return;
    try {
      const email = normalizeCommunicationDestination("email", raw).normalized;
      if (!seen.has(email)) seen.set(email, { email, name, primary });
    } catch { /* not an address */ }
  };
  add(customer.email, customerName, true);
  for (const c of channels) add(c.value, [c.contactFirst, c.contactLast].filter(Boolean).join(" ").trim() || customerName, Boolean(c.isPrimary));
  return { customer, customerName, addresses: [...seen.values()] };
}

async function latestRevision(quoteId: number) {
  const [revision] = await db.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.quoteId, quoteId))
    .orderBy(desc(estimateRevisionsTable.revisionNumber)).limit(1);
  return revision ?? null;
}

async function valuesFor(req: Request, quote: typeof quotesTable.$inferSelect, snapshot: EstimatePdfSnapshot, who: { customerName: string; firstName: string },
  links: { pdf: string; page: string }, validUntil: string | null): Promise<EstimateEmailValues> {
  const { businessName, branding } = await estimateBranding();
  return {
    estimateLink: links.pdf, estimatePageLink: links.page,
    firstName: who.firstName || who.customerName, customerName: who.customerName,
    estimateNumber: quote.quoteNumber, estimateTotal: money(estimatePdfTotals(snapshot).total),
    validUntil: longDate(validUntil), businessName, senderName: senderName(req) ?? businessName,
    logoUrl: branding.logo ? `${appUrl()}/api/public/branding/logo.jpg` : null,
  };
}

// ─── What the send screen starts with ────────────────────────────────────────
router.get("/quotes/:id/email-draft", async (req, res): Promise<void> => {
  const quoteId = idOf(req.params.id);
  const [quote] = quoteId ? await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1) : [];
  if (!quote) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (!quote.customerId) { res.status(400).json({ error: "Only a profile's estimate can be emailed from here" }); return; }
  const found = await addressesOf(quote.customerId);
  const revision = await latestRevision(quote.id);
  res.json({
    recipients: found?.addresses ?? [],
    subject: DEFAULT_ESTIMATE_SUBJECT,
    bodyHtml: DEFAULT_ESTIMATE_BODY,
    tags: ESTIMATE_EMAIL_TAGS,
    finalized: Boolean(revision),
    revisionNumber: revision?.revisionNumber ?? null,
    unpriced: revision ? unpricedRefusal(((revision.snapshot as { lineItems?: PricedLine[] }).lineItems ?? [])) : null,
    pdfFilename: estimatePdfFilename(quote.quoteNumber),
    profilePath: `/${found?.customer.lifecycleStatus === "prospect" ? "prospects" : "customers"}/${quote.customerId}`,
  });
});

// ─── The message as the customer will read it ────────────────────────────────
router.post("/quotes/:id/email-preview", async (req, res): Promise<void> => {
  const quoteId = idOf(req.params.id);
  const [quote] = quoteId ? await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1) : [];
  if (!quote?.customerId) { res.status(404).json({ error: "Estimate not found" }); return; }
  const revision = await latestRevision(quote.id);
  if (!revision) { res.status(400).json({ error: "Finalize the estimate before sending" }); return; }
  const found = await addressesOf(quote.customerId);
  const settings = await readQuoteSettings();
  const validUntil = new Date(Date.now() + settings.validityDays * 86400000).toISOString().slice(0, 10);
  const values = await valuesFor(req, quote, revision.snapshot as EstimatePdfSnapshot,
    { customerName: found?.customerName ?? "", firstName: found?.customer.firstName ?? "" },
    { pdf: `${appUrl()}/api/public/estimates/(your-secure-link)/pdf`, page: `${appUrl()}/estimate/(your-secure-link)` }, validUntil);
  const rendered = renderEstimateEmail(String(req.body?.subject ?? ""), String(req.body?.bodyHtml ?? ""), values);
  res.json({ ...rendered, reachesEstimate: reachesEstimate(String(req.body?.bodyHtml ?? ""), Boolean(req.body?.attachPdf)) });
});

// ─── Send it ─────────────────────────────────────────────────────────────────
router.post("/quotes/:id/send-email", sendCommunication, async (req, res): Promise<void> => {
  const quoteId = idOf(req.params.id);
  const [quote] = quoteId ? await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId)).limit(1) : [];
  if (!quote?.customerId) { res.status(404).json({ error: "Estimate not found" }); return; }
  const subject = String(req.body?.subject ?? "").trim();
  const bodyHtml = String(req.body?.bodyHtml ?? "").trim();
  const attachPdf = req.body?.attachPdf === true;
  if (!subject || !bodyHtml) { res.status(400).json({ error: "Write a subject and a message" }); return; }
  if (!reachesEstimate(bodyHtml, attachPdf)) {
    res.status(400).json({ error: "Put {{estimate_link}} in the message or attach the PDF, so the customer can see the estimate", code: "no_estimate_in_email" });
    return;
  }
  const sent = recipientsOf(req.body?.to);
  if ("error" in sent) { res.status(400).json({ error: sent.error }); return; }
  const found = await addressesOf(quote.customerId);
  if (!found) { res.status(404).json({ error: "Profile not found" }); return; }
  const known = new Map(found.addresses.map((a) => [a.email, a]));
  const stranger = sent.recipients.find((email) => !known.has(email));
  if (stranger) {
    res.status(400).json({ error: `${stranger} is not on this profile. Save it to the profile first.`, code: "recipient_not_on_profile" });
    return;
  }
  const revision = await latestRevision(quote.id);
  if (!revision) { res.status(400).json({ error: "Finalize the estimate before sending" }); return; }
  // B2: the customer must never receive $0.00 for a service still to be quoted.
  const unpriced = unpricedRefusal(((revision.snapshot as { lineItems?: PricedLine[] }).lineItems ?? []));
  if (unpriced) { res.status(400).json({ error: unpriced, code: "estimate_unpriced" }); return; }

  // Safety first, for each address: nothing is created for an estimate nobody may receive.
  const decisions = await Promise.all(sent.recipients.map(async (email) => ({
    email,
    eligibility: await db.transaction((tx) => evaluateRecipientEligibility(tx, {
      customerId: quote.customerId, channel: "email", rawDestination: email, classification: "transactional",
      requestedAt: new Date(), source: "estimates.send_email", sourceEvent: `estimate-email:${quote.id}`,
    })),
  })));
  const eligible = decisions.filter((d) => d.eligibility.outcome === "eligible");
  if (!eligible.length) {
    res.status(422).json({ error: "None of these addresses may be emailed right now (unsubscribed, blocked or quiet hours)", skipped: decisions.map((d) => ({ email: d.email, reason: d.eligibility.reasonCode })) });
    return;
  }

  // One click, one email: a repeated request with the same key sends nothing more.
  const idempotency = getIdempotencyContext(req, "estimates.send_email", { quoteId: quote.id, to: sent.recipients, subject, bodyHtml, attachPdf });
  if (!idempotency) { res.status(400).json({ error: "Idempotency-Key header is required", code: "idempotency_key_required" }); return; }
  const claim = await db.transaction((tx) => claimIdempotencyKey(tx, idempotency));
  if (claim.kind === "replay") { markIdempotencyReplay(res); res.json({ status: "already_sent" }); return; }
  if (claim.kind !== "claimed") { res.status(409).json({ error: "This estimate email is already being sent", code: `idempotency_${claim.kind}` }); return; }

  const settings = await readQuoteSettings();
  let created;
  try {
    created = await db.transaction((tx) => createEstimateLinkTx(tx, {
      quoteId: quote.id, validityDays: settings.validityDays, actorId: req.user?.id ?? null,
      deliveries: eligible.map((d) => ({ channel: "email" as const, recipient: d.email, status: "sending" })),
      detail: { via: "estimate_email", attachPdf },
    }));
  } catch (error) {
    await db.transaction((tx) => releaseIdempotencyKey(tx, claim.record.id)).catch(() => {});
    if (error instanceof EstimateLinkError) { res.status(error.statusCode).json({ error: error.message }); return; }
    throw error;
  }
  const snapshot = created.revision.snapshot as EstimatePdfSnapshot;
  const links = {
    pdf: `${appUrl()}/api/public/estimates/${created.token}/pdf`,
    page: `${appUrl()}/estimate/${created.token}`,
  };
  const values = await valuesFor(req, quote, snapshot, { customerName: found.customerName, firstName: found.customer.firstName ?? "" }, links, created.validUntil);
  const rendered = renderEstimateEmail(subject, bodyHtml, values);
  const attachments: EmailAttachment[] = attachPdf ? [{
    filename: estimatePdfFilename(quote.quoteNumber), contentType: "application/pdf",
    content: renderEstimatePdf({ ...snapshot, quote: { ...snapshot.quote, validUntil: created.validUntil } }, {
      ...(await estimateBranding()), customerName: found.customerName || null, customerEmail: found.customer.email,
      customerPhone: found.customer.cellPhone || found.customer.phone, date: created.revision.finalizedAt, revisionNumber: created.revision.revisionNumber,
    }),
  }] : [];

  const results = [];
  for (const { email } of eligible) {
    const who = known.get(email)!;
    const [log] = await db.insert(emailLogsTable).values({
      entityType: "customer", entityId: quote.customerId, recipientEmail: email, recipientName: who.name,
      subject: rendered.subject, bodyHtml: rendered.bodyHtml, status: "pending", sentBy: senderName(req),
    }).returning();
    const result = await sendEmail({ to: [{ email, name: who.name }], subject: rendered.subject, html: rendered.bodyHtml, attachments });
    await db.update(emailLogsTable).set({
      status: result.success ? "sent" : "failed", provider: result.provider, providerMessageId: result.messageId ?? null,
      errorMessage: result.error ?? null, sentAt: result.success ? new Date() : null,
    }).where(eq(emailLogsTable.id, log.id));
    // The estimate's own delivery record says how it went, as the history does.
    const delivery = created.deliveries.find((d) => d.recipient === email);
    if (delivery) {
      await db.update(estimateDeliveryRequestsTable).set({ status: result.success ? "sent" : "failed", lastError: result.error ?? null })
        .where(eq(estimateDeliveryRequestsTable.id, delivery.id));
    }
    await db.insert(messageLogsTable).values({
      channel: "email", triggerType: "manual", relatedType: "customer", relatedId: quote.customerId,
      recipient: maskCommunicationDestination("email", email), subject: rendered.subject, body: "[redacted]",
      status: result.success ? "sent" : "failed", sentAt: result.success ? new Date().toISOString() : null, runDate: businessDateStr(),
    });
    await db.insert(activityLogsTable).values({
      entityType: "customer", entityId: quote.customerId, action: "email_sent", toValue: result.success ? "sent" : "failed",
      note: `Estimate ${quote.quoteNumber} emailed to ${email}${attachPdf ? " with the PDF attached" : ""}`, performedBy: senderName(req),
    }).catch(() => {});
    results.push({ email, sent: result.success, error: result.error ?? null });
  }
  await db.transaction((tx) => completeIdempotencyKey(tx, claim.record.id, {
    resourceType: "estimate_public_link", resourceId: created.link.id, responseStatus: 201,
  }));
  res.status(201).json({
    sent: results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent),
    skipped: decisions.filter((d) => d.eligibility.outcome !== "eligible").map((d) => ({ email: d.email, reason: d.eligibility.reasonCode })),
    path: `/estimate/${created.token}`,
  });
});

export default router;
