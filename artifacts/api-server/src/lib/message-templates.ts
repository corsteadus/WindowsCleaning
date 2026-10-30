/**
 * A5 (Kyle, Video 8): the rules for a saved template — email, text or letter.
 * Kept apart from the routes so they can be checked without a database.
 */
import { ESTIMATE_EMAIL_TAGS } from "./estimate-email.ts";
import { INVOICE_EMAIL_TAGS } from "./invoice-email.ts";
import { htmlToText, PROFILE_TAG_KEYS, textToHtml, unknownTagError } from "./merge-tags.ts";

export const TEMPLATE_CHANNELS = ["email", "sms", "letter"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];
export const MAX_TEMPLATE_NAME = 120;
export const MAX_SUBJECT = 300;
export const MAX_EMAIL_BODY = 20000;
/** Ten text segments; anything longer is not a text. */
export const MAX_SMS_BODY = 1600;
export const MAX_LETTER_BODY = 20000;

const bare = (tags: ReadonlyArray<{ tag: string }>) => tags.map((t) => t.tag.replace(/^\{\{|\}\}$/g, ""));
/** An email template may also be used from an estimate or an invoice, so their tags are allowed too. */
export const TEMPLATE_TAGS: Record<TemplateChannel, readonly string[]> = {
  email: [...new Set([...PROFILE_TAG_KEYS, ...bare(ESTIMATE_EMAIL_TAGS), ...bare(INVOICE_EMAIL_TAGS)])],
  sms: PROFILE_TAG_KEYS,
  letter: PROFILE_TAG_KEYS,
};

export const channelOf = (value: unknown): TemplateChannel | null =>
  (TEMPLATE_CHANNELS as readonly unknown[]).includes(value) ? value as TemplateChannel : null;

export interface TemplateFields { name: string; subject: string; bodyHtml: string; bodyText: string }

/**
 * What the office typed, as stored: the plain text it edits and, for an email,
 * the safe HTML it sends. An email template written as HTML elsewhere (the
 * Communications page) keeps its HTML.
 */
export function templateOf(channel: TemplateChannel, raw: Record<string, unknown>): { template: TemplateFields } | { error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { error: "Give the template a name" };
  if (name.length > MAX_TEMPLATE_NAME) return { error: `The name can be up to ${MAX_TEMPLATE_NAME} characters` };
  const subject = typeof raw.subject === "string" ? raw.subject.replace(/[\r\n]+/g, " ").trim() : "";
  if (channel === "email" && !subject) return { error: "An email template needs a subject" };
  if (subject.length > MAX_SUBJECT) return { error: `The subject can be up to ${MAX_SUBJECT} characters` };
  const html = typeof raw.bodyHtml === "string" ? raw.bodyHtml.trim() : "";
  const text = typeof raw.bodyText === "string" ? raw.bodyText.replace(/\r\n/g, "\n").trim() : "";
  const bodyText = text || (html ? htmlToText(html) : "");
  if (!bodyText) return { error: "Write the message" };
  const max = channel === "sms" ? MAX_SMS_BODY : channel === "letter" ? MAX_LETTER_BODY : MAX_EMAIL_BODY;
  if (bodyText.length > max) return { error: `The message can be up to ${max.toLocaleString("en-US")} characters` };
  const tagError = unknownTagError([subject, bodyText, html], TEMPLATE_TAGS[channel]);
  if (tagError) return { error: tagError };
  return {
    template: {
      name,
      subject: channel === "sms" ? "" : subject,
      bodyText,
      bodyHtml: channel === "email" ? (text ? textToHtml(text) : html) : "",
    },
  };
}

/** A text message's length in SMS segments (GSM-7 160/153; anything else 70/67). */
export function smsSegments(text: string): { characters: number; segments: number; unicode: boolean } {
  const unicode = /[^\n\r\x20-\x7E£¥èéùìòÇØøÅå€]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const characters = [...text].length;
  return { characters, segments: characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / multi), unicode };
}
