import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { upsertSuppression } from "../lib/communication-safety-store.js";
import {
  readUnsubscribeToken,
  unsubscribeSecret,
} from "../lib/unsubscribe.js";
import { logger } from "../lib/logger.js";

/**
 * The customer's own way out — Kyle's correction note #6.
 *
 * Two deliberate choices.
 *
 * **Nothing happens on a GET.** Spam filters, link checkers and corporate
 * mail gateways follow every link in a message before a human sees it. An
 * unsubscribe that acted on the click would silently cut customers off who
 * never touched it. So the link opens a page with a button, and only the
 * button unsubscribes.
 *
 * **The scope is `global`.** Kyle asked that unsubscribing "deactivate it for
 * email sending", and a narrower scope would be theatre: the automation rules
 * are all transactional, so a `marketing` suppression would block nothing we
 * actually send. Global means an unsubscribed customer stops receiving
 * invoices by email too, which the page says in as many words rather than
 * leaving them to find out.
 *
 * The address stays on the profile throughout. Only sending stops, and the
 * office can turn it back on.
 */

const router: IRouter = Router();

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch
  ));

function page(title: string, body: string, status: "ask" | "done" | "gone"): string {
  const accent = status === "done" ? "#047857" : status === "gone" ? "#b45309" : "#0f172a";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light }
  body { margin:0; background:#f8fafc; color:#0f172a;
         font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif }
  main { max-width:34rem; margin:12vh auto; padding:0 20px }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:28px }
  h1 { margin:0 0 12px; font-size:1.35rem; color:${accent} }
  p { margin:0 0 14px; color:#334155 }
  .who { font-weight:700; color:#0f172a; word-break:break-all }
  button { margin-top:10px; padding:11px 20px; border:0; border-radius:10px;
           background:#0f172a; color:#fff; font-size:1rem; font-weight:600; cursor:pointer }
  button:hover { background:#1e293b }
  .fine { margin-top:18px; font-size:.82rem; color:#64748b }
</style>
</head><body><main><div class="card">${body}</div>
<p class="fine">Superior Professional Window Cleaning</p>
</main></body></html>`;
}

function tokenOf(req: { params: Record<string, string> }): string | null {
  return readUnsubscribeToken(req.params.token, unsubscribeSecret());
}

const GONE = page(
  "This link is not valid",
  `<h1>This link is not valid</h1>
   <p>It may have been mistyped, or it may belong to an older message.</p>
   <p>If you would rather not hear from us, reply to any of our emails and ask
      to be removed, and we will take care of it.</p>`,
  "gone",
);

router.get("/public/unsubscribe/:token", (req, res) => {
  const address = tokenOf(req);
  if (!address) { res.status(404).type("html").send(GONE); return; }
  res.type("html").send(page(
    "Unsubscribe",
    `<h1>Stop receiving our emails?</h1>
     <p>This will stop Superior Professional Window Cleaning emailing
        <span class="who">${escape(address)}</span>.</p>
     <p>That includes estimates, appointment reminders and invoices — not just
        general messages. We will still have your address on file, and you can
        ask us to turn emails back on at any time.</p>
     <form method="post">
       <button type="submit">Yes, unsubscribe me</button>
     </form>`,
    "ask",
  ));
});

router.post("/public/unsubscribe/:token", async (req, res) => {
  const address = tokenOf(req);
  if (!address) { res.status(404).type("html").send(GONE); return; }
  try {
    await db.transaction((tx) => upsertSuppression(tx, {
      channel: "email",
      destination: address,
      reason: "marketing_unsubscribe",
      scope: "global",
      source: "public.unsubscribe",
      // The customer did it themselves; there is no employee to name.
      actor: "customer",
    }));
  } catch (err) {
    logger.error({ err }, "Unsubscribe could not be recorded");
    res.status(500).type("html").send(page(
      "Something went wrong",
      `<h1>We could not do that just now</h1>
       <p>Please try again in a moment. If it keeps failing, reply to any of our
          emails and ask to be removed — we will do it by hand.</p>`,
      "gone",
    ));
    return;
  }
  res.type("html").send(page(
    "Unsubscribed",
    `<h1>Done — you are unsubscribed</h1>
     <p>We will not email <span class="who">${escape(address)}</span> again.</p>
     <p>Your address stays on your account so our records are right. If you
        change your mind, just tell us and we will switch emails back on.</p>`,
    "done",
  ));
});

export default router;
