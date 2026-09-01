import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, crewMembersTable, crewsTable, jobsTable, usersTable } from "@workspace/db";
import { normalizeAuthorizationRole } from "../lib/role-normalization.ts";

type CrewInput = {
  name?: unknown; leadUserId?: unknown; memberUserIds?: unknown;
  phone?: unknown; email?: unknown; color?: unknown; notes?: unknown; isActive?: unknown;
  leadTechnician?: unknown; members?: unknown;
};

function crewId(value: string | string[]): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

export function validateCrewMembership(body: CrewInput): { leadUserId: string; memberUserIds: string[] } | { error: string } {
  if (typeof body.leadUserId !== "string" || !body.leadUserId.trim()) {
    return { error: "leadUserId is required and must be a canonical user ID" };
  }
  if (!Array.isArray(body.memberUserIds) || body.memberUserIds.some((id) => typeof id !== "string" || !id.trim())) {
    return { error: "memberUserIds must be an array of canonical user IDs" };
  }
  return { leadUserId: body.leadUserId.trim(), memberUserIds: [...new Set([body.leadUserId.trim(), ...body.memberUserIds.map((id) => id.trim())])] };
}

async function validateOperationalMembers(tx: any, membership: { leadUserId: string; memberUserIds: string[] }): Promise<string | null> {
  const users = await tx.select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
    .from(usersTable).where(inArray(usersTable.id, membership.memberUserIds)).for("update");
  if (users.length !== membership.memberUserIds.length) return "Every crew member must be an existing canonical user";
  if (users.some((user: any) => !user.isActive || normalizeAuthorizationRole(user.role) !== "field_tech")) {
    return "Crew lead and members must be active Field Tech users";
  }
  return null;
}

export type CrewsRepository = {
  list(): Promise<any[]>;
  members(crewId: number): Promise<any[]>;
  validateMembers(membership: { leadUserId: string; memberUserIds: string[] }): Promise<string | null>;
  create(values: any, membership: { leadUserId: string; memberUserIds: string[] }): Promise<{ crew: any } | { validationError: string }>;
  update(id: number, values: any, membership: { leadUserId: string; memberUserIds: string[] } | null): Promise<{ crew: any | null } | { validationError: string }>;
  remove(id: number): Promise<"deleted" | "notFound" | "referenced">;
};

const drizzleCrewsRepository: CrewsRepository = {
  list: () => db.select().from(crewsTable).orderBy(crewsTable.name),
  members: (crewId) => db.select({
    userId: crewMembersTable.userId, role: crewMembersTable.role,
    firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email,
  }).from(crewMembersTable).innerJoin(usersTable, eq(crewMembersTable.userId, usersTable.id))
    .where(eq(crewMembersTable.crewId, crewId)),
  validateMembers: (membership) => db.transaction((tx) => validateOperationalMembers(tx, membership)),
  create: (values, membership) => db.transaction(async (tx) => {
    const error = await validateOperationalMembers(tx, membership);
    if (error) return { validationError: error };
    const [crew] = await tx.insert(crewsTable).values(values).returning();
    await tx.insert(crewMembersTable).values(membership.memberUserIds.map((userId) => ({
      crewId: crew.id, userId, role: userId === membership.leadUserId ? "lead" : "member",
    })));
    return { crew };
  }),
  update: (id, values, membership) => db.transaction(async (tx) => {
    const [current] = await tx.select().from(crewsTable).where(eq(crewsTable.id, id)).for("update");
    if (!current) return { crew: null };
    if (membership) {
      const error = await validateOperationalMembers(tx, membership);
      if (error) return { validationError: error };
      await tx.delete(crewMembersTable).where(eq(crewMembersTable.crewId, id));
      await tx.insert(crewMembersTable).values(membership.memberUserIds.map((userId) => ({
        crewId: id, userId, role: userId === membership.leadUserId ? "lead" : "member",
      })));
    }
    if (!Object.keys(values).length) return { crew: current };
    const [crew] = await tx.update(crewsTable).set(values).where(eq(crewsTable.id, id)).returning();
    return { crew };
  }),
  remove: (id) => db.transaction(async (tx) => {
    const [crew] = await tx.select({ id: crewsTable.id }).from(crewsTable).where(eq(crewsTable.id, id)).for("update");
    if (!crew) return "notFound" as const;
    const [reference] = await tx.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.crewId, id)).limit(1);
    if (reference) return "referenced" as const;
    await tx.delete(crewMembersTable).where(eq(crewMembersTable.crewId, id));
    await tx.delete(crewsTable).where(eq(crewsTable.id, id));
    return "deleted" as const;
  }),
};

async function serialize(crew: typeof crewsTable.$inferSelect, repository: CrewsRepository) {
  const membership = await repository.members(crew.id);
  const people = membership.map((member) => ({
    userId: member.userId, role: member.role,
    displayName: [member.firstName, member.lastName].filter(Boolean).join(" ").trim() || member.email || "Team member",
  }));
  return {
    ...crew,
    createdAt: crew.createdAt.toISOString(),
    updatedAt: crew.updatedAt.toISOString(),
    legacyDisplay: { leadTechnician: crew.leadTechnician, members: crew.members },
    lead: people.find((member) => member.role === "lead") ?? null,
    members: people,
  };
}

export function createCrewsRouter(repository: CrewsRepository = drizzleCrewsRepository): IRouter {
  const router: IRouter = Router();
  router.get("/crews", async (_req, res): Promise<void> => {
    const crews = await repository.list();
    res.json(await Promise.all(crews.map((crew) => serialize(crew, repository))));
  });

  router.post("/crews", async (req, res): Promise<void> => {
    const body = req.body as CrewInput;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const membership = validateCrewMembership(body);
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    if ("error" in membership) { res.status(400).json({ error: membership.error }); return; }
    const created = await repository.create({
        name, leadTechnician: optionalText(body.leadTechnician) ?? null, members: optionalText(body.members) ?? null,
        phone: optionalText(body.phone) ?? null, email: optionalText(body.email) ?? null,
        color: optionalText(body.color) ?? null, notes: optionalText(body.notes) ?? null,
        isActive: typeof body.isActive === "boolean" ? body.isActive : true,
      }, membership);
    if ("validationError" in created) { res.status(400).json({ error: created.validationError }); return; }
    res.status(201).json(await serialize(created.crew, repository));
  });

  router.patch("/crews/:id", async (req, res): Promise<void> => {
    const id = crewId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid crew id" }); return; }
    const body = req.body as CrewInput;
    if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
      res.status(400).json({ error: "name must be a trimmed non-empty string" }); return;
    }
    const changingMembership = body.leadUserId !== undefined || body.memberUserIds !== undefined;
    const membership = changingMembership ? validateCrewMembership(body) : null;
    if (membership && "error" in membership) { res.status(400).json({ error: membership.error }); return; }
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = (body.name as string).trim();
      for (const field of ["phone", "email", "color", "notes", "leadTechnician", "members"] as const) {
        if (body[field] !== undefined) updates[field] = optionalText(body[field]);
      }
      if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
    const updated = await repository.update(id, updates, membership);
    if ("validationError" in updated) { res.status(400).json({ error: updated.validationError }); return; }
    const crew = updated.crew;
    if (!crew) { res.status(404).json({ error: "Crew not found" }); return; }
    res.json(await serialize(crew, repository));
  });

  router.delete("/crews/:id", async (req, res): Promise<void> => {
    const id = crewId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid crew id" }); return; }
    const result = await repository.remove(id);
    if (result === "notFound") { res.status(404).json({ error: "Crew not found" }); return; }
    if (result === "referenced") { res.status(409).json({ error: "Crew has current or historical jobs; deactivate it instead of deleting it" }); return; }
    res.sendStatus(204);
  });
  return router;
}

export default createCrewsRouter();