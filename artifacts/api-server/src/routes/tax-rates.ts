import { Router, type IRouter, type Request } from "express";
import { asc, eq } from "drizzle-orm";
import { db, taxRatesTable } from "@workspace/db";
import { taxRateOf } from "../lib/sales-tax.ts";

/**
 * The business's sales tax rates — phase 6, Kyle's answer #2: "the business sets
 * up state and county rates." Read by anyone who may see an estimate (the
 * estimate screen chooses from them); changed only by an administrator, like
 * the company's quote settings (lib/authorization.ts). A rate is turned off,
 * never deleted: estimates keep the rate they froze.
 */
const router: IRouter = Router();

function actorName(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || null;
}
const serialize = (row: typeof taxRatesTable.$inferSelect) => ({ ...row, rate: Number(row.rate) });

router.get("/tax-rates", async (_req, res): Promise<void> => {
  const rows = await db.select().from(taxRatesTable).orderBy(asc(taxRatesTable.kind), asc(taxRatesTable.state), asc(taxRatesTable.county), asc(taxRatesTable.id));
  // A state rate before its counties; turned-off ones last.
  res.json(rows.map(serialize).sort((a, b) => Number(b.isActive) - Number(a.isActive) || (a.kind === b.kind ? 0 : a.kind === "state" ? -1 : 1)));
});

router.post("/tax-rates", async (req, res): Promise<void> => {
  const sent = taxRateOf(req.body);
  if ("error" in sent) { res.status(400).json({ error: sent.error }); return; }
  const [created] = await db.insert(taxRatesTable).values({
    ...sent.rate, rate: String(sent.rate.rate), createdBy: actorName(req),
  }).returning();
  res.status(201).json(serialize(created));
});

// Edit a rate's name or percentage, or turn it off and on. Estimates already made keep theirs.
router.patch("/tax-rates/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(404).json({ error: "Rate not found" }); return; }
  const [current] = await db.select().from(taxRatesTable).where(eq(taxRatesTable.id, id));
  if (!current) { res.status(404).json({ error: "Rate not found" }); return; }
  const sent = taxRateOf({ ...serialize(current), ...req.body });
  if ("error" in sent) { res.status(400).json({ error: sent.error }); return; }
  const [updated] = await db.update(taxRatesTable).set({
    ...sent.rate, rate: String(sent.rate.rate),
    isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : current.isActive,
  }).where(eq(taxRatesTable.id, id)).returning();
  res.json(serialize(updated));
});

export default router;
