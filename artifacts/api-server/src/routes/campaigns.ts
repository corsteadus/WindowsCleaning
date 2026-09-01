/**
 * Campaigns API
 *
 * GET  /campaigns         — list campaigns (paginated)
 * GET  /campaigns/:id     — single campaign with recipient stats
 * POST /campaigns/:id/cancel         — cancel a queued/processing campaign
 * POST /campaigns/:id/retry-failed   — re-queue permanently failed recipients
 */

import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, emailCampaignsTable, emailCampaignRecipientsTable } from "@workspace/db";
import {
  maskCommunicationDestination,
} from "../lib/communication-safety-store";
import { normalizeCommunicationDestination } from "../lib/communication-safety-core";

const router: IRouter = Router();

// ─── List campaigns ───────────────────────────────────────────────────────────
router.get("/campaigns", async (req, res): Promise<void> => {
  const page  = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const offset = (page - 1) * limit;

  const [rows, countResult] = await Promise.all([
    db.select().from(emailCampaignsTable)
      .orderBy(desc(emailCampaignsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(emailCampaignsTable),
  ]);

  const total = Number(countResult[0]?.count ?? 0);
  res.json({ campaigns: rows, total, page, totalPages: Math.ceil(total / limit) });
});

// ─── Single campaign ─────────────────────────────────────────────────────────
router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [campaign] = await db.select().from(emailCampaignsTable).where(eq(emailCampaignsTable.id, id)).limit(1);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  // Recipient status breakdown
  const stats = await db
    .select({
      status: emailCampaignRecipientsTable.status,
      count:  sql<number>`count(*)`,
    })
    .from(emailCampaignRecipientsTable)
    .where(eq(emailCampaignRecipientsTable.campaignId, id))
    .groupBy(emailCampaignRecipientsTable.status);

  const statusMap: Record<string, number> = {};
  for (const s of stats) statusMap[s.status] = Number(s.count);

  // Recent failed recipients (for error reporting)
  const failed = await db
    .select({
      id:           emailCampaignRecipientsTable.id,
      email:        emailCampaignRecipientsTable.email,
      firstName:    emailCampaignRecipientsTable.firstName,
      lastName:     emailCampaignRecipientsTable.lastName,
      status:       emailCampaignRecipientsTable.status,
      retryCount:   emailCampaignRecipientsTable.retryCount,
      errorMessage: emailCampaignRecipientsTable.errorMessage,
      lastRetryAt:  emailCampaignRecipientsTable.lastRetryAt,
    })
    .from(emailCampaignRecipientsTable)
    .where(
      and(
        eq(emailCampaignRecipientsTable.campaignId, id),
        sql`${emailCampaignRecipientsTable.status} IN ('failed', 'permanently_failed')`,
      )
    )
    .limit(50);

  res.json({
    campaign,
    recipientStatusBreakdown: statusMap,
    recentFailed: failed.map(({ email, ...recipient }) => ({
      ...recipient,
      maskedEmail: (() => {
        try {
          const normalized = normalizeCommunicationDestination("email", email).normalized;
          return maskCommunicationDestination("email", normalized);
        } catch {
          return null;
        }
      })(),
    })),
  });
});

// ─── Cancel campaign ─────────────────────────────────────────────────────────
router.post("/campaigns/:id/cancel", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [campaign] = await db.select().from(emailCampaignsTable).where(eq(emailCampaignsTable.id, id)).limit(1);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  if (!["queued", "processing"].includes(campaign.status)) {
    res.status(400).json({ error: `Cannot cancel a campaign with status '${campaign.status}'` });
    return;
  }

  // Mark all queued recipients as skipped
  await db.update(emailCampaignRecipientsTable)
    .set({ status: "skipped", updatedAt: new Date() })
    .where(
      and(
        eq(emailCampaignRecipientsTable.campaignId, id),
        eq(emailCampaignRecipientsTable.status, "queued"),
      )
    );

  await db.update(emailCampaignsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(emailCampaignsTable.id, id));

  res.json({ ok: true, status: "cancelled" });
});

// ─── Retry permanently failed recipients ─────────────────────────────────────
router.post("/campaigns/:id/retry-failed", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [campaign] = await db.select().from(emailCampaignsTable).where(eq(emailCampaignsTable.id, id)).limit(1);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const maxRetries = parseInt(String(req.body?.maxRetries ?? "3"), 10);

  // Reset permanently_failed recipients to queued with increased max_retries
  const result = await db.update(emailCampaignRecipientsTable)
    .set({
      status:       "queued",
      maxRetries,
      errorMessage: null,
      lastRetryAt:  null,
      updatedAt:    new Date(),
    })
    .where(
      and(
        eq(emailCampaignRecipientsTable.campaignId, id),
        eq(emailCampaignRecipientsTable.status, "permanently_failed"),
      )
    )
    .returning({ id: emailCampaignRecipientsTable.id });

  const requeued = result.length;

  if (requeued > 0) {
    // Re-queue campaign
    await db.update(emailCampaignsTable)
      .set({
        status:           "queued",
        permanentlyFailedCount: 0,
        failedCount:      0,
        queuedCount:      sql`${emailCampaignsTable.queuedCount} + ${requeued}`,
        updatedAt:        new Date(),
      })
      .where(eq(emailCampaignsTable.id, id));
  }

  res.json({ ok: true, requeued });
});

export default router;
