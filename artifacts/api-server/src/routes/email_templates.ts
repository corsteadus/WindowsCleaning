import { Router, type IRouter } from "express";
import { and, asc, eq, ne } from "drizzle-orm";
import { automationRulesTable, db, emailTemplatesTable } from "@workspace/db";
import { channelOf, templateOf, TEMPLATE_TAGS, type TemplateChannel } from "../lib/message-templates.ts";
import { PROFILE_TAGS } from "../lib/merge-tags.ts";
import { senderName } from "./estimate-email.ts";

const router: IRouter = Router();

// A5 (Kyle, Video 8): one store for email, text and letter templates. A request
// without a channel means email, so every older screen and the automations keep
// seeing only email templates.
const requestedChannel = (value: unknown): TemplateChannel | null => (value == null || value === "" ? "email" : channelOf(value));
const idOf = (value: string) => (/^\d+$/.test(value) ? Number(value) : null);

const nameTaken = async (channel: TemplateChannel, name: string, exceptId?: number) => {
  const rows = await db.select({ id: emailTemplatesTable.id, name: emailTemplatesTable.name }).from(emailTemplatesTable)
    .where(exceptId ? and(eq(emailTemplatesTable.channel, channel), ne(emailTemplatesTable.id, exceptId)) : eq(emailTemplatesTable.channel, channel));
  return rows.some((row) => row.name.trim().toLowerCase() === name.toLowerCase());
};

// ─── The tags a template can use, per channel ────────────────────────────────
router.get("/email-templates/tags", (_req, res): void => {
  res.json({ profileTags: PROFILE_TAGS, allowed: TEMPLATE_TAGS });
});

// ─── List templates (one channel) ─────────────────────────────────────────────
router.get("/email-templates", async (req, res): Promise<void> => {
  const channel = requestedChannel(req.query.channel);
  if (!channel) { res.status(400).json({ error: "channel must be email, sms or letter" }); return; }
  const rows = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.channel, channel))
    .orderBy(asc(emailTemplatesTable.name));
  res.json({ templates: rows });
});

// ─── Get single template ──────────────────────────────────────────────────────
router.get("/email-templates/:id", async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  if (!id) { res.status(404).json({ error: "Template not found" }); return; }
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
  const body = (req.body ?? {}) as Record<string, unknown>;
  const channel = requestedChannel(body.channel);
  if (!channel) { res.status(400).json({ error: "channel must be email, sms or letter" }); return; }
  const parsed = templateOf(channel, body);
  if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
  if (await nameTaken(channel, parsed.template.name)) {
    res.status(409).json({ error: `There is already a template called “${parsed.template.name}”` });
    return;
  }
  const by = senderName(req);
  const [row] = await db
    .insert(emailTemplatesTable)
    .values({ ...parsed.template, channel, isDefault: body.isDefault === true, createdBy: by, updatedBy: by })
    .returning();
  res.status(201).json(row);
});

// ─── Update template ──────────────────────────────────────────────────────────
router.patch("/email-templates/:id", async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const [existing] = id ? await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id)).limit(1) : [];
  if (!existing) { res.status(404).json({ error: "Template not found" }); return; }
  const channel = existing.channel as TemplateChannel;
  const body = (req.body ?? {}) as Record<string, unknown>;
  // A partial update is checked as the whole template it would become.
  const merged = {
    name: body.name ?? existing.name,
    subject: body.subject ?? existing.subject,
    bodyText: body.bodyText ?? (body.bodyHtml !== undefined ? undefined : existing.bodyText ?? undefined),
    bodyHtml: body.bodyHtml ?? existing.bodyHtml,
  };
  const parsed = templateOf(channel, merged);
  if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
  if (await nameTaken(channel, parsed.template.name, existing.id)) {
    res.status(409).json({ error: `There is already a template called “${parsed.template.name}”` });
    return;
  }
  const [row] = await db
    .update(emailTemplatesTable)
    .set({ ...parsed.template, ...(typeof body.isDefault === "boolean" ? { isDefault: body.isDefault } : {}), updatedBy: senderName(req) })
    .where(eq(emailTemplatesTable.id, existing.id))
    .returning();
  res.json(row);
});

// ─── Delete template ──────────────────────────────────────────────────────────
router.delete("/email-templates/:id", async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  // An automation that names the template would quietly fall back to other wording.
  const [usedBy] = id ? await db.select({ name: automationRulesTable.name }).from(automationRulesTable)
    .where(eq(automationRulesTable.emailTemplateId, id)).limit(1) : [];
  if (usedBy) { res.status(409).json({ error: `The automation “${usedBy.name}” uses this template. Change the automation first.` }); return; }
  const [row] = id ? await db
    .delete(emailTemplatesTable)
    .where(eq(emailTemplatesTable.id, id))
    .returning() : [];
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ success: true });
});

export default router;
