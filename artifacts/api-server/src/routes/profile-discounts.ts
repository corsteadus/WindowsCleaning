import { Router, type IRouter } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { customerDiscountsTable, customersTable, db } from "@workspace/db";
import { isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { discountOf, MAX_DISCOUNTS } from "../lib/discounts.ts";
import { inProspectScope } from "../lib/profile-lists.ts";

/**
 * Discounts that follow a profile — phase 5, Kyle's Video 5: "if you had a senior
 * citizen discount, obviously that person is always going to be a senior citizen
 * going forward … you can make that discount follow the customer." Each one is
 * added to the profile's new estimates (lib/quote-totals.ts), where it can be
 * removed. Removing one here archives it; estimates already made keep theirs.
 * GET is customers.view (leads.view) and the rest .manage, by prefix.
 */
const router: IRouter = Router();
const PATHS = ["/customers/:id/discounts", "/prospects/:id/discounts"];

function actorName(req: { user?: { firstName?: string | null; lastName?: string | null; email?: string | null } }): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || null;
}
const idOf = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
async function scopedProfile(id: number, prospectOnly: boolean) {
  const [profile] = await db.select({
    id: customersTable.id, lifecycleStatus: customersTable.lifecycleStatus,
    deactivatedFrom: customersTable.deactivatedFrom, customerDate: customersTable.customerDate,
  }).from(customersTable).where(eq(customersTable.id, id));
  if (!profile || (prospectOnly && !inProspectScope(profile))) return null;
  return profile;
}
const serialize = (row: typeof customerDiscountsTable.$inferSelect) => ({
  id: row.id, name: row.name, kind: row.kind, value: Number(row.value), createdBy: row.createdBy, createdAt: row.createdAt,
});
const activeOf = (customerId: number) => db.select().from(customerDiscountsTable)
  .where(and(eq(customerDiscountsTable.customerId, customerId), isNull(customerDiscountsTable.archivedAt)))
  .orderBy(asc(customerDiscountsTable.id));

router.use([...PATHS, "/customers/:id/discounts/:discountId", "/prospects/:id/discounts/:discountId"], (req, res, next) => {
  if (isAssignmentScopedOperationalRole(req.user?.role)) {
    res.status(403).json({ error: "Not available for assigned-work access", code: "assigned_work_scope" });
    return;
  }
  next();
});

router.get(PATHS, async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  if (!id || !(await scopedProfile(id, req.path.startsWith("/prospects/")))) { res.status(404).json({ error: "Profile not found" }); return; }
  res.json((await activeOf(id)).map(serialize));
});

router.post(PATHS, async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  if (!id || !(await scopedProfile(id, req.path.startsWith("/prospects/")))) { res.status(404).json({ error: "Profile not found" }); return; }
  const sent = discountOf(req.body);
  if ("error" in sent) { res.status(400).json({ error: sent.error }); return; }
  const active = await activeOf(id);
  if (active.length >= MAX_DISCOUNTS) { res.status(400).json({ error: `At most ${MAX_DISCOUNTS} discounts on one profile` }); return; }
  if (active.some((row) => row.name.toLowerCase() === sent.discount.name.toLowerCase())) {
    res.status(409).json({ error: `This profile already has a discount called ${sent.discount.name}` });
    return;
  }
  const [created] = await db.insert(customerDiscountsTable).values({
    customerId: id, name: sent.discount.name, kind: sent.discount.kind, value: String(sent.discount.value), createdBy: actorName(req),
  }).returning();
  res.status(201).json(serialize(created));
});

router.delete(["/customers/:id/discounts/:discountId", "/prospects/:id/discounts/:discountId"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const discountId = idOf(req.params.discountId);
  if (!id || !discountId) { res.status(404).json({ error: "Discount not found" }); return; }
  const [archived] = await db.update(customerDiscountsTable).set({ archivedAt: new Date() })
    .where(and(eq(customerDiscountsTable.id, discountId), eq(customerDiscountsTable.customerId, id), isNull(customerDiscountsTable.archivedAt)))
    .returning({ id: customerDiscountsTable.id });
  if (!archived) { res.status(404).json({ error: "Discount not found" }); return; }
  res.status(204).end();
});

export default router;
