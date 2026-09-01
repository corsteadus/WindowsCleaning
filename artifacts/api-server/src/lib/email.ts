/**
 * Email Service Layer
 *
 * Provider priority: SendGrid → Mailgun → SMTP → mock (dev/no-config)
 *
 * Required env vars (at least one provider):
 *   SendGrid:  SENDGRID_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME
 *   Mailgun:   MAILGUN_API_KEY, MAILGUN_DOMAIN, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME
 *   SMTP:      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME
 */

import nodemailer from "nodemailer";

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailPayload {
  to: EmailRecipient[];
  subject: string;
  html: string;
  text?: string;
}

export interface SendResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

// ─── Template variable substitution ──────────────────────────────────────────

export type TemplateVars = {
  first_name?: string;
  full_name?: string;
  company_name?: string;
  service_type?: string;
  last_service_date?: string;
  [key: string]: string | undefined;
};

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

// ─── Provider: SendGrid ───────────────────────────────────────────────────────

async function sendViaSendGrid(payload: EmailPayload): Promise<SendResult> {
  const apiKey = process.env.SENDGRID_API_KEY!;
  const fromEmail = process.env.EMAIL_FROM_ADDRESS!;
  const fromName = process.env.EMAIL_FROM_NAME ?? "Superior Professional Window Cleaning";

  const body = {
    personalizations: payload.to.map((r) => ({
      to: [{ email: r.email, name: r.name ?? "" }],
    })),
    from: { email: fromEmail, name: fromName },
    subject: payload.subject,
    content: [
      { type: "text/html", value: payload.html },
      ...(payload.text ? [{ type: "text/plain", value: payload.text }] : []),
    ],
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    return { success: false, provider: "sendgrid", error: errText };
  }

  const messageId = res.headers.get("x-message-id") ?? undefined;
  return { success: true, provider: "sendgrid", messageId };
}

// ─── Provider: Mailgun ────────────────────────────────────────────────────────

async function sendViaMailgun(payload: EmailPayload): Promise<SendResult> {
  const apiKey = process.env.MAILGUN_API_KEY!;
  const domain = process.env.MAILGUN_DOMAIN!;
  const fromEmail = process.env.EMAIL_FROM_ADDRESS!;
  const fromName = process.env.EMAIL_FROM_NAME ?? "Superior Professional Window Cleaning";

  const form = new URLSearchParams();
  form.set("from", `${fromName} <${fromEmail}>`);
  form.set("to", payload.to.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email)).join(", "));
  form.set("subject", payload.subject);
  form.set("html", payload.html);
  if (payload.text) form.set("text", payload.text);

  const credentials = Buffer.from(`api:${apiKey}`).toString("base64");
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    return { success: false, provider: "mailgun", error: errText };
  }

  const data = (await res.json()) as { id?: string };
  return { success: true, provider: "mailgun", messageId: data.id };
}

// ─── Provider: SMTP (via nodemailer) ─────────────────────────────────────────

async function sendViaSmtp(payload: EmailPayload): Promise<SendResult> {
  const fromEmail = process.env.EMAIL_FROM_ADDRESS!;
  const fromName = process.env.EMAIL_FROM_NAME ?? "Superior Professional Window Cleaning";

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: payload.to.map((r) => (r.name ? `"${r.name}" <${r.email}>` : r.email)).join(", "),
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
    return { success: true, provider: "smtp", messageId: info.messageId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, provider: "smtp", error: msg };
  }
}

// ─── Provider: Mock (no config) ──────────────────────────────────────────────

function sendViaMock(payload: EmailPayload): SendResult {
  console.log("[email:mock] Would send email:", {
    to: payload.to.map((r) => r.email),
    subject: payload.subject,
  });
  return {
    success: true,
    provider: "mock",
    messageId: `mock-${Date.now()}`,
  };
}

// ─── Detect provider ─────────────────────────────────────────────────────────

function detectProvider(): "sendgrid" | "mailgun" | "smtp" | "mock" {
  if (process.env.SENDGRID_API_KEY) return "sendgrid";
  if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) return "mailgun";
  if (process.env.SMTP_HOST) return "smtp";
  return "mock";
}

// ─── Public send function ────────────────────────────────────────────────────

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const provider = detectProvider();
  switch (provider) {
    case "sendgrid": return sendViaSendGrid(payload);
    case "mailgun":  return sendViaMailgun(payload);
    case "smtp":     return sendViaSmtp(payload);
    default:         return sendViaMock(payload);
  }
}

// ─── Send to a single recipient (convenience) ─────────────────────────────────

export async function sendEmailTo(
  recipient: EmailRecipient,
  subject: string,
  html: string,
  text?: string,
): Promise<SendResult> {
  return sendEmail({ to: [recipient], subject, html, text });
}
