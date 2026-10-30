/**
 * A profile's one communication history — A6 (Kyle, Video 8). Every email,
 * text and letter, once each, newest first; filter by type or words; open one
 * to read what was actually sent; print a letter again. The owner and admins
 * (communication.history.delete) can remove entries, one or many: the record is
 * kept and the removal is recorded with who did it and when.
 *
 *   GET  /customers/:id/communications?type=email|text|letter&q=words
 *   GET  /customers/:id/communications/:key            one entry in full
 *   GET  /customers/:id/communications/:key/pdf        a letter, printed again
 *   POST /customers/:id/communications/delete          { keys: ["email:12", …] }
 * (and the same under /prospects/:id)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  activityLogsTable, communicationDeletionsTable, customersTable, db, emailCampaignsTable, emailLogsTable,
  estimateDeliveryRequestsTable, invoicesTable, jobsTable, messageLogsTable, printedLettersTable, quotesTable, usersTable,
} from "@workspace/db";
import { hasCapability, isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import {
  deletionTargets, deliveryItem, emailItem, historyOf, historyTypeOf, letterItem, messageItem,
  type HistoryItem, type RelatedLabels,
} from "../lib/communication-history.ts";
import { inProspectScope } from "../lib/profile-lists.ts";
import { renderLetterPdf, letterPdfFilename } from "../lib/letter-document.ts";
import { businessDateStr } from "../lib/date.ts";
import { estimateBranding } from "./estimates.ts";
import { senderName } from "./estimate-email.ts";

const router: IRouter = Router();
const PATHS = ["/customers/:id/communications", "/prospects/:id/communications"];
const idOf = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

router.use(PATHS, (req, res, next) => {
  if (isAssignmentScopedOperationalRole(req.user?.role) || !hasCapability(req.user?.role, "communication.view")) {
    res.status(403).json({ error: "Communication history access is required", code: "forbidden" });
    return;
  }
  next();
});

async function profileOf(req: Request, res: Response): Promise<number | null> {
  const id = idOf(req.params.id);
  const [profile] = id ? await db.select({
    id: customersTable.id, lifecycleStatus: customersTable.lifecycleStatus,
    deactivatedFrom: customersTable.deactivatedFrom, customerDate: customersTable.customerDate,
  }).from(customersTable).where(eq(customersTable.id, id)) : [];
  if (!profile || (req.path.startsWith("/prospects/") && !inProspectScope(profile))) {
    res.status(404).json({ error: "Profile not found" });
    return null;
  }
  return profile.id;
}

/** Everything sent to this profile, each once, as history entries (deletions not yet applied). */
async function entriesOf(customerId: number): Promise<{ items: Array<HistoryItem | null>; deleted: Set<string> }> {
  const [quotes, invoices, jobs] = await Promise.all([
    db.select({ id: quotesTable.id, number: quotesTable.quoteNumber }).from(quotesTable).where(eq(quotesTable.customerId, customerId)),
    db.select({ id: invoicesTable.id, number: invoicesTable.invoiceNumber }).from(invoicesTable).where(eq(invoicesTable.customerId, customerId)),
    db.select({ id: jobsTable.id, number: jobsTable.jobNumber }).from(jobsTable).where(eq(jobsTable.customerId, customerId)),
  ]);
  const labels: RelatedLabels = {
    quote: new Map(quotes.map((q) => [q.id, q.number])),
    invoice: new Map(invoices.map((i) => [i.id, i.number])),
    job: new Map(jobs.map((j) => [j.id, j.number])),
  };
  const scopes = [
    and(eq(messageLogsTable.relatedType, "customer"), eq(messageLogsTable.relatedId, customerId)),
    ...(jobs.length ? [and(eq(messageLogsTable.relatedType, "job"), inArray(messageLogsTable.relatedId, jobs.map((j) => j.id)))] : []),
    ...(quotes.length ? [and(eq(messageLogsTable.relatedType, "quote"), inArray(messageLogsTable.relatedId, quotes.map((q) => q.id)))] : []),
    ...(invoices.length ? [and(eq(messageLogsTable.relatedType, "invoice"), inArray(messageLogsTable.relatedId, invoices.map((i) => i.id)))] : []),
  ];
  const [emails, messages, deliveries, letters, deletions] = await Promise.all([
    db.select().from(emailLogsTable).where(and(eq(emailLogsTable.entityType, "customer"), eq(emailLogsTable.entityId, customerId)))
      .orderBy(desc(emailLogsTable.createdAt)).limit(500),
    db.select().from(messageLogsTable).where(or(...scopes)).orderBy(desc(messageLogsTable.createdAt)).limit(500),
    quotes.length
      ? db.select().from(estimateDeliveryRequestsTable).where(inArray(estimateDeliveryRequestsTable.quoteId, quotes.map((q) => q.id)))
      : Promise.resolve([]),
    db.select().from(printedLettersTable).where(eq(printedLettersTable.customerId, customerId)).orderBy(desc(printedLettersTable.printedAt)).limit(500),
    db.select({ source: communicationDeletionsTable.source, sourceId: communicationDeletionsTable.sourceId })
      .from(communicationDeletionsTable).where(eq(communicationDeletionsTable.customerId, customerId)),
  ]);
  const campaignIds = [...new Set(emails.map((e) => e.campaignId).filter((v): v is number => v != null))];
  const campaigns = campaignIds.length ? await db.select({
    id: emailCampaignsTable.id, name: emailCampaignsTable.name, createdBy: emailCampaignsTable.createdBy, automationRuleId: emailCampaignsTable.automationRuleId,
  }).from(emailCampaignsTable).where(inArray(emailCampaignsTable.id, campaignIds)) : [];
  const requesters = [...new Set(deliveries.map((d) => d.requestedBy).filter((v): v is string => !!v))];
  const users = requesters.length ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, username: usersTable.username })
    .from(usersTable).where(inArray(usersTable.id, requesters)) : [];
  const names = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "Team member"]));
  return {
    items: [
      ...emails.map((e) => emailItem(e, campaigns.find((c) => c.id === e.campaignId), labels)),
      ...messages.map((m) => messageItem(m, labels)),
      ...deliveries.map((d) => deliveryItem(d, labels, names)),
      ...letters.map((l) => letterItem(l)),
    ],
    deleted: new Set(deletions.map((d) => `${d.source}:${d.sourceId}`)),
  };
}

router.get(PATHS, async (req, res): Promise<void> => {
  const customerId = await profileOf(req, res);
  if (!customerId) return;
  const { items, deleted } = await entriesOf(customerId);
  const all = historyOf(items, deleted);
  res.json({
    items: historyOf(items, deleted, { type: historyTypeOf(req.query.type), q: typeof req.query.q === "string" ? req.query.q : null }),
    counts: { all: all.length, email: all.filter((i) => i.type === "email").length, text: all.filter((i) => i.type === "text").length, letter: all.filter((i) => i.type === "letter").length },
    canDelete: hasCapability(req.user?.role, "communication.history.delete"),
  });
});

/** One entry of this profile's history, or null when it is not this profile's or was removed. */
async function entryOf(customerId: number, key: string): Promise<HistoryItem | null> {
  const { items, deleted } = await entriesOf(customerId);
  return historyOf(items, deleted).find((item) => item.key === key) ?? null;
}

router.get(PATHS.map((p) => `${p}/:key`), async (req, res): Promise<void> => {
  const customerId = await profileOf(req, res);
  if (!customerId) return;
  const item = await entryOf(customerId, String(req.params.key));
  if (!item) { res.status(404).json({ error: "That entry is not in this profile's history" }); return; }
  if (item.source === "email") {
    const [log] = await db.select({ bodyHtml: emailLogsTable.bodyHtml, errorMessage: emailLogsTable.errorMessage }).from(emailLogsTable).where(eq(emailLogsTable.id, item.sourceId));
    res.json({ ...item, bodyHtml: log?.bodyHtml ?? "", error: log?.errorMessage ?? null });
    return;
  }
  if (item.source === "letter") {
    const [letter] = await db.select().from(printedLettersTable).where(eq(printedLettersTable.id, item.sourceId));
    res.json({ ...item, body: letter?.body ?? "", subject: letter?.subject ?? null, recipientLines: letter?.recipientLines ?? [] });
    return;
  }
  if (item.source === "message" && item.viewable) {
    const [message] = await db.select({ body: messageLogsTable.body }).from(messageLogsTable).where(eq(messageLogsTable.id, item.sourceId));
    res.json({ ...item, body: message?.body ?? "" });
    return;
  }
  res.json(item);
});

router.get(PATHS.map((p) => `${p}/:key/pdf`), async (req, res): Promise<void> => {
  const customerId = await profileOf(req, res);
  if (!customerId) return;
  const item = await entryOf(customerId, String(req.params.key));
  if (!item || item.source !== "letter") { res.status(404).json({ error: "That letter is not in this profile's history" }); return; }
  const [letter] = await db.select().from(printedLettersTable).where(eq(printedLettersTable.id, item.sourceId));
  const { businessName, branding } = await estimateBranding();
  // The letter as it was printed: its own date, address and words.
  const date = letter.printedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" });
  const pdf = renderLetterPdf([{ date, recipientLines: letter.recipientLines, subject: letter.subject, body: letter.body }],
    { businessName, contactLines: branding.contactLines, logo: branding.logo });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${letterPdfFilename(letter.recipientLines[0] ?? "letter", businessDateStr(letter.printedAt))}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(pdf);
});

router.post(PATHS.map((p) => `${p}/delete`), async (req, res): Promise<void> => {
  if (!hasCapability(req.user?.role, "communication.history.delete")) {
    res.status(403).json({ error: "Only the owner or an admin can delete communication history", code: "forbidden" });
    return;
  }
  const customerId = await profileOf(req, res);
  if (!customerId) return;
  const parsed = deletionTargets((req.body ?? {}).keys);
  if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
  // Only entries of this profile's own history, as it stands now.
  const { items, deleted } = await entriesOf(customerId);
  const current = new Map(historyOf(items, new Set()).map((item) => [item.key, item]));
  const chosen = parsed.targets.map((t) => current.get(`${t.source}:${t.sourceId}`));
  if (chosen.some((item) => !item)) { res.status(404).json({ error: "One of those entries is not in this profile's history" }); return; }
  const fresh = (chosen as HistoryItem[]).filter((item) => !deleted.has(item.key));
  const by = senderName(req);
  const inserted = fresh.length ? await db.transaction(async (tx) => {
    const rows = await tx.insert(communicationDeletionsTable).values(fresh.map((item) => ({
      customerId, source: item.source, sourceId: item.sourceId,
      summary: `${item.type === "text" ? "Text" : item.type === "letter" ? "Letter" : "Email"}: ${item.title}${item.to ? ` — ${item.to}` : ""} (${item.at.slice(0, 10)})`.slice(0, 500),
      deletedBy: by, deletedByUserId: req.user?.id ?? null,
    }))).onConflictDoNothing().returning({ id: communicationDeletionsTable.id });
    if (rows.length) {
      await tx.insert(activityLogsTable).values({
        entityType: "customer", entityId: customerId, action: "communication_deleted",
        note: `Removed ${rows.length} ${rows.length === 1 ? "entry" : "entries"} from the communication history`,
        toValue: String(rows.length), performedBy: by,
      });
    }
    return rows.length;
  }) : 0;
  res.json({ deleted: inserted, alreadyDeleted: chosen.length - fresh.length });
});

export default router;
