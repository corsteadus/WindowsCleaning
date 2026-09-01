import { Router } from "express";
import express from "express";
import { db, usersTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { getSession, getSessionId, revokeUserSessions } from "../lib/auth";
import { hashPassword } from "../lib/password";
import { isTeamUserRole, TEAM_USER_ROLES } from "../lib/authorization";
import {
  DEMO_SEED_CONFIRMATION,
  evaluateDemoSeedGate,
  seedDemoData,
} from "../lib/seed-demo";
import {
  SANDBOX_PURGE_CONFIRMATION,
  evaluateSandboxPurgeGate,
  runSandboxPurge,
} from "../lib/admin-purge";
import { validateImportJobBatch } from "../lib/import-job-temporal";

const router = Router();

// ─── Auth guard helpers ────────────────────────────────────────────────────
async function getSessionUser(req: any) {
  // Use req.user already set by authMiddleware (avoids extra DB round-trip and
  // survives OIDC token refresh failures that previously cleared the session).
  if (req.user) return req.user;
  const sid = getSessionId(req);
  if (!sid) return null;
  const session = await getSession(sid);
  return session?.user ?? null;
}

async function requireSuperAdmin(req: any, res: any, next: any) {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.role !== "super_admin") return res.status(403).json({ error: "Forbidden: Super Admin only" });
  req.user = user;
  next();
}

async function requireTeamUserAdmin(req: any, res: any, next: any) {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.role !== "super_admin" && user.role !== "owner") {
    return res.status(403).json({ error: "Forbidden: Team User management requires Owner or Super Admin" });
  }
  req.user = user;
  next();
}

// Keep a basic auth check for any future non-super-admin admin routes
async function requireAuth(req: any, res: any, next: any) {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  next();
}

// ─── Database overview stats ───────────────────────────────────────────────
router.get("/admin/stats", requireSuperAdmin, async (_req, res) => {
  const tables = [
    "customers","leads","properties","quotes","jobs",
    "invoices","crews","services","recurring_plans","tasks",
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${t}`));
    counts[t] = (r.rows[0] as { n: number }).n;
  }
  return res.json(counts);
});

function safeUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    role: user.role,
    isActive: user.isActive,
    hasLocalPassword: Boolean(user.passwordHash),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function normalizeOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

// ─── Team User management ────────────────────────────────────────────────
router.get("/team-users/active", async (_req, res) => {
  const users = await db.select({
    id: usersTable.id,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    role: usersTable.role,
    isActive: usersTable.isActive,
  }).from(usersTable).where(eq(usersTable.isActive, true));
  return res.json(users.map((user) => ({
    id: user.id,
    displayName: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || "Team member",
    role: user.role,
    isActive: user.isActive,
  })));
});

router.get("/admin/users", requireTeamUserAdmin, async (_req, res) => {
  const users = await db.select().from(usersTable);
  return res.json(users.map(safeUser));
});

router.post("/admin/users", requireTeamUserAdmin, async (req, res) => {
  const actor = req.user!;
  const username = typeof req.body?.username === "string"
    ? req.body.username.trim().toLowerCase()
    : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = typeof req.body?.role === "string" ? req.body.role : "";
  if (!username || username.length > 100 || !password || password.length > 200) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  if (!isTeamUserRole(role)) {
    return res.status(400).json({ error: "Invalid team user role" });
  }
  if (role === "super_admin" && actor.role !== "super_admin") {
    return res.status(403).json({ error: "Owners cannot create Super Admin users" });
  }
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = ${username}`)
    .limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: "Username is already in use" });
  }

  try {
    const [created] = await db.insert(usersTable).values({
      username,
      passwordHash: await hashPassword(password),
      firstName: normalizeOptionalText(req.body?.firstName) ?? null,
      lastName: normalizeOptionalText(req.body?.lastName) ?? null,
      email: normalizeOptionalText(req.body?.email) ?? null,
      role,
      isActive: true,
    }).returning();
    return res.status(201).json(safeUser(created));
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({ error: "Username or email is already in use" });
    }
    throw error;
  }
});

router.patch("/admin/users/:id", requireTeamUserAdmin, async (req, res) => {
  const actor = req.user!;
  const { id } = req.params;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!target) return res.status(404).json({ error: "Team user not found" });

  const hasRole = req.body?.role !== undefined;
  const hasActive = req.body?.isActive !== undefined;
  if (!hasRole && !hasActive) {
    return res.status(400).json({ error: "No supported fields to update" });
  }
  if (hasActive && typeof req.body.isActive !== "boolean") {
    return res.status(400).json({ error: "isActive must be boolean" });
  }
  if (hasRole && !isTeamUserRole(req.body.role)) {
    return res.status(400).json({ error: "Invalid team user role" });
  }
  if (id === actor.id && req.body.isActive === false) {
    return res.status(400).json({ error: "You cannot deactivate your own account" });
  }
  if (id === actor.id && hasRole && req.body.role !== target.role) {
    return res.status(400).json({ error: "You cannot change your own role" });
  }
  if (target.role === "super_admin") {
    return res.status(403).json({ error: "Super Admin roles cannot be changed or deactivated" });
  }
  if (actor.role === "owner" && target.role === "super_admin") {
    return res.status(403).json({ error: "Owners cannot change Super Admin users" });
  }
  if (hasRole && req.body.role === "super_admin") {
    return res.status(403).json({ error: "Existing users cannot be promoted to Super Admin" });
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (hasRole) updates.role = req.body.role;
  if (hasActive) updates.isActive = req.body.isActive;
  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (hasRole || hasActive) await revokeUserSessions(id);
  return res.json(safeUser(updated));
});

router.post("/admin/users/:id/password-reset", requireTeamUserAdmin, async (req, res) => {
  const actor = req.user!;
  const { id } = req.params;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!target) return res.status(404).json({ error: "Team user not found" });
  if (target.role === "super_admin" && actor.role !== "super_admin") {
    return res.status(403).json({ error: "Owners cannot reset Super Admin passwords" });
  }
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!password || password.length > 200) {
    return res.status(400).json({ error: "A non-empty password is required" });
  }
  await db.update(usersTable).set({
    passwordHash: await hashPassword(password),
    updatedAt: new Date(),
  }).where(eq(usersTable.id, id));
  await revokeUserSessions(id);
  return res.json({ success: true });
});

// Hard deletion is intentionally not part of Team Users v1.
router.delete("/admin/users/:id", requireTeamUserAdmin, async (_req, res) => {
  return res.status(405).json({ error: "Team users can only be deactivated, not deleted" });
});

// ─── Export customers as JSON (frontend converts to CSV) ──────────────────
router.get("/admin/export/customers", requireSuperAdmin, async (_req, res) => {
  const rows = await db.execute(
    sql`SELECT first_name, last_name, email, home_phone, cell_phone, work_phone,
               company_name, billing_address, billing_city, billing_state, billing_zip,
               source, status, notes, how_heard, star_rating,
               to_char(created_at, 'YYYY-MM-DD') AS created_at
        FROM customers
        ORDER BY last_name, first_name`
  );
  return res.json(rows.rows);
});

// ─── Export leads as JSON (frontend converts to CSV) ──────────────────────
router.get("/admin/export/leads", requireSuperAdmin, async (_req, res) => {
  const rows = await db.execute(
    sql`SELECT first_name, last_name, email, phone, company_name,
               address, city, state, zip,
               source, status, notes,
               to_char(created_at, 'YYYY-MM-DD') AS created_at
        FROM leads
        ORDER BY last_name, first_name`
  );
  return res.json(rows.rows);
});

// ─── Import customers from CSV rows (JSON body) ───────────────────────────
router.post("/admin/import/customers", requireSuperAdmin, async (req, res) => {
  const rows: Record<string, string>[] = req.body?.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "No rows provided" });
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const firstName = (row.first_name || row.firstName || "").trim();
    const lastName  = (row.last_name  || row.lastName  || "").trim();
    const email     = (row.email || "").trim().toLowerCase();

    if (!firstName && !lastName) { skipped++; continue; }

    try {
      // Check for duplicate email
      if (email) {
        const dup = await db.execute(
          sql`SELECT id FROM customers WHERE email = ${email} LIMIT 1`
        );
        if ((dup.rows as any[]).length > 0) { skipped++; continue; }
      }

      await db.execute(
        sql`INSERT INTO customers
              (first_name, last_name, email, phone, billing_address, billing_city,
               billing_state, billing_zip, notes, status, created_at, updated_at)
            VALUES
              (${firstName}, ${lastName}, ${email || null},
               ${(row.phone || "").trim() || null},
               ${(row.billing_address || row.address || "").trim() || null},
               ${(row.billing_city || row.city || "").trim() || null},
               ${(row.billing_state || row.state || "AZ").trim()},
               ${(row.billing_zip || row.zip || "").trim() || null},
               ${(row.notes || "").trim() || null},
               ${(row.status || "active").trim()},
               NOW(), NOW())`
      );
      created++;
    } catch (err) {
      errors.push(`Row ${created + skipped + 1}: ${(err as Error).message}`);
      skipped++;
    }
  }

  return res.json({ created, skipped, errors });
});

// ─── Customer Factor import (batch, all 3 formats normalized client-side) ─────
// Each request is a batch of up to 200 customers + their jobs, already mapped
// to our schema field names by the frontend.  The frontend handles CSV, XLS
// (tab-separated), and MySQL SQL-dump parsing and sends clean JSON here.

interface ImportCustomer {
  cfId: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  salutation?: string;
  email?: string;
  homePhone?: string;
  workPhone?: string;
  cellPhone?: string;
  fax?: string;
  altPhone?: string;
  altContact?: string;
  billingAddress?: string;
  billingCity?: string;
  billingState?: string;
  billingZip?: string;
  notes?: string;
  howHeard?: string;
  starRating?: string;
  windowCount?: string;
  windowType?: string;
  houseSize?: string;
  laddersNeeded?: string;
  sendingPrefs?: string;
  customerDate?: string;
  status?: string;
  tags?: string;
}

interface ImportJob {
  cfCustomerId: string;
  jobNumber?: string;
  scheduledDate?: string;
  serviceType?: string;
  notes?: string;
  totalAmount?: string;
  status?: string;
  techNotes?: string;
}

router.post(
  "/admin/import/cf",
  express.json({ limit: "10mb" }),
  requireSuperAdmin,
  async (req, res) => {
    const customers: ImportCustomer[] = req.body?.customers ?? [];
    let jobs: ImportJob[];
    try {
      jobs = validateImportJobBatch<ImportJob>(req.body?.jobs ?? []);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }

    let customersCreated = 0, customersSkipped = 0;
    let jobsCreated = 0, jobsSkipped = 0;
    const errors: string[] = [];

    // cfId → db id (so we can create jobs under correct customer)
    const cfIdToDbId = new Map<string, number>();

    // ── Upsert customers ────────────────────────────────────────────────────
    for (const c of customers) {
      const firstName  = (c.firstName  || "").trim();
      const lastName   = (c.lastName   || "").trim();
      const email      = (c.email || "").trim().toLowerCase() || null;
      const homePhone  = (c.homePhone  || "").trim() || null;
      const cellPhone  = (c.cellPhone  || "").trim() || null;
      const companyName = (c.companyName || "").trim() || null;

      if (!firstName && !lastName && !companyName) { customersSkipped++; continue; }

      try {
        let existingId: number | null = null;

        // 1) Match by email
        if (email) {
          const r = await db.execute(sql`SELECT id FROM customers WHERE email = ${email} LIMIT 1`);
          if ((r.rows as any[]).length) existingId = (r.rows[0] as any).id;
        }

        // 2) Match by name + phone
        if (!existingId && firstName && lastName && (homePhone || cellPhone)) {
          const phone = homePhone || cellPhone;
          const r = await db.execute(sql`
            SELECT id FROM customers
            WHERE first_name = ${firstName} AND last_name = ${lastName}
              AND (home_phone = ${phone} OR cell_phone = ${phone})
            LIMIT 1`);
          if ((r.rows as any[]).length) existingId = (r.rows[0] as any).id;
        }

        // 3) Match by name + company (for commercial accounts)
        if (!existingId && companyName && !email) {
          const r = await db.execute(sql`
            SELECT id FROM customers WHERE company_name = ${companyName} LIMIT 1`);
          if ((r.rows as any[]).length) existingId = (r.rows[0] as any).id;
        }

        if (existingId) {
          cfIdToDbId.set(c.cfId, existingId);
          customersSkipped++;
        } else {
          const starRatingParsed  = c.starRating  ? parseInt(c.starRating,  10) : NaN;
          const windowCountParsed = c.windowCount ? parseInt(c.windowCount, 10) : NaN;
          const starRating  = Number.isFinite(starRatingParsed)  ? starRatingParsed  : null;
          const windowCount = Number.isFinite(windowCountParsed) ? windowCountParsed : null;
          const sendingPrefs = (c.sendingPrefs || "").trim() || null;
          const custDate     = (c.customerDate || "").trim() || null;

          const r = await db.execute(sql`
            INSERT INTO customers (
              first_name, last_name, company_name, salutation, email,
              home_phone, work_phone, cell_phone, fax, alt_phone, alt_contact,
              billing_address, billing_city, billing_state, billing_zip,
              notes, how_heard, star_rating, window_count, window_type,
              house_size, ladders_needed, sending_preferences,
              customer_date, status, tags, created_at, updated_at
            ) VALUES (
              ${firstName}, ${lastName}, ${companyName}, ${(c.salutation||"").trim()||null}, ${email},
              ${homePhone}, ${(c.workPhone||"").trim()||null}, ${cellPhone},
              ${(c.fax||"").trim()||null}, ${(c.altPhone||"").trim()||null}, ${(c.altContact||"").trim()||null},
              ${(c.billingAddress||"").trim()||null}, ${(c.billingCity||"").trim()||null},
              ${(c.billingState||"").trim()||null}, ${(c.billingZip||"").trim()||null},
              ${(c.notes||"").trim()||null}, ${(c.howHeard||"").trim()||null},
              ${starRating}, ${windowCount}, ${(c.windowType||"").trim()||null},
              ${(c.houseSize||"").trim()||null}, ${(c.laddersNeeded||"").trim()||null},
              ${sendingPrefs}, ${custDate}, ${c.status||"active"},
              ${(c.tags||"").trim()||null}, NOW(), NOW()
            ) RETURNING id`);
          const newId = (r.rows[0] as any).id;
          cfIdToDbId.set(c.cfId, newId);
          customersCreated++;
        }
      } catch (err) {
        errors.push(`Customer ${c.cfId||c.email||"?"}: ${(err as Error).message.slice(0, 80)}`);
        customersSkipped++;
      }
    }

    // ── Insert jobs ─────────────────────────────────────────────────────────
    for (const j of jobs) {
      const dbCustomerId = cfIdToDbId.get(j.cfCustomerId);
      if (!dbCustomerId) { jobsSkipped++; continue; }

      const jobNum = (j.jobNumber || "").trim() || null;

      try {
        // Dedup by job_number
        if (jobNum) {
          const r = await db.execute(sql`SELECT id FROM jobs WHERE job_number = ${jobNum} LIMIT 1`);
          if ((r.rows as any[]).length) { jobsSkipped++; continue; }
        }

        const amount = parseFloat(j.totalAmount || "0") || 0;
        const notes  = [j.notes, j.techNotes].filter(Boolean).join("\n").trim() || null;

        await db.execute(sql`
          INSERT INTO jobs (
            customer_id, job_number, status, service_type,
            scheduled_date, total_amount, notes, created_at, updated_at
          ) VALUES (
            ${dbCustomerId},
            ${jobNum ?? `IMP-${Date.now()}-${Math.random().toString(36).slice(2,6)}`},
            ${j.status || "completed"},
            ${(j.serviceType||"").trim()||null},
            ${(j.scheduledDate||"").trim()||null},
            ${amount}, ${notes}, NOW(), NOW()
          )`);
        jobsCreated++;
      } catch (err) {
        errors.push(`Job ${jobNum||"?"}: ${(err as Error).message.slice(0, 80)}`);
        jobsSkipped++;
      }
    }

    return res.json({ customersCreated, customersSkipped, jobsCreated, jobsSkipped, errors });
  }
);

// ─── Seed demo data ───────────────────────────────────────────────────────────
router.post("/admin/seed", requireSuperAdmin, async (req, res) => {
  const confirmation = req.body?.confirmation;
  if (confirmation !== DEMO_SEED_CONFIRMATION) {
    return res.status(400).json({
      error: `Demo seed requires confirmation "${DEMO_SEED_CONFIRMATION}"`,
    });
  }

  const gate = evaluateDemoSeedGate(process.env, confirmation);
  if (!gate.authorizedSandbox) {
    return res.status(403).json({
      error: "Demo seed is available only in an authorized Sandbox",
      detail: gate.reason,
    });
  }

  const result = await seedDemoData({ confirmation });
  if (!result.success) {
    if (result.message.startsWith("Demo seed denied:")) {
      return res.status(403).json({ error: result.message });
    }
    return res.status(500).json({ error: "Seed failed", detail: result.message });
  }
  return res.json({ success: true, message: result.message });
});

// ─── Purge all CRM data ────────────────────────────────────────────────────
router.post("/admin/purge", requireSuperAdmin, async (req, res) => {
  const gate = evaluateSandboxPurgeGate(process.env, req.body?.confirmation);
  if (!gate.allowed) {
    return res.status(403).json({
      error: "Sandbox purge is available only in an authorized Sandbox with exact confirmation",
      detail: gate.reason,
      confirmation: SANDBOX_PURGE_CONFIRMATION,
    });
  }

  try {
    // Gate above is retained to return a precise HTTP status before any
    // transaction is opened. runSandboxPurge repeats the coupled core guard.
    await runSandboxPurge(db, process.env, req.body?.confirmation);
    return res.json({ success: true, message: "All CRM data purged. User accounts preserved." });
  } catch (err) {
    console.error("Purge failed:", err);
    return res.status(500).json({ error: "Purge failed", detail: String(err) });
  }
});

router.post("/admin/dedup-properties", requireSuperAdmin, async (_req, res) => {
  try {
    const dupes = await db.execute(sql`
      SELECT customer_id, LOWER(TRIM(address)) as norm_addr, LOWER(TRIM(city)) as norm_city, TRIM(zip) as norm_zip,
             array_agg(id ORDER BY id) as ids, count(*) as cnt
      FROM properties
      GROUP BY customer_id, LOWER(TRIM(address)), LOWER(TRIM(city)), TRIM(zip)
      HAVING count(*) > 1
    `);

    let merged = 0;
    let deleted = 0;

    for (const row of dupes.rows as any[]) {
      const ids: number[] = row.ids;
      const keepId = ids[0];
      const removeIds = ids.slice(1);

      for (const rid of removeIds) {
        await db.execute(sql`UPDATE jobs SET property_id = ${keepId} WHERE property_id = ${rid}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${rid}`);
        deleted++;
      }

      const [cust] = (await db.execute(sql`SELECT default_property_id FROM customers WHERE id = ${row.customer_id}`)).rows as any[];
      if (cust && removeIds.includes(cust.default_property_id)) {
        await db.execute(sql`UPDATE customers SET default_property_id = ${keepId} WHERE id = ${row.customer_id}`);
      }

      merged++;
    }

    res.json({ merged, deleted, dupGroups: (dupes.rows as any[]).length });
  } catch (err) {
    console.error("Dedup failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

router.post("/admin/resync-default-properties", requireSuperAdmin, async (_req, res) => {
  try {
    const customers = (await db.execute(sql`
      SELECT c.id, c.default_property_id FROM customers c
      WHERE EXISTS (SELECT 1 FROM properties p WHERE p.customer_id = c.id)
    `)).rows as any[];

    let fixed = 0;
    let skipped = 0;

    for (const cust of customers) {
      if (cust.default_property_id) {
        const [exists] = (await db.execute(sql`SELECT id FROM properties WHERE id = ${cust.default_property_id} LIMIT 1`)).rows as any[];
        if (exists) { skipped++; continue; }
      }

      const primary = (await db.execute(sql`SELECT id FROM properties WHERE customer_id = ${cust.id} AND is_primary = true LIMIT 1`)).rows as any[];
      if (primary.length > 0) {
        await db.execute(sql`UPDATE customers SET default_property_id = ${primary[0].id} WHERE id = ${cust.id}`);
        fixed++;
        continue;
      }

      const mostRecent = (await db.execute(sql`
        SELECT j.property_id FROM jobs j
        WHERE j.customer_id = ${cust.id} AND j.is_hidden = false AND j.property_id IS NOT NULL
        ORDER BY j.created_at DESC LIMIT 1
      `)).rows as any[];
      if (mostRecent.length > 0) {
        const [propExists] = (await db.execute(sql`SELECT id FROM properties WHERE id = ${mostRecent[0].property_id} LIMIT 1`)).rows as any[];
        if (propExists) {
          await db.execute(sql`UPDATE customers SET default_property_id = ${mostRecent[0].property_id} WHERE id = ${cust.id}`);
          fixed++;
          continue;
        }
      }

      const oldest = (await db.execute(sql`SELECT id FROM properties WHERE customer_id = ${cust.id} ORDER BY id LIMIT 1`)).rows as any[];
      if (oldest.length > 0) {
        await db.execute(sql`UPDATE customers SET default_property_id = ${oldest[0].id} WHERE id = ${cust.id}`);
        fixed++;
      }
    }

    res.json({ total: customers.length, fixed, skipped });
  } catch (err) {
    console.error("Resync failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
