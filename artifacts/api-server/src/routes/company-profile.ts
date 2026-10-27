import { Router, type IRouter, type Request } from "express";
import {
  contactLines, logoOf, profileOf, readCompanyProfile, writeCompanyLogo, writeCompanyProfile,
} from "../lib/company-profile.ts";

/**
 * The business's identity and branding — phase 8, Kyle's Video 6. Read by anyone
 * signed in (estimates, print and email use it); changed by an administrator, like
 * the quote settings (lib/authorization.ts). The name, contact lines and logo are
 * also public, under /public/branding, for the customer's estimate page and for
 * the logo in estimate emails — nothing else about the business is.
 */
const router: IRouter = Router();

function actorName(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || null;
}
/** Changes when the logo does, so a cached copy is never shown for a new one. */
const logoVersion = (updatedAt: string | null) => (updatedAt ? Date.parse(updatedAt).toString(36) : "0");

router.get("/company-profile", async (_req, res): Promise<void> => {
  const { logo: _bytes, ...profile } = await readCompanyProfile();
  res.json({ ...profile, logoUrl: profile.hasLogo ? `/api/public/branding/logo.jpg?v=${logoVersion(profile.updatedAt)}` : null });
});

router.put("/company-profile", async (req, res): Promise<void> => {
  const sent = profileOf(req.body);
  if ("error" in sent) { res.status(400).json({ error: sent.error }); return; }
  await writeCompanyProfile(sent.profile, actorName(req));
  const { logo: _bytes, ...profile } = await readCompanyProfile();
  res.json(profile);
});

router.put("/company-profile/logo", async (req, res): Promise<void> => {
  const logo = logoOf(req.body?.image);
  if ("error" in logo) { res.status(400).json({ error: logo.error }); return; }
  await writeCompanyLogo(logo, actorName(req));
  res.json({ width: logo.width, height: logo.height });
});

router.delete("/company-profile/logo", async (req, res): Promise<void> => {
  await writeCompanyLogo(null, actorName(req));
  res.status(204).end();
});

// ─── Public: what a customer's estimate page and the emails show ─────────────
router.get("/public/branding", async (_req, res): Promise<void> => {
  const profile = await readCompanyProfile();
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    businessName: profile.businessName,
    contactLines: contactLines(profile),
    logoUrl: profile.hasLogo ? `/api/public/branding/logo.jpg?v=${logoVersion(profile.updatedAt)}` : null,
    // What the business chose an estimate shows — the customer's page follows the PDF.
    showUnitPrices: profile.showUnitPrices,
    showServiceDescriptions: profile.showServiceDescriptions,
    estimateFooter: profile.estimateFooter,
  });
});

router.get("/public/branding/logo.jpg", async (_req, res): Promise<void> => {
  const profile = await readCompanyProfile();
  if (!profile.logo) { res.status(404).json({ error: "No logo" }); return; }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(profile.logo.jpeg);
});

export default router;
