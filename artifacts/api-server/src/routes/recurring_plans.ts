import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { recurringPlansTable, customersTable, propertiesTable, jobsTable, activityLogsTable, crewsTable } from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { getDueForService } from "../lib/recurring-plan-engine";
import { businessDateStr, isDateOnly, isTimeOnly } from "../lib/date.ts";
import { enqueueCommunicationEvent } from "../lib/communication-outbox";
import {
  ActiveAssignmentReferenceError,
  validateAndLockActiveAssignmentReferences,
} from "../lib/active-assignment-references.ts";
import {
  AccountRelationError,
  normalizeOptionalPropertyId,
  requireActivePropertyForCustomer,
  requireCustomer,
} from "../lib/account-relations";

const router = Router();

function routeId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getPerformedBy(req: Request): string | null {
  if (!req.user) return null;
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || String((req.user as { id: string }).id);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addInterval(dateStr: string, frequencyType: string, intervalValue = 1): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  switch (frequencyType) {
    case "weekly":     d.setUTCDate(d.getUTCDate() + 7); break;
    case "biweekly":   d.setUTCDate(d.getUTCDate() + 14); break;
    case "monthly":    d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "bi_monthly":
    case "bimonthly":  d.setUTCMonth(d.getUTCMonth() + 2); break;
    case "quarterly":  d.setUTCMonth(d.getUTCMonth() + 3); break;
    case "semi_annual":
    case "semiannual": d.setUTCMonth(d.getUTCMonth() + 6); break;
    case "annual":     d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    case "custom":     d.setUTCDate(d.getUTCDate() + intervalValue); break;
    default:           d.setUTCMonth(d.getUTCMonth() + 3); // default quarterly
  }
  return d.toISOString().split("T")[0];
}

async function enrichPlans(plans: (typeof recurringPlansTable.$inferSelect)[]) {
  if (!plans.length) return [];
  const customerIds = [...new Set(plans.map((p) => p.customerId))];
  const propertyIds = [...new Set(plans.map((p) => p.propertyId).filter(Boolean) as number[])];
  const customers = customerIds.length
    ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds))
    : [];
  const properties = propertyIds.length
    ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
    : [];
  const custMap = Object.fromEntries(customers.map((c) => [c.id, c]));
  const propMap = Object.fromEntries(properties.map((p) => [p.id, p]));
  return plans.map((plan) => ({
    ...plan,
    customerName: custMap[plan.customerId]
      ? `${custMap[plan.customerId].firstName} ${custMap[plan.customerId].lastName}`
      : `Customer #${plan.customerId}`,
    propertyAddress: plan.propertyId && propMap[plan.propertyId]
      ? propMap[plan.propertyId].address
      : null,
    propertyName: plan.propertyId && propMap[plan.propertyId]
      ? propMap[plan.propertyId].name ?? null
      : null,
  }));
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// List
router.get("/recurring-plans", async (req, res) => {
  try {
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const rows = customerId
      ? await db.select().from(recurringPlansTable).where(eq(recurringPlansTable.customerId, customerId))
      : await db.select().from(recurringPlansTable).orderBy(recurringPlansTable.createdAt);
    res.json(await enrichPlans(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch recurring plans" });
  }
});

// Get single
router.get("/recurring-plans/:id", async (req, res) => {
  try {
    // Kept here because this parameter route predates /recurring-plans/due and
    // therefore receives that literal path first in Express.
    if (req.params.id === "due") {
      const windowDays = req.query.days ? Number(req.query.days) : 14;
      const results = await getDueForService(windowDays);
      res.json({ plans: results, total: results.length });
      return;
    }
    const id = routeId(req.params.id);
    if (!id) { res.status(400).json({ error: "Recurring plan id must be a positive integer" }); return; }
    const [plan] = await db.select().from(recurringPlansTable).where(eq(recurringPlansTable.id, id));
    if (!plan) { res.status(404).json({ error: "Not found" }); return; }
    const [enriched] = await enrichPlans([plan]);
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch recurring plan" });
  }
});

// Create
router.post("/recurring-plans", async (req, res) => {
  try {
    const body = req.body;
    const customerId = Number(body.customerId);
    const propertyId = normalizeOptionalPropertyId(body.propertyId);
    const [row] = await db.transaction(async (tx) => {
      await requireCustomer(tx, customerId);
      if (propertyId !== null) {
        await requireActivePropertyForCustomer(tx, customerId, propertyId);
      }
      return tx.insert(recurringPlansTable).values({
        customerId,
        propertyId,
        crewId: body.crewId ? Number(body.crewId) : null,
        name: body.name,
        status: body.status || "active",
        frequencyType: body.frequencyType || "quarterly",
        intervalValue: body.intervalValue ? Number(body.intervalValue) : 1,
        preferredDayOfWeek: body.preferredDayOfWeek || null,
        preferredTimeWindow: body.preferredTimeWindow || null,
        nextRunDate: body.nextRunDate || null,
        defaultServiceNotes: body.defaultServiceNotes || null,
        defaultDurationMinutes: body.defaultDurationMinutes ? Number(body.defaultDurationMinutes) : null,
        serviceType: body.serviceType || null,
        estimatedAmount: body.estimatedAmount ? String(body.estimatedAmount) : null,
        autoGenerateJobs: body.autoGenerateJobs ?? false,
      }).returning();
    });

    // Log plan creation
    await db.insert(activityLogsTable).values({
      entityType:  "customer",
      entityId:    row.customerId,
      action:      "recurring_plan_created",
      toValue:     row.name,
      note:        `Recurring plan "${row.name}" created (${row.frequencyType})`,
      performedBy: getPerformedBy(req),
    }).catch(() => {});

    const [enriched] = await enrichPlans([row]);
    res.status(201).json(enriched);
  } catch (err) {
    if (err instanceof AccountRelationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create recurring plan" });
  }
});

// Update
router.patch("/recurring-plans/:id", async (req, res) => {
  try {
    const id = routeId(req.params.id);
    if (!id) { res.status(400).json({ error: "Recurring plan id must be a positive integer" }); return; }
    const body = req.body;

    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(recurringPlansTable).where(eq(recurringPlansTable.id, id));
      if (!before) return null;

      const customerId = body.customerId !== undefined ? Number(body.customerId) : before.customerId;
      await requireCustomer(tx, customerId);
      const propertyId = body.propertyId !== undefined
        ? normalizeOptionalPropertyId(body.propertyId)
        : before.propertyId;
      if (propertyId !== null) {
        await requireActivePropertyForCustomer(tx, customerId, propertyId);
      }

      const update: Record<string, unknown> = {};
      if (body.customerId !== undefined) update.customerId = customerId;
      if (body.propertyId !== undefined) update.propertyId = propertyId;
      if (body.name !== undefined) update.name = body.name;
      if (body.status !== undefined) update.status = body.status;
      if (body.frequencyType !== undefined) update.frequencyType = body.frequencyType;
      if (body.intervalValue !== undefined) update.intervalValue = Number(body.intervalValue);
      if (body.preferredDayOfWeek !== undefined) update.preferredDayOfWeek = body.preferredDayOfWeek || null;
      if (body.preferredTimeWindow !== undefined) update.preferredTimeWindow = body.preferredTimeWindow || null;
      if (body.nextRunDate !== undefined) update.nextRunDate = body.nextRunDate || null;
      if (body.lastGeneratedDate !== undefined) update.lastGeneratedDate = body.lastGeneratedDate || null;
      if (body.defaultServiceNotes !== undefined) update.defaultServiceNotes = body.defaultServiceNotes || null;
      if (body.defaultDurationMinutes !== undefined) update.defaultDurationMinutes = body.defaultDurationMinutes ? Number(body.defaultDurationMinutes) : null;
      if (body.serviceType !== undefined) update.serviceType = body.serviceType || null;
      if (body.estimatedAmount !== undefined) update.estimatedAmount = body.estimatedAmount ? String(body.estimatedAmount) : null;
      if (body.autoGenerateJobs !== undefined) update.autoGenerateJobs = body.autoGenerateJobs;

      const [row] = await tx.update(recurringPlansTable).set(update).where(eq(recurringPlansTable.id, id)).returning();
      return { before, row };
    });
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    const { before, row } = result;

    const performedBy = getPerformedBy(req);

    // Log status changes
    if (before && body.status !== undefined && body.status !== before.status) {
      await db.insert(activityLogsTable).values({
        entityType:  "customer",
        entityId:    before.customerId,
        action:      "recurring_plan_status_changed",
        fromValue:   before.status,
        toValue:     body.status,
        note:        `Recurring plan "${before.name}" status changed from ${before.status} to ${body.status}`,
        performedBy,
      }).catch(() => {});
    }

    // Log auto-generate toggle
    if (before && body.autoGenerateJobs !== undefined && body.autoGenerateJobs !== before.autoGenerateJobs) {
      await db.insert(activityLogsTable).values({
        entityType:  "customer",
        entityId:    before.customerId,
        action:      "recurring_plan_updated",
        toValue:     body.autoGenerateJobs ? "auto_generate_enabled" : "auto_generate_disabled",
        note:        `Recurring plan "${before.name}" auto-generate ${body.autoGenerateJobs ? "enabled" : "disabled"}`,
        performedBy,
      }).catch(() => {});
    }

    const [enriched] = await enrichPlans([row]);
    res.json(enriched);
  } catch (err) {
    if (err instanceof AccountRelationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update recurring plan" });
  }
});

// Due-for-service — active plans with nextRunDate within N days (default 14)
router.get("/recurring-plans/due", async (req, res) => {
  try {
    const windowDays = req.query.days ? Number(req.query.days) : 14;
    const results = await getDueForService(windowDays);
    res.json({ plans: results, total: results.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch due-for-service plans" });
  }
});

// Generate next job from plan (manual trigger)
router.post("/recurring-plans/:id/generate-job", async (req, res) => {
  try {
    const id = routeId(req.params.id);
    if (!id) { res.status(400).json({ error: "Recurring plan id must be a positive integer" }); return; }
    const [plan] = await db.select().from(recurringPlansTable).where(eq(recurringPlansTable.id, id));
    if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
    if (plan.status !== "active") {
      res.status(400).json({ error: `Cannot generate a job — plan is ${plan.status}` });
      return;
    }
    if (!plan.nextRunDate) {
      res.status(400).json({ error: "Plan has no nextRunDate set. Edit the plan and set a next run date first." });
      return;
    }
    const nextRunDate = plan.nextRunDate;
    if (!isDateOnly(nextRunDate) || (plan.preferredTimeWindow !== null && !isTimeOnly(plan.preferredTimeWindow))) {
      res.status(400).json({ error: "Plan has an invalid date-only or time-only schedule" });
      return;
    }

    const jobNumber = `J-${Date.now()}`;
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: jobsTable.id, jobNumber: jobsTable.jobNumber })
        .from(jobsTable)
        .where(and(eq(jobsTable.recurringPlanId, id), eq(jobsTable.scheduledDate, nextRunDate)));
      if (existing) return { kind: "existing" as const, existing };

      await validateAndLockActiveAssignmentReferences({ crewIds: [plan.crewId] }, {
        lockActiveCrews: async (ids) => (await tx.select({ id: crewsTable.id }).from(crewsTable)
          .where(and(inArray(crewsTable.id, [...ids]), eq(crewsTable.isActive, true)))
          .for("update")).map((row) => row.id),
        lockActiveFieldTechUsers: async () => [],
      });
      const [job] = await tx.insert(jobsTable).values({
        customerId:         plan.customerId,
        propertyId:         plan.propertyId ?? null,
        crewId:             plan.crewId ?? null,
        recurringPlanId:    id,
        jobNumber,
        status:             "scheduled",
        scheduledDate:      nextRunDate,
        scheduledStartTime: plan.preferredTimeWindow ?? null,
        serviceType:        plan.serviceType ?? null,
        estimatedDuration:  plan.defaultDurationMinutes ?? null,
        totalAmount:        plan.estimatedAmount ?? "0",
        notes:              plan.defaultServiceNotes ?? null,
        isRecurring:        true,
        recurringFrequency: plan.frequencyType,
      }).returning();
      await enqueueCommunicationEvent(tx, {
        eventType: "appointment.scheduled",
        aggregateType: "job",
        aggregateId: job.id,
        payload: {
          customerId: job.customerId,
          jobId: job.id,
          scheduledDate: job.scheduledDate,
          changeKind: "scheduled",
        },
        source: "recurring_plans.generate_job",
        actorId: getPerformedBy(req),
        dedupeKey: `appointment.scheduled:${job.id}:${job.updatedAt.toISOString()}`,
      });
      return { kind: "created" as const, job };
    });

    if (result.kind === "existing") {
      res.status(409).json({
        error: `A job already exists for this plan on ${nextRunDate} (Job #${result.existing.jobNumber})`,
        jobId: result.existing.id,
      });
      return;
    }
    const job = result.job;

    // Update plan: lastGeneratedDate = now, nextRunDate = next interval
    const today = businessDateStr();
    const newNextRunDate = addInterval(nextRunDate, plan.frequencyType, plan.intervalValue ?? 1);
    await db.update(recurringPlansTable).set({
      lastGeneratedDate: today,
      nextRunDate: newNextRunDate,
    }).where(eq(recurringPlansTable.id, id));

    // Activity log
    await db.insert(activityLogsTable).values({
      entityType:  "customer",
      entityId:    plan.customerId,
      action:      "job_created",
      toValue:     "scheduled",
      note:        `Job ${jobNumber} generated from recurring plan "${plan.name}" for ${nextRunDate}`,
      performedBy: "manual",
    }).catch(() => {});

    res.status(201).json({
      job,
      newNextRunDate,
      message: `Job ${jobNumber} created. Next run date updated to ${newNextRunDate}.`,
    });
  } catch (err) {
    console.error(err);
    if (err instanceof ActiveAssignmentReferenceError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Failed to generate job" });
  }
});

// Delete
router.delete("/recurring-plans/:id", async (req, res) => {
  try {
    const id = routeId(req.params.id);
    if (!id) { res.status(400).json({ error: "Recurring plan id must be a positive integer" }); return; }
    // Snapshot before delete
    const [snap] = await db.select({
      customerId: recurringPlansTable.customerId,
      name: recurringPlansTable.name,
    }).from(recurringPlansTable).where(eq(recurringPlansTable.id, id));

    await db.delete(recurringPlansTable).where(eq(recurringPlansTable.id, id));

    if (snap) {
      await db.insert(activityLogsTable).values({
        entityType:  "customer",
        entityId:    snap.customerId,
        action:      "recurring_plan_deleted",
        toValue:     snap.name,
        note:        `Recurring plan "${snap.name}" deleted`,
        performedBy: getPerformedBy(req),
      }).catch(() => {});
    }

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete recurring plan" });
  }
});

export default router;
