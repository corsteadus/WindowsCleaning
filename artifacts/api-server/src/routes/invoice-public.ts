/**
 * A3 (Kyle, Video 7): an invoice the customer can open — its own page and a PDF,
 * emailed the way an estimate is, with each address's opens counted and the
 * office told. Office routes sit under /invoices (invoices.view to read,
 * invoices.manage to change, communication.send to email); the customer's under
 * /public/invoices/:token, authorised by the link's secret token alone.
 */
import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  activityLogsTable, customersTable, db, emailLogsTable, invoiceActivitiesTable, invoiceCreditNotesTable, invoiceDeliveriesTable,
  invoiceLinesTable, invoicePublicLinksTable, invoicesTable, messageLogsTable, propertiesTable, usersTable,
} from "@workspace/db";
import { sendEmail, sendEmailTo, type EmailAttachment } from "../lib/email.ts";
import { evaluateRecipientEligibility, maskCommunicationDestination } from "../lib/communication-safety-store.ts";
import { requireFinancialCapability } from "../lib/financial-permissions.ts";
import { businessDateStr } from "../lib/date.ts";
import { recipientsOf } from "../lib/estimate-email.ts";
import { isNewVisit, isValidOpenKey, newOpenKey, openKeyHash, openNoticeDue, withOpenKey } from "../lib/estimate-opens.ts";
import { officeEmailAddress, officeInvoiceOpenedNotice } from "../lib/estimate-accepted-notice.ts";
import { FixedWindowRequestLimiter, isValidPublicEstimateToken, publicEstimateLimitKey } from "../lib/public-estimate-guard.ts";
import { readQuoteSettings } from "../lib/quote-settings-store.ts";
import {
  invoicePdfFilename, invoiceStanding, longDate, money, renderInvoicePdf, viewLines, type InvoiceView,
} from "../lib/invoice-document.ts";
import { DEFAULT_INVOICE_SUBJECT, INVOICE_EMAIL_TAGS, reachesInvoice, renderInvoiceEmail, type InvoiceEmailValues } from "../lib/invoice-email.ts";
import {
  claimIdempotencyKey, completeIdempotencyKey, getIdempotencyContext, markIdempotencyReplay, releaseIdempotencyKey,
} from "../lib/idempotency.ts";
import { estimateBranding } from "./estimates.ts";
import { addressesOf, senderName } from "./estimate-email.ts";

const router: IRouter = Router();
const sendCommunication = requireFinancialCapability("communication.send");

const idOf = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const tokenHash = (token: string) => createHash("sha256").update(`invoice-link:${token}`).digest("hex");
const appUrl = () => (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
const invoiceUrlOf = (invoiceId: number) => (appUrl() ? `${appUrl()}/invoices/${invoiceId}` : null);
const nameOf = (c: { companyName?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined) =>
  c ? c.companyName?.trim() || [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null : null;
/** Voided and fully credited invoices are not sent: nothing is owed on them. */
const CLOSED = new Set(["voided", "credited"]);

/** The invoice as it stands now, for the page, the PDF and the email. */
async function invoiceView(invoiceId: number) {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
  if (!invoice) return null;
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId)).limit(1);
  const [property] = invoice.propertyId
    ? await db.select().from(propertiesTable).where(eq(propertiesTable.id, invoice.propertyId)).limit(1) : [];
  const lines = await db.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, invoiceId))
    .orderBy(asc(invoiceLinesTable.sortOrder), asc(invoiceLinesTable.id));
  const credits = await db.select({ amount: invoiceCreditNotesTable.balanceReductionAmount }).from(invoiceCreditNotesTable)
    .where(eq(invoiceCreditNotesTable.invoiceId, invoiceId));
  const subtotal = Number(invoice.subtotal);
  const view: InvoiceView = {
    invoiceNumber: invoice.invoiceNumber, status: invoice.status, issuedAt: invoice.createdAt.toISOString(),
    dueDate: invoice.dueDate, paidAt: invoice.paidAt,
    customerName: nameOf(customer), customerEmail: customer?.email ?? null, customerPhone: customer?.cellPhone || customer?.phone || null,
    serviceAddress: property ? [property.address, property.city, [property.state, property.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null,
    lines: viewLines(lines, subtotal), subtotal, taxAmount: Number(invoice.taxAmount), totalAmount: Number(invoice.totalAmount),
    amountPaid: Number(invoice.amountPaid), credited: credits.reduce((sum, c) => sum + Number(c.amount), 0), balanceDue: Number(invoice.balanceDue),
  };
  return { invoice, customer: customer ?? null, view };
}

async function sendInvoicePdf(res: Response, view: InvoiceView, download: boolean) {
  const { businessName, branding } = await estimateBranding();
  const pdf = renderInvoicePdf(view, { businessName, today: businessDateStr(), branding });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${invoicePdfFilename(view.invoiceNumber)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(pdf);
}

/** A new secret link to the invoice. Only its hash is kept; the raw token is in what this returns. */
async function createInvoiceLink(invoiceId: number, actorId: string | null, recipients: string[], detail: Record<string, unknown>, activityType: string) {
  return db.transaction(async (tx) => {
    const token = randomBytes(32).toString("base64url");
    const [link] = await tx.insert(invoicePublicLinksTable).values({ invoiceId, tokenHash: tokenHash(token), createdBy: actorId }).returning();
    const keys = recipients.map(() => newOpenKey());
    const inserted = recipients.length
      ? await tx.insert(invoiceDeliveriesTable).values(recipients.map((recipient, i) => ({
        invoiceId, publicLinkId: link.id, channel: "email", recipient, requestedBy: actorId, openKeyHash: keys[i].hash,
      }))).returning()
      : [];
    await tx.insert(invoiceActivitiesTable).values({ invoiceId, publicLinkId: link.id, activityType, actorId, detail });
    return { token, link, deliveries: inserted.map((d, i) => ({ id: d.id, recipient: d.recipient, openKey: keys[i].key })) };
  });
}

// ─── The office ──────────────────────────────────────────────────────────────

router.get("/invoices/:id/pdf", async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const found = id ? await invoiceView(id) : null;
  if (!found) { res.status(404).json({ error: "Invoice not found" }); return; }
  await sendInvoicePdf(res, found.view, req.query.download === "1");
});

router.get("/invoices/:id/email-draft", async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const found = id ? await invoiceView(id) : null;
  if (!found) { res.status(404).json({ error: "Invoice not found" }); return; }
  const profile = await addressesOf(found.invoice.customerId);
  res.json({
    recipients: profile?.addresses ?? [],
    subject: DEFAULT_INVOICE_SUBJECT,
    tags: INVOICE_EMAIL_TAGS,
    closed: CLOSED.has(found.invoice.status) ? `This invoice is ${found.invoice.status}; there is nothing to send.` : null,
    pdfFilename: invoicePdfFilename(found.invoice.invoiceNumber),
    profilePath: `/${profile?.customer.lifecycleStatus === "prospect" ? "prospects" : "customers"}/${found.invoice.customerId}`,
  });
});

async function emailValues(req: Request, found: NonNullable<Awaited<ReturnType<typeof invoiceView>>>, links: { pdf: string; page: string }): Promise<InvoiceEmailValues> {
  const { businessName, branding } = await estimateBranding();
  const v = found.view;
  return {
    invoiceLink: links.pdf, invoicePageLink: links.page,
    firstName: found.customer?.firstName || v.customerName || "", customerName: v.customerName ?? "",
    invoiceNumber: v.invoiceNumber, invoiceTotal: money(v.totalAmount), balanceDue: money(Math.max(0, v.balanceDue)),
    dueDate: v.dueDate ? longDate(v.dueDate) : "upon receipt", businessName, senderName: senderName(req) ?? businessName,
    logoUrl: branding.logo ? `${appUrl()}/api/public/branding/logo.jpg` : null,
  };
}

router.post("/invoices/:id/email-preview", async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const found = id ? await invoiceView(id) : null;
  if (!found) { res.status(404).json({ error: "Invoice not found" }); return; }
  const values = await emailValues(req, found, {
    pdf: `${appUrl()}/api/public/invoices/(your-secure-link)/pdf`, page: `${appUrl()}/invoice/(your-secure-link)`,
  });
  const bodyHtml = String(req.body?.bodyHtml ?? "");
  res.json({ ...renderInvoiceEmail(String(req.body?.subject ?? ""), bodyHtml, values), reachesInvoice: reachesInvoice(bodyHtml, req.body?.attachPdf === true) });
});

router.post("/invoices/:id/send-email", sendCommunication, async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const found = id ? await invoiceView(id) : null;
  if (!found) { res.status(404).json({ error: "Invoice not found" }); return; }
  const { invoice } = found;
  if (CLOSED.has(invoice.status)) { res.status(409).json({ error: `This invoice is ${invoice.status}; there is nothing to send.`, code: "invoice_closed" }); return; }
  const subject = String(req.body?.subject ?? "").trim();
  const bodyHtml = String(req.body?.bodyHtml ?? "").trim();
  const attachPdf = req.body?.attachPdf === true;
  if (!subject || !bodyHtml) { res.status(400).json({ error: "Write a subject and a message" }); return; }
  if (!reachesInvoice(bodyHtml, attachPdf)) {
    res.status(400).json({ error: "Put the invoice link in the message or attach the PDF, so the customer can see the invoice", code: "no_invoice_in_email" });
    return;
  }
  const sent = recipientsOf(req.body?.to);
  if ("error" in sent) { res.status(400).json({ error: sent.error.replace("estimate", "invoice") }); return; }
  const profile = await addressesOf(invoice.customerId);
  if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
  const known = new Map(profile.addresses.map((a) => [a.email, a]));
  const stranger = sent.recipients.find((email) => !known.has(email));
  if (stranger) {
    res.status(400).json({ error: `${stranger} is not on this profile. Save it to the profile first.`, code: "recipient_not_on_profile" });
    return;
  }

  // Safety first, for each address: nothing is created for an invoice nobody may receive.
  const decisions = await Promise.all(sent.recipients.map(async (email) => ({
    email,
    eligibility: await db.transaction((tx) => evaluateRecipientEligibility(tx, {
      customerId: invoice.customerId, channel: "email", rawDestination: email, classification: "transactional",
      requestedAt: new Date(), source: "invoices.send_email", sourceEvent: `invoice-email:${invoice.id}`,
    })),
  })));
  const eligible = decisions.filter((d) => d.eligibility.outcome === "eligible");
  if (!eligible.length) {
    res.status(422).json({ error: "None of these addresses may be emailed right now (unsubscribed, blocked or quiet hours)", skipped: decisions.map((d) => ({ email: d.email, reason: d.eligibility.reasonCode })) });
    return;
  }

  // One click, one email.
  const idempotency = getIdempotencyContext(req, "invoices.send_email", { invoiceId: invoice.id, to: sent.recipients, subject, bodyHtml, attachPdf });
  if (!idempotency) { res.status(400).json({ error: "Idempotency-Key header is required", code: "idempotency_key_required" }); return; }
  const claim = await db.transaction((tx) => claimIdempotencyKey(tx, idempotency));
  if (claim.kind === "replay") { markIdempotencyReplay(res); res.json({ status: "already_sent" }); return; }
  if (claim.kind !== "claimed") { res.status(409).json({ error: "This invoice email is already being sent", code: `idempotency_${claim.kind}` }); return; }

  let created;
  try {
    created = await createInvoiceLink(invoice.id, req.user?.id ?? null, eligible.map((d) => d.email), { via: "invoice_email", attachPdf, recipients: eligible.map((d) => d.email) }, "invoice_sent");
  } catch (error) {
    await db.transaction((tx) => releaseIdempotencyKey(tx, claim.record.id)).catch(() => {});
    throw error;
  }
  const { businessName, branding } = await estimateBranding();
  const attachments: EmailAttachment[] = attachPdf ? [{
    filename: invoicePdfFilename(invoice.invoiceNumber), contentType: "application/pdf",
    content: renderInvoicePdf(found.view, { businessName, today: businessDateStr(), branding }),
  }] : [];

  const results = [];
  for (const delivery of created.deliveries) {
    const email = delivery.recipient;
    const who = known.get(email)!;
    // Each address gets its own copy of the link, so an open says whose it was.
    const rendered = renderInvoiceEmail(subject, bodyHtml, await emailValues(req, found, {
      pdf: withOpenKey(`${appUrl()}/api/public/invoices/${created.token}/pdf`, delivery.openKey),
      page: withOpenKey(`${appUrl()}/invoice/${created.token}`, delivery.openKey),
    }));
    const [log] = await db.insert(emailLogsTable).values({
      entityType: "customer", entityId: invoice.customerId, recipientEmail: email, recipientName: who.name,
      subject: rendered.subject, bodyHtml: rendered.bodyHtml, status: "pending", sentBy: senderName(req),
      relatedType: "invoice", relatedId: invoice.id,
    }).returning();
    const result = await sendEmail({ to: [{ email, name: who.name }], subject: rendered.subject, html: rendered.bodyHtml, attachments });
    await db.update(emailLogsTable).set({
      status: result.success ? "sent" : "failed", provider: result.provider, providerMessageId: result.messageId ?? null,
      errorMessage: result.error ?? null, sentAt: result.success ? new Date() : null,
    }).where(eq(emailLogsTable.id, log.id));
    await db.update(invoiceDeliveriesTable).set({ status: result.success ? "sent" : "failed", lastError: result.error ?? null })
      .where(eq(invoiceDeliveriesTable.id, delivery.id));
    // The invoice's own Communications list reads these.
    await db.insert(messageLogsTable).values({
      channel: "email", triggerType: "manual", relatedType: "invoice", relatedId: invoice.id,
      recipient: maskCommunicationDestination("email", email), subject: rendered.subject, body: "[redacted]",
      status: result.success ? "sent" : "failed", sentAt: result.success ? new Date().toISOString() : null, runDate: businessDateStr(),
    });
    await db.insert(activityLogsTable).values({
      entityType: "customer", entityId: invoice.customerId, action: "email_sent", toValue: result.success ? "sent" : "failed",
      note: `Invoice ${invoice.invoiceNumber} emailed to ${email}${attachPdf ? " with the PDF attached" : ""}`, performedBy: senderName(req),
    }).catch(() => {});
    results.push({ email, sent: result.success, error: result.error ?? null });
  }
  // A draft that has gone to the customer is Sent. (The automatic "invoice sent"
  // message is not queued: the customer has just been emailed the invoice.)
  if (invoice.status === "draft" && results.some((r) => r.sent)) {
    await db.update(invoicesTable).set({ status: "sent" }).where(and(eq(invoicesTable.id, invoice.id), eq(invoicesTable.status, "draft")));
    await db.insert(activityLogsTable).values({
      entityType: "customer", entityId: invoice.customerId, action: "invoice_status_changed", fromValue: "draft", toValue: "sent",
      note: `Invoice ${invoice.invoiceNumber} marked as sent (emailed)`, performedBy: senderName(req),
    }).catch(() => {});
  }
  await db.transaction((tx) => completeIdempotencyKey(tx, claim.record.id, {
    resourceType: "invoice_public_link", resourceId: created.link.id, responseStatus: 201,
  }));
  res.status(201).json({
    sent: results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent),
    skipped: decisions.filter((d) => d.eligibility.outcome !== "eligible").map((d) => ({ email: d.email, reason: d.eligibility.reasonCode })),
    path: `/invoice/${created.token}`,
  });
});

// A link the office copies to send some other way. Its opens are counted on the link.
router.post("/invoices/:id/customer-link", async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const [invoice] = id ? await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1) : [];
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  const created = await createInvoiceLink(invoice.id, req.user?.id ?? null, [], {}, "link_created");
  res.status(201).json({ path: `/invoice/${created.token}` });
});

// The invoice's history: what happened, who did it, and which address opened it.
router.get("/invoices/:id/history", async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid invoice id" }); return; }
  const activities = await db.select().from(invoiceActivitiesTable).where(eq(invoiceActivitiesTable.invoiceId, id))
    .orderBy(desc(invoiceActivitiesTable.occurredAt), desc(invoiceActivitiesTable.id)).limit(200);
  const deliveries = await db.select({
    id: invoiceDeliveriesTable.id, publicLinkId: invoiceDeliveriesTable.publicLinkId, channel: invoiceDeliveriesTable.channel,
    recipient: invoiceDeliveriesTable.recipient, status: invoiceDeliveriesTable.status, requestedAt: invoiceDeliveriesTable.requestedAt,
    openCount: invoiceDeliveriesTable.openCount, firstOpenedAt: invoiceDeliveriesTable.firstOpenedAt, lastOpenedAt: invoiceDeliveriesTable.lastOpenedAt,
  }).from(invoiceDeliveriesTable).where(eq(invoiceDeliveriesTable.invoiceId, id)).orderBy(desc(invoiceDeliveriesTable.requestedAt));
  const links = await db.select({ openCount: invoicePublicLinksTable.openCount, firstOpenedAt: invoicePublicLinksTable.firstOpenedAt })
    .from(invoicePublicLinksTable).where(eq(invoicePublicLinksTable.invoiceId, id));
  const actorIds = [...new Set(activities.map((a) => a.actorId).filter(Boolean) as string[])];
  const users = actorIds.length
    ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, username: usersTable.username })
      .from(usersTable).where(inArray(usersTable.id, actorIds))
    : [];
  res.json({
    activities, deliveries,
    copiedLinkOpens: links.reduce((sum, l) => sum + l.openCount, 0),
    opened: links.some((l) => l.firstOpenedAt),
    actors: Object.fromEntries(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || "Office"])),
  });
});

// ─── The customer ────────────────────────────────────────────────────────────

const publicInvoiceIpLimiter = new FixedWindowRequestLimiter(120, 60_000, 5_000);
const publicInvoiceTokenLimiter = new FixedWindowRequestLimiter(60, 60_000, 10_000);

router.use("/public/invoices/:token", (req, res, next) => {
  const token = String(req.params.token ?? "");
  if (!isValidPublicEstimateToken(token)) { res.status(404).json({ error: "This invoice link is invalid" }); return; }
  const ip = req.ip || "unknown";
  if (!publicInvoiceIpLimiter.allow(ip) || !publicInvoiceTokenLimiter.allow(publicEstimateLimitKey(ip, token))) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Too many requests; try again shortly" });
    return;
  }
  next();
});

async function publicInvoice(token: string) {
  const [link] = await db.select().from(invoicePublicLinksTable).where(eq(invoicePublicLinksTable.tokenHash, tokenHash(token))).limit(1);
  if (!link) return null;
  const found = await invoiceView(link.invoiceId);
  return found ? { link, ...found } : null;
}
type FoundInvoice = NonNullable<Awaited<ReturnType<typeof publicInvoice>>>;

/**
 * An open of the customer's link, counted against the address whose copy it was
 * (`?r=`) or, with no key, against the link. The same rules as an estimate's
 * (A2): a signed-in team member counts for nothing, a reload within half an hour
 * is the same visit, and the office hears of an address's first open, then at
 * most daily — and not once nothing is owed.
 */
async function recordOpen(req: Request, found: FoundInvoice, via: "page" | "pdf"): Promise<void> {
  if (req.isAuthenticated()) return;
  const now = new Date();
  const key = isValidOpenKey(req.query.r) ? String(req.query.r) : null;
  const settled = ["paid", "voided", "credited"].includes(invoiceStanding(found.view, businessDateStr(now)));
  const opened = await db.transaction(async (tx) => {
    const [link] = await tx.select().from(invoicePublicLinksTable).where(eq(invoicePublicLinksTable.id, found.link.id)).for("update");
    const [delivery] = key
      ? await tx.select().from(invoiceDeliveriesTable).where(and(
        eq(invoiceDeliveriesTable.publicLinkId, link.id), eq(invoiceDeliveriesTable.openKeyHash, openKeyHash(key)),
      )).for("update")
      : [];
    const newVisit = isNewVisit(delivery ? delivery.lastOpenedAt : link.lastActivityAt, now);
    const openCount = (delivery ? delivery.openCount : link.openCount) + (newVisit ? 1 : 0);
    await tx.update(invoicePublicLinksTable).set({
      firstOpenedAt: link.firstOpenedAt ?? now, lastActivityAt: now, ...(delivery ? {} : { openCount }),
    }).where(eq(invoicePublicLinksTable.id, link.id));
    if (delivery) {
      await tx.update(invoiceDeliveriesTable).set({ openCount, firstOpenedAt: delivery.firstOpenedAt ?? now, lastOpenedAt: now })
        .where(eq(invoiceDeliveriesTable.id, delivery.id));
    }
    if (!newVisit) return null;
    await tx.insert(invoiceActivitiesTable).values({
      invoiceId: link.invoiceId, publicLinkId: link.id, activityType: "opened", actorType: "customer",
      detail: { deliveryRequestId: delivery?.id ?? null, via, openCount },
    });
    const lastNotified = delivery ? delivery.openNotifiedAt : link.openNotifiedAt;
    if (settled || !openNoticeDue(lastNotified, now)) return null;
    if (delivery) await tx.update(invoiceDeliveriesTable).set({ openNotifiedAt: now }).where(eq(invoiceDeliveriesTable.id, delivery.id));
    else await tx.update(invoicePublicLinksTable).set({ openNotifiedAt: now }).where(eq(invoicePublicLinksTable.id, link.id));
    return { recipient: delivery?.recipient ?? null, openCount };
  });
  if (!opened || !(await readQuoteSettings()).openNotificationEnabled) return;
  const to = officeEmailAddress(process.env);
  if (!to) return;
  const notice = officeInvoiceOpenedNotice({
    invoiceNumber: found.view.invoiceNumber, customerName: found.view.customerName, recipient: opened.recipient,
    openCount: opened.openCount, balanceDue: money(Math.max(0, found.view.balanceDue)), invoiceUrl: invoiceUrlOf(found.invoice.id),
  });
  void sendEmailTo({ email: to }, notice.subject, notice.html, notice.text).then((result) => db.insert(invoiceActivitiesTable).values({
    invoiceId: found.invoice.id, activityType: result.success ? "office_notified" : "office_notification_failed", actorType: "system",
    detail: { to, provider: result.provider, error: result.error ?? null, subject: notice.subject },
  })).catch(() => {});
}

router.get("/public/invoices/:token", async (req, res): Promise<void> => {
  const found = await publicInvoice(req.params.token);
  if (!found) { res.status(404).json({ error: "This invoice link is invalid" }); return; }
  await recordOpen(req, found, "page");
  const { customerEmail: _email, customerPhone: _phone, ...view } = found.view;
  res.json({ ...view, standing: invoiceStanding(found.view, businessDateStr()) });
});

router.get("/public/invoices/:token/pdf", async (req, res): Promise<void> => {
  const found = await publicInvoice(req.params.token);
  if (!found) { res.status(404).json({ error: "This invoice link is invalid" }); return; }
  await recordOpen(req, found, "pdf");
  await sendInvoicePdf(res, found.view, req.query.download === "1");
});

router.post("/public/invoices/:token/activity", async (req, res): Promise<void> => {
  const found = await publicInvoice(req.params.token);
  if (!found) { res.status(404).json({ error: "This invoice link is invalid" }); return; }
  const activityType = String(req.body?.activityType ?? "");
  if (!["printed", "downloaded"].includes(activityType)) { res.status(400).json({ error: "Unsupported activity" }); return; }
  if (!req.isAuthenticated()) {
    await db.insert(invoiceActivitiesTable).values({ invoiceId: found.invoice.id, publicLinkId: found.link.id, activityType, actorType: "customer" });
  }
  res.status(204).end();
});

export default router;
