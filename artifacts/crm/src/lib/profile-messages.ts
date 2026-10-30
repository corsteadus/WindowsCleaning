/**
 * A5 (Kyle, Video 8): writing to a profile — email, text or letter — from a
 * saved template or from scratch. The server fills the tags from the record and
 * refuses one it does not know; these helpers only shape what the screen shows.
 */
export type MessageChannel = "email" | "sms" | "letter";

export const CHANNEL_LABEL: Record<MessageChannel, string> = { email: "Email", sms: "Text", letter: "Letter" };

export interface MessageTemplate {
  id: number;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  channel: MessageChannel;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ProfileTagInfo { tag: string; label: string; group: string }

export interface MessagePreview {
  subject: string;
  text: string;
  sms: { characters: number; segments: number; unicode: boolean } | null;
  recipientLines: string[] | null;
  emptyTags: string[];
}

/** The text a template opens with in the composer; an HTML-only template is turned back into text. */
export function templateText(template: Pick<MessageTemplate, "bodyText" | "bodyHtml">): string {
  if (template.bodyText?.trim()) return template.bodyText;
  return htmlToText(template.bodyHtml);
}

/** An older email's HTML as the plain text the composer edits (Resend). */
export function htmlToText(html: string): string {
  return html
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The text with the tag put where the cursor was, and where the cursor goes next. */
export function insertTag(text: string, start: number, end: number, tag: string): { text: string; cursor: number } {
  const token = `{{${tag}}}`;
  return { text: text.slice(0, start) + token + text.slice(end), cursor: start + token.length };
}

/** Whether the composer holds something other than the template it started from. */
export function differsFromTemplate(template: MessageTemplate | null, subject: string, body: string): boolean {
  if (!template) return false;
  return template.subject.trim() !== subject.trim() || templateText(template).trim() !== body.trim();
}

/** "1 text · 87 characters" — what the customer's phone will receive. */
export function smsLengthLabel(sms: { characters: number; segments: number }): string {
  return `${sms.segments} ${sms.segments === 1 ? "text" : "texts"} · ${sms.characters} characters`;
}

/** The tags grouped as the picker shows them, in the server's order. */
export function groupTags(tags: ProfileTagInfo[]): Array<{ group: string; tags: ProfileTagInfo[] }> {
  const groups: Array<{ group: string; tags: ProfileTagInfo[] }> = [];
  for (const tag of tags) {
    const found = groups.find((g) => g.group === tag.group);
    if (found) found.tags.push(tag); else groups.push({ group: tag.group, tags: [tag] });
  }
  return groups;
}
