import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createCrewsRouter, type CrewsRepository, validateCrewMembership } from "./crews.ts";

function fixture() {
  const now = new Date("2026-01-01T00:00:00Z");
  const users: Record<string, any> = {
    lead: { id: "lead", role: "field_tech", isActive: true, firstName: "Lead" },
    member: { id: "member", role: "field_tech", isActive: true, firstName: "Member" },
    inactive: { id: "inactive", role: "field_tech", isActive: false },
    office: { id: "office", role: "office_admin", isActive: true },
  };
  const crews: any[] = []; const memberships: any[] = []; const writes: string[] = [];
  const repo: CrewsRepository = {
    list: async () => crews,
    members: async (id) => memberships.filter((m) => m.crewId === id).map((m) => ({ ...users[m.userId], ...m })),
    validateMembers: async ({ memberUserIds }) => {
      const bad = memberUserIds.map((id) => users[id]).some((u) => !u || !u.isActive || u.role !== "field_tech");
      return bad ? "Crew lead and members must be active Field Tech users" : null;
    },
    create: async (values, membership) => { const validationError = await repo.validateMembers(membership); if (validationError) return { validationError }; const crew = { id: crews.length + 1, ...values, createdAt: now, updatedAt: now }; crews.push(crew); memberships.push(...membership.memberUserIds.map((userId) => ({ crewId: crew.id, userId, role: userId === membership.leadUserId ? "lead" : "member" }))); writes.push("validate:locked", "create"); return { crew }; },
    update: async (id, values, membership) => { const crew = crews.find((c) => c.id === id); if (!crew) return { crew: null }; if (membership) { const validationError = await repo.validateMembers(membership); if (validationError) return { validationError }; } Object.assign(crew, values); if (membership) { for (let i = memberships.length - 1; i >= 0; i--) if (memberships[i].crewId === id) memberships.splice(i, 1); memberships.push(...membership.memberUserIds.map((userId) => ({ crewId: id, userId, role: userId === membership.leadUserId ? "lead" : "member" }))); } writes.push("update"); return { crew }; },
    remove: async (id) => { const crew = crews.find((c) => c.id === id); if (!crew) return "notFound"; if (crew.referenced) return "referenced"; for (let i = memberships.length - 1; i >= 0; i--) if (memberships[i].crewId === id) memberships.splice(i, 1); crews.splice(crews.indexOf(crew), 1); writes.push("delete"); return "deleted"; },
  };
  return { repo, crews, memberships, writes };
}
async function http(repo: CrewsRepository, run: (base: string) => Promise<void>) {
  const app = express(); app.use(express.json()); app.use(createCrewsRouter(repo));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
const request = (base: string, path: string, init?: RequestInit) => fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });

test("production crew router creates canonical memberships and replaces them on edit", async () => {
  const f = fixture(); await http(f.repo, async (base) => {
    let response = await request(base, "/crews", { method: "POST", body: JSON.stringify({ name: " A ", leadUserId: "lead", memberUserIds: ["member", "lead"] }) });
    assert.equal(response.status, 201); assert.deepEqual((await response.json()).members.map((m: any) => m.userId), ["lead", "member"]);
    response = await request(base, "/crews/1", { method: "PATCH", body: JSON.stringify({ leadUserId: "member", memberUserIds: ["member"] }) });
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).lead.userId, "member");
  });
});
test("production crew router rejects invalid users without writes and toggles activation", async () => {
  const f = fixture(); await http(f.repo, async (base) => {
    for (const leadUserId of ["inactive", "office", "missing"]) { const r = await request(base, "/crews", { method: "POST", body: JSON.stringify({ name: "x", leadUserId, memberUserIds: [] }) }); assert.equal(r.status, 400); }
    assert.equal(f.writes.length, 0);
    await request(base, "/crews", { method: "POST", body: JSON.stringify({ name: "x", leadUserId: "lead", memberUserIds: [] }) });
    let r = await request(base, "/crews/1", { method: "PATCH", body: JSON.stringify({ isActive: false }) }); assert.equal((await r.json()).isActive, false);
    r = await request(base, "/crews/1", { method: "PATCH", body: JSON.stringify({ isActive: true }) }); assert.equal((await r.json()).isActive, true);
  });
});
test("crew adapter validates and locks before its first write", async () => {
  const f = fixture();
  await f.repo.create({ name: "x" }, { leadUserId: "lead", memberUserIds: ["lead"] });
  assert.deepEqual(f.writes.slice(0, 2), ["validate:locked", "create"]);
});
test("production crew router cleans memberships only for unreferenced delete", async () => {
  const f = fixture(); f.crews.push({ id: 1, name: "free", isActive: true, createdAt: new Date(), updatedAt: new Date() }, { id: 2, name: "used", isActive: true, referenced: true, createdAt: new Date(), updatedAt: new Date() }); f.memberships.push({ crewId: 1, userId: "lead", role: "lead" }, { crewId: 2, userId: "lead", role: "lead" });
  await http(f.repo, async (base) => { let r = await request(base, "/crews/1", { method: "DELETE" }); assert.equal(r.status, 204); assert.equal(f.memberships.some((m) => m.crewId === 1), false); r = await request(base, "/crews/2", { method: "DELETE" }); assert.equal(r.status, 409); assert.match((await r.json()).error, /deactivate/); assert.equal(f.crews.some((c) => c.id === 2), true); });
});
test("crew membership normalizer includes the canonical lead once", () => assert.deepEqual(validateCrewMembership({ leadUserId: "lead", memberUserIds: ["lead", "member"] }), { leadUserId: "lead", memberUserIds: ["lead", "member"] }));