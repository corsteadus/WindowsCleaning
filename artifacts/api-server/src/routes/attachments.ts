import { Router, type IRouter, type Request } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, attachmentsTable, activityLogsTable, propertiesTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";

function getPerformedBy(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || String((req.user as { id: string }).id);
}

const objectStorageService = new ObjectStorageService();

/**
 * The location a file is filed under — phase 3, Kyle's Videos 4 and 5: photos,
 * documents and videos "organised by job location". One of this profile's own
 * locations, or none (the profile as a whole).
 */
async function locationFor(entityType: string, entityId: number, raw: unknown): Promise<{ propertyId: number | null } | { error: string }> {
  if (raw === undefined || raw === null || raw === "") return { propertyId: null };
  const propertyId = Number(raw);
  if (!Number.isInteger(propertyId) || propertyId <= 0) return { error: "Invalid location" };
  if (entityType !== "customer") return { error: "Only a profile's files are filed by location" };
  const [property] = await db.select({ id: propertiesTable.id }).from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.customerId, entityId))).limit(1);
  return property ? { propertyId } : { error: "That location is not on this profile" };
}

const router: IRouter = Router();

// ─── GET /attachments — list by entity ───────────────────────────────────────
router.get("/attachments", async (req, res): Promise<void> => {
  const { entityType, entityId } = req.query;
  if (!entityType || !entityId) {
    res.status(400).json({ error: "entityType and entityId are required" });
    return;
  }
  const rows = await db
    .select()
    .from(attachmentsTable)
    .where(and(
      eq(attachmentsTable.entityType, String(entityType)),
      eq(attachmentsTable.entityId, parseInt(String(entityId), 10)),
    ))
    .orderBy(desc(attachmentsTable.createdAt));
  res.json({ attachments: rows });
});

// ─── POST /attachments — register after upload ────────────────────────────────
router.post("/attachments", async (req, res): Promise<void> => {
  const { entityType, entityId, objectPath, fileName, fileType, fileSize, description, propertyId } = req.body;

  if (!entityType || !entityId || !objectPath || !fileName || !fileType) {
    res.status(400).json({ error: "entityType, entityId, objectPath, fileName, fileType are required" });
    return;
  }

  const uploadedBy = getPerformedBy(req);

  const normalized = objectStorageService.normalizeObjectEntityPath(objectPath);

  const entityIdNum = parseInt(String(entityId), 10);
  const location = await locationFor(String(entityType), entityIdNum, propertyId);
  if ("error" in location) { res.status(400).json({ error: location.error }); return; }
  const [row] = await db.insert(attachmentsTable).values({
    entityType: String(entityType),
    entityId: entityIdNum,
    objectPath: normalized,
    fileName: String(fileName),
    fileType: String(fileType),
    fileSize: fileSize ? parseInt(String(fileSize), 10) : null,
    propertyId: location.propertyId,
    description: description ? String(description) : null,
    uploadedBy,
  }).returning();

  // Log file upload to entity activity timeline
  await db.insert(activityLogsTable).values({
    entityType: String(entityType),
    entityId: entityIdNum,
    action: "file_uploaded",
    toValue: String(fileName),
    note: `File "${fileName}" uploaded${uploadedBy ? ` by ${uploadedBy}` : ""}`,
    performedBy: uploadedBy,
  }).catch(() => {});

  res.status(201).json({ attachment: row });
});

// ─── PATCH /attachments/:id — file it under another location ─────────────────
router.patch("/attachments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const location = await locationFor(row.entityType, row.entityId, req.body?.propertyId);
  if ("error" in location) { res.status(400).json({ error: location.error }); return; }

  const [updated] = await db.update(attachmentsTable).set({ propertyId: location.propertyId })
    .where(eq(attachmentsTable.id, id)).returning();

  await db.insert(activityLogsTable).values({
    entityType: row.entityType,
    entityId: row.entityId,
    action: "file_moved",
    toValue: row.fileName,
    note: `File "${row.fileName}" moved to another location`,
    performedBy: getPerformedBy(req),
  }).catch(() => {});

  res.json({ attachment: updated });
});

// ─── DELETE /attachments/:id ──────────────────────────────────────────────────
router.delete("/attachments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  // Delete from storage
  try {
    const file = await objectStorageService.getObjectEntityFile(row.objectPath);
    await file.delete();
  } catch {
    // File may already be gone; proceed with DB deletion
  }

  await db.delete(attachmentsTable).where(eq(attachmentsTable.id, id));

  // Log file deletion to entity activity timeline
  await db.insert(activityLogsTable).values({
    entityType: row.entityType,
    entityId: row.entityId,
    action: "file_deleted",
    toValue: row.fileName,
    note: `File "${row.fileName}" deleted`,
    performedBy: getPerformedBy(req),
  }).catch(() => {});

  res.json({ deleted: true });
});

export default router;
