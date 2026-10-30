import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, notExists } from "drizzle-orm";
import { communicationDeletionsTable, customersTable, db, emailCampaignsTable, emailLogsTable } from "@workspace/db";
import { hasCapability, isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { emailHistory, emailHistoryEntry, type CampaignRow } from "../lib/email-history.ts";
import { inProspectScope } from "../lib/profile-lists.ts";

/**
 * A profile's email history, and one email in full — phase 2 (Kyle, Video 4).
 * Reading it needs communication.view as well as the profile; a technician
 * never sees it (what they see is their assigned work).
 */
const router: IRouter = Router();

const idOf = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

router.use(["/customers/:id/emails", "/prospects/:id/emails"], (req, res, next) => {
  if (isAssignmentScopedOperationalRole(req.user?.role) || !hasCapability(req.user?.role, "communication.view")) {
    res.status(403).json({ error: "Communication history access is required", code: "forbidden" });
    return;
  }
  next();
});

async function scopedProfile(id: number, prospectOnly: boolean) {
  const [profile] = await db.select({
    id: customersTable.id, lifecycleStatus: customersTable.lifecycleStatus,
    deactivatedFrom: customersTable.deactivatedFrom, customerDate: customersTable.customerDate,
  }).from(customersTable).where(eq(customersTable.id, id));
  if (!profile || (prospectOnly && !inProspectScope(profile))) return null;
  return profile;
}

async function campaignsFor(ids: number[]): Promise<CampaignRow[]> {
  if (!ids.length) return [];
  return db.select({
    id: emailCampaignsTable.id, name: emailCampaignsTable.name,
    createdBy: emailCampaignsTable.createdBy, automationRuleId: emailCampaignsTable.automationRuleId,
  }).from(emailCampaignsTable).where(inArray(emailCampaignsTable.id, ids));
}

// A6: an email the owner or an admin removed from the history is not shown here either.
const ofProfile = (id: number) => and(eq(emailLogsTable.entityType, "customer"), eq(emailLogsTable.entityId, id), notExists(
  db.select({ id: communicationDeletionsTable.id }).from(communicationDeletionsTable)
    .where(and(eq(communicationDeletionsTable.source, "email"), eq(communicationDeletionsTable.sourceId, emailLogsTable.id))),
));

router.get(["/customers/:id/emails", "/prospects/:id/emails"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  if (!id || !(await scopedProfile(id, req.path.startsWith("/prospects/")))) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const logs = await db.select().from(emailLogsTable).where(ofProfile(id)).orderBy(desc(emailLogsTable.createdAt)).limit(200);
  const campaignIds = [...new Set(logs.map((log) => log.campaignId).filter((value): value is number => value != null))];
  res.json(emailHistory(logs, await campaignsFor(campaignIds)));
});

router.get(["/customers/:id/emails/:emailId", "/prospects/:id/emails/:emailId"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const emailId = idOf(req.params.emailId);
  if (!id || !emailId || !(await scopedProfile(id, req.path.startsWith("/prospects/")))) {
    res.status(404).json({ error: "Email not found" });
    return;
  }
  const [log] = await db.select().from(emailLogsTable).where(and(ofProfile(id), eq(emailLogsTable.id, emailId)));
  if (!log) { res.status(404).json({ error: "Email not found" }); return; }
  const [campaign] = log.campaignId ? await campaignsFor([log.campaignId]) : [];
  res.json({ ...emailHistoryEntry(log, campaign), bodyHtml: log.bodyHtml });
});

export default router;
