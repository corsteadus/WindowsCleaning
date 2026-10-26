import { Router, type IRouter } from "express";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { customersTable, db, profileCallbacksTable, profileNoteEntriesTable, usersTable } from "@workspace/db";
import { hasCapability, isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { callbackNoteText, dueAtOf, outcomeNoteOf, outcomeOf, reasonOf } from "../lib/callbacks.ts";
import { inProspectScope, isDeactivated, listOf } from "../lib/profile-lists.ts";

/**
 * Callbacks — phase 4, Kyle's Video 4: a list for "someone in the office, or even
 * a virtual assistant, going through a list and calling customers or prospects";
 * for each call, whether they spoke, left a message or neither, and the next one.
 * Profile routes are customers.view / .manage (or leads.* under /prospects) by
 * their prefix; /callbacks is customers.view / .manage (lib/authorization.ts).
 */
const router: IRouter = Router();

function actorName(req: { user?: { firstName?: string | null; lastName?: string | null; email?: string | null } }): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || null;
}

const idOf = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const nameOf = (user: { firstName: string | null; lastName: string | null; email: string | null; username: string | null }) =>
  [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || user.email || "Team member";

async function scopedProfile(id: number, prospectOnly: boolean) {
  const [profile] = await db.select({
    id: customersTable.id, lifecycleStatus: customersTable.lifecycleStatus,
    deactivatedFrom: customersTable.deactivatedFrom, customerDate: customersTable.customerDate,
  }).from(customersTable).where(eq(customersTable.id, id));
  if (!profile || (prospectOnly && !inProspectScope(profile))) return null;
  return profile;
}

/** Someone who may be given a callback: an active member of the office. */
async function assigneeOf(raw: unknown): Promise<{ userId: string | null } | { error: string }> {
  if (raw == null || raw === "") return { userId: null };
  const [user] = await db.select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
    .from(usersTable).where(eq(usersTable.id, String(raw)));
  if (!user || !user.isActive || !hasCapability(user.role, "customers.manage")) {
    return { error: "That person cannot be given callbacks" };
  }
  return { userId: user.id };
}

const callbackColumns = {
  id: profileCallbacksTable.id,
  customerId: profileCallbacksTable.customerId,
  dueAt: profileCallbacksTable.dueAt,
  assignedUserId: profileCallbacksTable.assignedUserId,
  reason: profileCallbacksTable.reason,
  status: profileCallbacksTable.status,
  outcome: profileCallbacksTable.outcome,
  outcomeNote: profileCallbacksTable.outcomeNote,
  completedAt: profileCallbacksTable.completedAt,
  completedBy: profileCallbacksTable.completedBy,
  createdBy: profileCallbacksTable.createdBy,
  createdAt: profileCallbacksTable.createdAt,
  assigneeFirstName: usersTable.firstName,
  assigneeLastName: usersTable.lastName,
  assigneeEmail: usersTable.email,
  assigneeUsername: usersTable.username,
};
interface CallbackRow {
  id: number; customerId: number; dueAt: Date; assignedUserId: string | null; reason: string | null; status: string;
  outcome: string | null; outcomeNote: string | null; completedAt: Date | null; completedBy: string | null;
  createdBy: string | null; createdAt: Date;
  assigneeFirstName: string | null; assigneeLastName: string | null; assigneeEmail: string | null; assigneeUsername: string | null;
}
const serialize = (row: CallbackRow) => ({
  id: row.id, customerId: row.customerId, dueAt: row.dueAt, reason: row.reason, status: row.status,
  outcome: row.outcome, outcomeNote: row.outcomeNote, completedAt: row.completedAt, completedBy: row.completedBy,
  createdBy: row.createdBy, createdAt: row.createdAt, assignedUserId: row.assignedUserId,
  assignedTo: row.assignedUserId ? nameOf({
    firstName: row.assigneeFirstName, lastName: row.assigneeLastName, email: row.assigneeEmail, username: row.assigneeUsername,
  }) : null,
});

// The office's calls, not a technician's.
router.use(["/callbacks", "/customers/:id/callbacks", "/prospects/:id/callbacks"], (req, res, next) => {
  if (isAssignmentScopedOperationalRole(req.user?.role)) {
    res.status(403).json({ error: "Not available for assigned-work access", code: "assigned_work_scope" });
    return;
  }
  next();
});

// ─── The call list ───────────────────────────────────────────────────────────
// Open callbacks due by `before` (default: the end of today is the browser's to
// send; without it, every open one), soonest first, with what the caller needs.
router.get("/callbacks", async (req, res): Promise<void> => {
  const mine = req.query.assigned === "me";
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
  const rows = await db.select({
    ...callbackColumns,
    firstName: customersTable.firstName, lastName: customersTable.lastName, companyName: customersTable.companyName,
    email: customersTable.email, cellPhone: customersTable.cellPhone, homePhone: customersTable.homePhone,
    workPhone: customersTable.workPhone, phone: customersTable.phone,
    lifecycleStatus: customersTable.lifecycleStatus, deactivatedFrom: customersTable.deactivatedFrom, customerDate: customersTable.customerDate,
  }).from(profileCallbacksTable)
    .innerJoin(customersTable, eq(customersTable.id, profileCallbacksTable.customerId))
    .leftJoin(usersTable, eq(usersTable.id, profileCallbacksTable.assignedUserId))
    .where(and(
      eq(profileCallbacksTable.status, "open"),
      mine ? eq(profileCallbacksTable.assignedUserId, String(req.user?.id ?? "")) : undefined,
      before && !Number.isNaN(before.getTime()) ? lte(profileCallbacksTable.dueAt, before) : undefined,
      sql`${customersTable.lifecycleStatus} in ('prospect', 'customer')`,
    ))
    .orderBy(asc(profileCallbacksTable.dueAt), asc(profileCallbacksTable.id))
    .limit(500);
  res.json(rows.map((row) => ({
    ...serialize(row),
    profile: {
      id: row.customerId,
      name: row.companyName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || `Profile #${row.customerId}`,
      list: listOf(row),
      email: row.email,
      phone: row.cellPhone || row.homePhone || row.workPhone || row.phone || null,
    },
  })));
});

// Who a callback can be given to.
router.get("/callbacks/assignees", async (_req, res): Promise<void> => {
  const users = await db.select({
    id: usersTable.id, role: usersTable.role, firstName: usersTable.firstName, lastName: usersTable.lastName,
    email: usersTable.email, username: usersTable.username,
  }).from(usersTable).where(eq(usersTable.isActive, true));
  res.json(users
    .filter((user) => hasCapability(user.role, "customers.manage"))
    .map((user) => ({ id: user.id, name: nameOf(user) }))
    .sort((a, b) => a.name.localeCompare(b.name)));
});

// ─── One profile's callbacks ─────────────────────────────────────────────────
router.get(["/customers/:id/callbacks", "/prospects/:id/callbacks"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  if (!id || !(await scopedProfile(id, req.path.startsWith("/prospects/")))) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const rows = await db.select(callbackColumns).from(profileCallbacksTable)
    .leftJoin(usersTable, eq(usersTable.id, profileCallbacksTable.assignedUserId))
    .where(eq(profileCallbacksTable.customerId, id))
    .orderBy(asc(profileCallbacksTable.dueAt), desc(profileCallbacksTable.id));
  const all = rows.map(serialize);
  // Open ones soonest first; the made and cancelled ones newest first.
  res.json({
    open: all.filter((row) => row.status === "open"),
    history: all.filter((row) => row.status !== "open").sort((a, b) =>
      new Date(b.completedAt ?? b.createdAt).getTime() - new Date(a.completedAt ?? a.createdAt).getTime()),
  });
});

router.post(["/customers/:id/callbacks", "/prospects/:id/callbacks"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const profile = id ? await scopedProfile(id, req.path.startsWith("/prospects/")) : null;
  if (!id || !profile) { res.status(404).json({ error: "Profile not found" }); return; }
  if (isDeactivated(profile.lifecycleStatus)) { res.status(409).json({ error: "Reactivate this profile before scheduling a callback" }); return; }
  const due = dueAtOf(req.body?.dueAt);
  if ("error" in due) { res.status(400).json({ error: due.error }); return; }
  const reason = reasonOf(req.body?.reason);
  if ("error" in reason) { res.status(400).json({ error: reason.error }); return; }
  const assignee = await assigneeOf(req.body?.assignedUserId);
  if ("error" in assignee) { res.status(400).json({ error: assignee.error }); return; }
  const [created] = await db.insert(profileCallbacksTable).values({
    customerId: id, dueAt: due.dueAt, reason: reason.reason, assignedUserId: assignee.userId, createdBy: actorName(req),
  }).returning();
  res.status(201).json(created);
});

// The call was made: what happened, and — optionally — when to call next.
router.post(["/customers/:id/callbacks/:callbackId/outcome", "/prospects/:id/callbacks/:callbackId/outcome"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const callbackId = idOf(req.params.callbackId);
  if (!id || !callbackId || !(await scopedProfile(id, req.path.startsWith("/prospects/")))) {
    res.status(404).json({ error: "Callback not found" });
    return;
  }
  const outcome = outcomeOf(req.body?.outcome);
  if (!outcome) { res.status(400).json({ error: "Say whether you spoke to them, left a message, or neither" }); return; }
  const note = outcomeNoteOf(req.body?.note);
  if ("error" in note) { res.status(400).json({ error: note.error }); return; }
  let next: { dueAt: Date; reason: string | null; userId: string | null } | null = null;
  if (req.body?.next) {
    const due = dueAtOf(req.body.next.dueAt);
    if ("error" in due) { res.status(400).json({ error: `Next callback: ${due.error.toLowerCase()}` }); return; }
    const reason = reasonOf(req.body.next.reason);
    if ("error" in reason) { res.status(400).json({ error: reason.error }); return; }
    const assignee = await assigneeOf(req.body.next.assignedUserId);
    if ("error" in assignee) { res.status(400).json({ error: assignee.error }); return; }
    next = { dueAt: due.dueAt, reason: reason.reason, userId: assignee.userId };
  }

  const actor = actorName(req);
  const result = await db.transaction(async (tx) => {
    const [done] = await tx.update(profileCallbacksTable)
      .set({ status: "done", outcome, outcomeNote: note.note, completedAt: new Date(), completedBy: actor })
      .where(and(eq(profileCallbacksTable.id, callbackId), eq(profileCallbacksTable.customerId, id), eq(profileCallbacksTable.status, "open")))
      .returning();
    if (!done) return null;
    await tx.insert(profileNoteEntriesTable).values({
      customerId: id, kind: "callback", body: callbackNoteText(outcome, note.note, next?.dueAt ?? null),
      createdBy: actor, createdByUserId: req.user?.id ?? null,
    });
    const [following] = next
      ? await tx.insert(profileCallbacksTable).values({
        customerId: id, dueAt: next.dueAt, reason: next.reason ?? done.reason, assignedUserId: next.userId, createdBy: actor,
      }).returning()
      : [null];
    return { callback: done, next: following };
  });
  if (!result) { res.status(409).json({ error: "This callback was already recorded or cancelled" }); return; }
  res.json(result);
});

router.post(["/customers/:id/callbacks/:callbackId/cancel", "/prospects/:id/callbacks/:callbackId/cancel"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const callbackId = idOf(req.params.callbackId);
  if (!id || !callbackId || !(await scopedProfile(id, req.path.startsWith("/prospects/")))) {
    res.status(404).json({ error: "Callback not found" });
    return;
  }
  const [cancelled] = await db.update(profileCallbacksTable)
    .set({ status: "cancelled", completedAt: new Date(), completedBy: actorName(req) })
    .where(and(eq(profileCallbacksTable.id, callbackId), eq(profileCallbacksTable.customerId, id), eq(profileCallbacksTable.status, "open")))
    .returning();
  if (!cancelled) { res.status(404).json({ error: "Callback not found" }); return; }
  res.json(cancelled);
});

export default router;
