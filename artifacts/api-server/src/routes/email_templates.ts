import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, emailTemplatesTable } from "@workspace/db";

const router: IRouter = Router();

// ─── List all templates ───────────────────────────────────────────────────────
router.get("/email-templates", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(emailTemplatesTable)
    .orderBy(desc(emailTemplatesTable.createdAt));
  res.json({ templates: rows });
});

// ─── Get single template ──────────────────────────────────────────────────────
router.get("/email-templates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.id, id))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(row);
});

// ─── Create template ──────────────────────────────────────────────────────────
router.post("/email-templates", async (req, res): Promise<void> => {
  const { name, subject, bodyHtml, bodyText, isDefault } = req.body;
  if (!name || !subject || !bodyHtml) {
    res.status(400).json({ error: "name, subject, and bodyHtml are required" });
    return;
  }
  const [row] = await db
    .insert(emailTemplatesTable)
    .values({ name, subject, bodyHtml, bodyText: bodyText ?? null, isDefault: isDefault ?? false })
    .returning();
  res.status(201).json(row);
});

// ─── Update template ──────────────────────────────────────────────────────────
router.patch("/email-templates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { name, subject, bodyHtml, bodyText, isDefault } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined)     updates.name = name;
  if (subject !== undefined)  updates.subject = subject;
  if (bodyHtml !== undefined) updates.bodyHtml = bodyHtml;
  if (bodyText !== undefined) updates.bodyText = bodyText;
  if (isDefault !== undefined) updates.isDefault = isDefault;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" }); return;
  }
  const [row] = await db
    .update(emailTemplatesTable)
    .set(updates)
    .where(eq(emailTemplatesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(row);
});

// ─── Delete template ──────────────────────────────────────────────────────────
router.delete("/email-templates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .delete(emailTemplatesTable)
    .where(eq(emailTemplatesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ success: true });
});

export default router;
