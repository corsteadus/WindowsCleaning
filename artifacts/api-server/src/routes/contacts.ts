import { Router } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, contactsTable, jobsTable } from "@workspace/db";
import {
  AccountRelationError,
  findReplacementContact,
  lockAccount,
  promoteContact,
  requireCustomer,
  syncLegacyContact,
} from "../lib/account-relations.ts";
import { isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { assignedJobCondition } from "../lib/field-tech-scope.ts";

export type ContactFieldTechRepository = {
  listAssigned(userId: string, customerId: number | null, includeArchived: boolean): Promise<(typeof contactsTable.$inferSelect)[]>;
};

export function createContactsRouter(fieldTechRepository: ContactFieldTechRepository = drizzleContactFieldTechRepository) {
const router = Router();

router.get("/contacts", async (req, res): Promise<void> => {
  try {
    const customerId = req.query.customerId === undefined
      ? null
      : parseId(String(req.query.customerId));
    const includeArchived = req.query.includeArchived === "true" || req.query.includeArchived === "1";
    const fieldTech = isAssignmentScopedOperationalRole(req.user?.role);
    if (fieldTech) {
      const rows = await fieldTechRepository.listAssigned(req.user!.id, customerId, includeArchived);
      res.json(rows.map(serialize));
      return;
    }
    const conditions = [];
    if (customerId !== null) conditions.push(eq(contactsTable.customerId, customerId));
    if (!includeArchived) conditions.push(isNull(contactsTable.archivedAt));
    const where = conditions.length === 0 ? undefined : and(...conditions);
    const rows = await db.select().from(contactsTable).where(where).orderBy(asc(contactsTable.isPrimary), asc(contactsTable.id));
    res.json(rows.map(serialize));
  } catch (error) {
    respondError(res, error, "Failed to fetch contacts");
  }
});

router.post("/contacts", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const customerId = parseId(body.customerId);
    const firstName = requiredName(body.firstName, "firstName");
    const lastName = requiredName(body.lastName, "lastName");
    const email = nullableText(body.email);
    const phone = nullableText(body.phone);
    const alternatePhone = nullableText(body.alternatePhone);
    const role = nullableText(body.role ?? body.title);
    if (email && !email.includes("@")) throw new AccountRelationError(400, "email must be valid");

    const row = await db.transaction(async (tx) => {
      await requireCustomer(tx, customerId);
      await lockAccount(tx, customerId);
      const active = await tx.select({ id: contactsTable.id })
        .from(contactsTable)
        .where(and(eq(contactsTable.customerId, customerId), isNull(contactsTable.archivedAt)));
      const shouldPrimary = body.isPrimary === true || active.length === 0;
      const [created] = await tx.insert(contactsTable).values({
        customerId,
        firstName,
        lastName,
        email,
        phone,
        alternatePhone,
        role,
        isPrimary: false,
        receiveSms: body.receiveSms === true,
        receiveEmail: body.receiveEmail === true,
        notes: nullableText(body.notes),
      }).returning();
      if (shouldPrimary) return promoteContact(tx, created.id);
      return created;
    });
    res.status(201).json(serialize(row));
  } catch (error) {
    respondError(res, error, "Failed to create contact");
  }
});

router.patch("/contacts/:id", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(contactsTable).where(eq(contactsTable.id, id));
      if (!current) throw new AccountRelationError(404, "Contact not found");
      await lockAccount(tx, current.customerId);
      if (current.archivedAt) throw new AccountRelationError(409, "Archived contacts must be restored before editing");
      if (body.isPrimary === false && current.isPrimary) {
        throw new AccountRelationError(409, "Promote another contact before removing the primary designation");
      }

      const updateData: Record<string, unknown> = {};
      for (const field of ["firstName", "lastName", "email", "phone", "alternatePhone", "role", "notes"] as const) {
        if (body[field] !== undefined) updateData[field] = field === "email" || field === "phone" || field === "alternatePhone" || field === "role" || field === "notes"
          ? nullableText(body[field])
          : requiredName(body[field], field);
      }
      if (body.receiveSms !== undefined) updateData.receiveSms = body.receiveSms === true;
      if (body.receiveEmail !== undefined) updateData.receiveEmail = body.receiveEmail === true;
      if (Object.keys(updateData).length > 0) {
        const [updated] = await tx.update(contactsTable).set(updateData).where(eq(contactsTable.id, id)).returning();
        if (!updated) throw new AccountRelationError(404, "Contact not found");
      }
      if (body.isPrimary === true) return promoteContact(tx, id);
      const [updated] = await tx.select().from(contactsTable).where(eq(contactsTable.id, id));
      if (updated?.isPrimary) await syncLegacyContact(tx, updated);
      return updated;
    });
    res.json(serialize(row));
  } catch (error) {
    respondError(res, error, "Failed to update contact");
  }
});

router.post("/contacts/:id/primary", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const row = await db.transaction((tx) => promoteContact(tx, id));
    res.json(serialize(row));
  } catch (error) {
    respondError(res, error, "Failed to set primary contact");
  }
});

router.post("/contacts/:id/archive", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const reason = nullableText((req.body as Record<string, unknown> | undefined)?.reason) ?? "Archived by user";
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(contactsTable).where(eq(contactsTable.id, id));
      if (!current) throw new AccountRelationError(404, "Contact not found");
      await lockAccount(tx, current.customerId);
      if (current.archivedAt) return current;
      if (current.isPrimary) {
        const replacement = await findReplacementContact(tx, current.customerId, current.id);
        if (!replacement) throw new AccountRelationError(409, "Promote another contact before archiving the only active primary");
        await promoteContact(tx, Number(replacement.id));
      }
      const [archived] = await tx.update(contactsTable).set({
        isPrimary: false,
        archivedAt: new Date(),
        archiveReason: reason,
      }).where(eq(contactsTable.id, id)).returning();
      return archived;
    });
    res.json(serialize(row));
  } catch (error) {
    respondError(res, error, "Failed to archive contact");
  }
});

router.post("/contacts/:id/restore", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(contactsTable).where(eq(contactsTable.id, id));
      if (!current) throw new AccountRelationError(404, "Contact not found");
      await lockAccount(tx, current.customerId);
      if (!current.archivedAt) return current;
      const [restored] = await tx.update(contactsTable).set({
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
        isPrimary: false,
      }).where(eq(contactsTable.id, id)).returning();
      const [primary] = await tx.select({ id: contactsTable.id })
        .from(contactsTable)
        .where(and(eq(contactsTable.customerId, current.customerId), isNull(contactsTable.archivedAt), eq(contactsTable.isPrimary, true)));
      return primary ? restored : promoteContact(tx, id);
    });
    res.json(serialize(row));
  } catch (error) {
    respondError(res, error, "Failed to restore contact");
  }
});

// Backward-compatible destructive route: deletes are now recoverable archives.
router.delete("/contacts/:id", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(contactsTable).where(eq(contactsTable.id, id));
      if (!current) throw new AccountRelationError(404, "Contact not found");
      await lockAccount(tx, current.customerId);
      if (current.isPrimary) {
        const replacement = await findReplacementContact(tx, current.customerId, current.id);
        if (!replacement) throw new AccountRelationError(409, "Promote another contact before archiving the only active primary");
        await promoteContact(tx, Number(replacement.id));
      }
      await tx.update(contactsTable).set({ isPrimary: false, archivedAt: new Date(), archiveReason: "Archived by user" }).where(eq(contactsTable.id, id));
    });
    res.sendStatus(204);
  } catch (error) {
    respondError(res, error, "Failed to archive contact");
  }
});

function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AccountRelationError(400, "A valid id is required");
  return id;
}

function requiredName(value: unknown, field: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new AccountRelationError(400, `${field} is required`);
  return result;
}

function nullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
}

function serialize(row: Record<string, any> | undefined): Record<string, unknown> {
  if (!row) return {};
  return {
    ...row,
    title: row.role,
    archivedAt: row.archivedAt?.toISOString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

function respondError(res: any, error: unknown, fallback: string): void {
  if (error instanceof AccountRelationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ error: fallback });
}

return router;
}

const drizzleContactFieldTechRepository: ContactFieldTechRepository = {
  listAssigned: (userId, customerId, includeArchived) => {
    const conditions = [sql`EXISTS (
      SELECT 1 FROM ${jobsTable}
       WHERE ${jobsTable.customerId} = ${contactsTable.customerId}
         AND ${assignedJobCondition(userId)}
    )`];
    if (customerId !== null) conditions.push(eq(contactsTable.customerId, customerId));
    if (!includeArchived) conditions.push(isNull(contactsTable.archivedAt));
    return db.select().from(contactsTable).where(and(...conditions))
      .orderBy(asc(contactsTable.isPrimary), asc(contactsTable.id));
  },
};

export default createContactsRouter();