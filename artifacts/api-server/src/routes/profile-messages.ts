/**
 * A5 (Kyle, Video 8): writing to a profile — the email, text and letter
 * composers' preview, and the printed letter. Every tag is filled here from the
 * record, and a tag Corstead does not know is refused rather than printed.
 *
 *   POST /profile-messages/:customerId/preview   what the customer will get
 *   POST /profile-messages/:customerId/letter    the letter as a PDF
 *   POST /letters/pdf                            one template to many profiles, one PDF
 */
import { Router, type IRouter, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db, emailTemplatesTable, printedLettersTable } from "@workspace/db";
import { requireFinancialCapability } from "../lib/financial-permissions";
import { fillTags, PROFILE_TAG_KEYS, textToHtml, unknownTagError } from "../lib/merge-tags.ts";
import { channelOf, MAX_EMAIL_BODY, MAX_LETTER_BODY, MAX_SMS_BODY, MAX_SUBJECT, smsSegments, type TemplateChannel } from "../lib/message-templates.ts";
import { loadProfileForMessages, type ProfileForMessages } from "../lib/profile-tag-values.ts";
import { letterPdfFilename, MAX_LETTERS_PER_PDF, renderLetterPdf, type LetterContent } from "../lib/letter-document.ts";
import { businessDateStr } from "../lib/date.ts";
import { estimateBranding } from "./estimates.ts";
import { senderName } from "./estimate-email.ts";

const router: IRouter = Router();
const sendCommunication = requireFinancialCapability("communication.send");

const MAX_BODY: Record<TemplateChannel, number> = { email: MAX_EMAIL_BODY, sms: MAX_SMS_BODY, letter: MAX_LETTER_BODY };
const idOf = (value: unknown) => (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)) ? Number(value) : null);

interface Draft { subject: string; body: string; templateId: number | null; templateName: string | null }

/** What the office wrote, or the saved template it chose; checked for length and unknown tags. */
async function draftOf(channel: TemplateChannel, raw: Record<string, unknown>): Promise<{ draft: Draft } | { error: string; status?: number }> {
  const templateId = raw.templateId == null || raw.templateId === "" ? null : idOf(raw.templateId);
  if (raw.templateId != null && raw.templateId !== "" && !templateId) return { error: "That template does not exist", status: 404 };
  let subject = typeof raw.subject === "string" ? raw.subject : "";
  let body = typeof raw.body === "string" ? raw.body : "";
  let templateName: string | null = null;
  if (templateId && !body.trim()) {
    const [template] = await db.select().from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.id, templateId), eq(emailTemplatesTable.channel, channel))).limit(1);
    if (!template) return { error: "That template does not exist", status: 404 };
    subject = template.subject;
    body = template.bodyText ?? "";
    templateName = template.name;
  } else if (templateId) {
    const [template] = await db.select({ name: emailTemplatesTable.name }).from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.id, templateId), eq(emailTemplatesTable.channel, channel))).limit(1);
    templateName = template?.name ?? null;
  }
  subject = subject.replace(/[\r\n]+/g, " ").trim();
  body = body.replace(/\r\n/g, "\n").trim();
  if (!body) return { error: "Write the message first" };
  if (subject.length > MAX_SUBJECT) return { error: `The subject can be up to ${MAX_SUBJECT} characters` };
  if (body.length > MAX_BODY[channel]) return { error: `The message can be up to ${MAX_BODY[channel].toLocaleString("en-US")} characters` };
  const tagError = unknownTagError([subject, body], PROFILE_TAG_KEYS);
  if (tagError) return { error: tagError };
  return { draft: { subject, body, templateId: templateName ? templateId : null, templateName } };
}

const fill = (draft: Draft, profile: ProfileForMessages) => ({
  subject: fillTags(draft.subject, profile.values).replace(/\s+/g, " ").trim(),
  text: fillTags(draft.body, profile.values),
});
/** Tags that came out empty for this profile, so the office sees the gap before sending. */
const emptyTags = (draft: Draft, profile: ProfileForMessages) =>
  [...new Set([...`${draft.subject}\n${draft.body}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))]
    .filter((tag) => !profile.values[tag as keyof typeof profile.values]);

async function profileOr404(req: Request, res: import("express").Response): Promise<ProfileForMessages | null> {
  const customerId = idOf(req.params.customerId);
  const profile = customerId ? await loadProfileForMessages(customerId, senderName(req)) : null;
  if (!profile) res.status(404).json({ error: "Profile not found" });
  return profile;
}

const letterOf = (profile: ProfileForMessages, draft: Draft): LetterContent => {
  const filled = fill(draft, profile);
  return { date: profile.values.today, recipientLines: profile.mailingLines, subject: filled.subject || null, body: filled.text };
};

/** A6: each letter as printed goes into the profile's communication history, to read or print again. */
async function logLetters(req: Request, letters: Array<{ profile: ProfileForMessages; letter: LetterContent }>, draft: Draft) {
  if (!letters.length) return;
  await db.insert(printedLettersTable).values(letters.map(({ profile, letter }) => ({
    customerId: profile.id, templateId: draft.templateId, templateName: draft.templateName,
    subject: letter.subject, body: letter.body, recipientLines: letter.recipientLines, printedBy: senderName(req),
  })));
}

// ─── Preview: the message as this customer will get it ──────────────────────
router.post("/profile-messages/:customerId/preview", sendCommunication, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const channel = channelOf(body.channel);
  if (!channel) { res.status(400).json({ error: "channel must be email, sms or letter" }); return; }
  const profile = await profileOr404(req, res);
  if (!profile) return;
  const parsed = await draftOf(channel, body);
  if ("error" in parsed) { res.status(parsed.status ?? 400).json({ error: parsed.error }); return; }
  const filled = fill(parsed.draft, profile);
  res.json({
    channel,
    subject: filled.subject,
    text: filled.text,
    html: channel === "email" ? textToHtml(filled.text) : null,
    sms: channel === "sms" ? smsSegments(filled.text) : null,
    recipientLines: channel === "letter" ? profile.mailingLines : null,
    emptyTags: emptyTags(parsed.draft, profile),
  });
});

// ─── One letter, for this profile ─────────────────────────────────────────────
router.post("/profile-messages/:customerId/letter", sendCommunication, async (req, res): Promise<void> => {
  const profile = await profileOr404(req, res);
  if (!profile) return;
  const parsed = await draftOf("letter", (req.body ?? {}) as Record<string, unknown>);
  if ("error" in parsed) { res.status(parsed.status ?? 400).json({ error: parsed.error }); return; }
  if (profile.mailingLines.length < 2) {
    res.status(400).json({ error: "This profile has no mailing address. Add one before printing a letter." });
    return;
  }
  const { businessName, branding } = await estimateBranding();
  const letter = letterOf(profile, parsed.draft);
  const pdf = renderLetterPdf([letter], { businessName, contactLines: branding.contactLines, logo: branding.logo });
  await logLetters(req, [{ profile, letter }], parsed.draft);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${letterPdfFilename(profile.values.customer_name, businessDateStr())}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(pdf);
});

// ─── One template, several profiles, one PDF ─────────────────────────────────
router.post("/letters/pdf", sendCommunication, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(body.customerIds) ? [...new Set(body.customerIds.map(idOf))] : [];
  if (!ids.length || ids.some((id) => id == null)) { res.status(400).json({ error: "Choose the profiles to print a letter for" }); return; }
  if (ids.length > MAX_LETTERS_PER_PDF) { res.status(400).json({ error: `Print at most ${MAX_LETTERS_PER_PDF} letters at once` }); return; }
  const parsed = await draftOf("letter", body);
  if ("error" in parsed) { res.status(parsed.status ?? 400).json({ error: parsed.error }); return; }
  const sender = senderName(req);
  const profiles: ProfileForMessages[] = [];
  const skipped: string[] = [];
  for (const id of ids as number[]) {
    const profile = await loadProfileForMessages(id, sender);
    if (!profile) { res.status(404).json({ error: `Profile #${id} not found` }); return; }
    if (profile.mailingLines.length < 2) skipped.push(profile.values.customer_name || `#${id}`);
    else profiles.push(profile);
  }
  if (!profiles.length) { res.status(400).json({ error: "None of these profiles has a mailing address" }); return; }
  const { businessName, branding } = await estimateBranding();
  const letters = profiles.map((profile) => ({ profile, letter: letterOf(profile, parsed.draft) }));
  const pdf = renderLetterPdf(letters.map((l) => l.letter), { businessName, contactLines: branding.contactLines, logo: branding.logo }, "Letters");
  await logLetters(req, letters, parsed.draft);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Letters-${businessDateStr()}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  // Who was left out, so the screen can say so; header-safe (names are ASCII-folded and short).
  if (skipped.length) res.setHeader("X-Letters-Skipped", encodeURIComponent(skipped.slice(0, 20).join("; ")));
  res.send(pdf);
});

export default router;
