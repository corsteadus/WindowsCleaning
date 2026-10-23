import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { customersTable, db, profileNoteEntriesTable } from "@workspace/db";
import { isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { noteBodyOf, noteKindOf, serializeNotes } from "../lib/profile-notes.ts";
import { inProspectScope } from "../lib/profile-lists.ts";

/**
 * Dated, signed specific and callback notes — profile redesign piece C.
 * GET is customers.view and the rest customers.manage, by the /customers and
 * /prospects prefixes in lib/authorization.ts.
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

async function scopedProfile(id: number, prospectOnly: boolean) {
  const [profile] = await db.select({
    id: customersTable.id, lifecycleStatus: customersTable.lifecycleStatus,
    deactivatedFrom: customersTable.deactivatedFrom, customerDate: customersTable.customerDate,
  }).from(customersTable).where(eq(customersTable.id, id));
  if (!profile || (prospectOnly && !inProspectScope(profile))) return null;
  return profile;
}

async function readNotes(customerId: number) {
  const rows = await db.select().from(profileNoteEntriesTable)
    .where(and(eq(profileNoteEntriesTable.customerId, customerId), isNull(profileNoteEntriesTable.archivedAt)));
  return serializeNotes(rows);
}

// A technician sees what their assigned work needs — phones, addresses,
// directions, job notes (Kyle) — not the office's notes about the customer.
router.use(["/customers/:id/notes", "/prospects/:id/notes"], (req, res, next) => {
  if (isAssignmentScopedOperationalRole(req.user?.role)) {
    res.status(403).json({ error: "Not available for assigned-work access", code: "assigned_work_scope" });
    return;
  }
  next();
});

router.get(["/customers/:id/notes", "/prospects/:id/notes"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  if (!id || !(await scopedProfile(id, req.path.startsWith("/prospects/")))) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(await readNotes(id));
});

router.post(["/customers/:id/notes", "/prospects/:id/notes"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  if (!id || !(await scopedProfile(id, req.path.startsWith("/prospects/")))) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const kind = noteKindOf(req.body?.kind);
  if (!kind) { res.status(400).json({ error: "kind must be specific or callback" }); return; }
  const body = noteBodyOf(req.body?.body);
  if ("error" in body) { res.status(400).json({ error: body.error }); return; }
  const [created] = await db.insert(profileNoteEntriesTable).values({
    customerId: id, kind, body: body.body,
    createdBy: actorName(req), createdByUserId: req.user?.id ?? null,
  }).returning();
  res.status(201).json(serializeNotes([created])[0]);
});

// Archived, not deleted or edited: a signed note stays as it was written.
router.delete(["/customers/:id/notes/:noteId", "/prospects/:id/notes/:noteId"], async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const noteId = idOf(req.params.noteId);
  if (!id || !noteId) { res.status(404).json({ error: "Note not found" }); return; }
  const [archived] = await db.update(profileNoteEntriesTable)
    .set({ archivedAt: new Date(), archivedBy: actorName(req) })
    .where(and(
      eq(profileNoteEntriesTable.id, noteId),
      eq(profileNoteEntriesTable.customerId, id),
      isNull(profileNoteEntriesTable.archivedAt),
    ))
    .returning({ id: profileNoteEntriesTable.id });
  if (!archived) { res.status(404).json({ error: "Note not found" }); return; }
  res.status(204).end();
});

export default router;
