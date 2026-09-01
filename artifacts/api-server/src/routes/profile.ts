import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSession, getSessionId, updateSession } from "../lib/auth";

const router = Router();

// ─── Get current user profile ────────────────────────────────────────────────
router.get("/profile", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  return res.json(user);
});

// ─── Update current user profile ─────────────────────────────────────────────
router.patch("/profile", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { firstName, lastName, role } = req.body as {
    firstName?: string;
    lastName?: string;
    role?: string;
  };

  const updates: Record<string, unknown> = {};

  if (typeof firstName === "string") updates.firstName = firstName.trim() || null;
  if (typeof lastName  === "string") updates.lastName  = lastName.trim()  || null;

  // Only super_admin may change their own role
  if (typeof role === "string") {
    if (user.role !== "super_admin") {
      return res.status(403).json({ error: "Only Super Admins can change roles" });
    }
    const allowed = ["admin", "super_admin"];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    updates.role = role;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id));

  // Refresh session so changes are reflected immediately without re-login
  const sid = getSessionId(req);
  if (sid) {
    const session = await getSession(sid);
    if (session) {
      await updateSession(sid, {
        ...session,
        user: {
          ...session.user,
          ...updates,
        },
      });
    }
  }

  return res.json({ success: true, ...updates });
});

export default router;
