import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, activityLogsTable } from "@workspace/db";

const router: IRouter = Router();

// ─── List activity logs for an entity ────────────────────────────────────────
router.get("/activity-logs", async (req, res): Promise<void> => {
  const { entityType, entityId } = req.query;
  if (!entityType || !entityId) {
    res.status(400).json({ error: "entityType and entityId are required" });
    return;
  }
  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(and(
      eq(activityLogsTable.entityType, String(entityType)),
      eq(activityLogsTable.entityId, Number(entityId)),
    ))
    .orderBy(desc(activityLogsTable.createdAt));
  res.json(logs.map(serialize));
});

// ─── Create activity log entry ────────────────────────────────────────────────
router.post("/activity-logs", async (req, res): Promise<void> => {
  const body = req.body;
  if (!body.entityType || !body.entityId || !body.action) {
    res.status(400).json({ error: "entityType, entityId, and action are required" });
    return;
  }
  const [log] = await db.insert(activityLogsTable).values({
    entityType:  String(body.entityType),
    entityId:    Number(body.entityId),
    action:      String(body.action),
    fromValue:   body.fromValue   ?? null,
    toValue:     body.toValue     ?? null,
    reason:      body.reason      ?? null,
    note:        body.note        ?? null,
    performedBy: body.performedBy ?? null,
  }).returning();
  res.status(201).json(serialize(log));
});

function serialize(log: typeof activityLogsTable.$inferSelect) {
  return { ...log, createdAt: log.createdAt.toISOString() };
}

export default router;
