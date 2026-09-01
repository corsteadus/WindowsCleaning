import { db, jobsTable, recurringPlansTable, activityLogsTable, customersTable, crewsTable } from "@workspace/db";
import { eq, and, inArray, lte, isNull, isNotNull } from "drizzle-orm";
import { customerDisplayName } from "./customer-display";
import { enqueueCommunicationEvent } from "./communication-outbox";
import { addDaysToDateOnly, businessDateStr, isDateOnly, isTimeOnly } from "./date.ts";
import { validateAndLockActiveAssignmentReferences } from "./active-assignment-references.ts";

function addInterval(dateStr: string, frequencyType: string, intervalValue = 1): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  switch (frequencyType) {
    case "weekly":      d.setUTCDate(d.getUTCDate() + 7); break;
    case "biweekly":    d.setUTCDate(d.getUTCDate() + 14); break;
    case "monthly":     d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "bi_monthly":
    case "bimonthly":   d.setUTCMonth(d.getUTCMonth() + 2); break;
    case "quarterly":   d.setUTCMonth(d.getUTCMonth() + 3); break;
    case "semi_annual":
    case "semiannual":  d.setUTCMonth(d.getUTCMonth() + 6); break;
    case "annual":      d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    case "custom":      d.setUTCDate(d.getUTCDate() + intervalValue); break;
    default:            d.setUTCMonth(d.getUTCMonth() + 3);
  }
  return d.toISOString().split("T")[0];
}

export async function runRecurringPlanEngine(): Promise<{ generated: number; skipped: number; errors: number }> {
  const today = businessDateStr();
  let generated = 0, skipped = 0, errors = 0;

  // Find all active plans with autoGenerateJobs=true and nextRunDate <= today
  const duePlans = await db
    .select()
    .from(recurringPlansTable)
    .where(
      and(
        eq(recurringPlansTable.status, "active"),
        eq(recurringPlansTable.autoGenerateJobs, true),
        isNotNull(recurringPlansTable.nextRunDate),
        lte(recurringPlansTable.nextRunDate, today)
      )
    );

  for (const plan of duePlans) {
    try {
      if (!plan.nextRunDate) { skipped++; continue; }
      if (!isDateOnly(plan.nextRunDate) || (plan.preferredTimeWindow !== null && !isTimeOnly(plan.preferredTimeWindow))) {
        throw new Error("Recurring plan contains an invalid date-only or time-only schedule");
      }

      // Dedup: check if a job already exists for this plan+date
      const [existingJob] = await db
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(
          and(
            eq(jobsTable.recurringPlanId, plan.id),
            eq(jobsTable.scheduledDate, plan.nextRunDate)
          )
        );

      if (existingJob) {
        // Job already exists — just advance the nextRunDate
        const newNext = addInterval(plan.nextRunDate, plan.frequencyType, plan.intervalValue ?? 1);
        await db.update(recurringPlansTable)
          .set({ nextRunDate: newNext, lastGeneratedDate: today })
          .where(eq(recurringPlansTable.id, plan.id));
        skipped++;
        continue;
      }

      const jobNumber = `J-${Date.now()}-${plan.id}`;
      const [job] = await db.transaction(async (tx) => {
        await validateAndLockActiveAssignmentReferences({ crewIds: [plan.crewId] }, {
          lockActiveCrews: async (ids) => (await tx.select({ id: crewsTable.id }).from(crewsTable)
            .where(and(inArray(crewsTable.id, [...ids]), eq(crewsTable.isActive, true)))
            .for("update")).map((row) => row.id),
          lockActiveFieldTechUsers: async () => [],
        });
        const [created] = await tx.insert(jobsTable).values({
          customerId:         plan.customerId,
          propertyId:         plan.propertyId ?? null,
          crewId:             plan.crewId ?? null,
          recurringPlanId:    plan.id,
          jobNumber,
          status:              "scheduled",
          scheduledDate:       plan.nextRunDate,
          scheduledStartTime:  plan.preferredTimeWindow ?? null,
          serviceType:         plan.serviceType ?? null,
          estimatedDuration:   plan.defaultDurationMinutes ?? null,
          totalAmount:         plan.estimatedAmount ?? "0",
          notes:               plan.defaultServiceNotes ?? null,
          isRecurring:         true,
          recurringFrequency:  plan.frequencyType,
        }).returning();
        await enqueueCommunicationEvent(tx, {
          eventType: "appointment.scheduled",
          aggregateType: "job",
          aggregateId: created.id,
          payload: {
            customerId: created.customerId,
            jobId: created.id,
            scheduledDate: created.scheduledDate,
            changeKind: "scheduled",
          },
          source: "recurring_plan_engine",
          actorId: "scheduler",
          dedupeKey: `appointment.scheduled:${created.id}:${created.updatedAt.toISOString()}`,
        });
        return [created] as const;
      });

      // Advance nextRunDate
      const newNext = addInterval(plan.nextRunDate, plan.frequencyType, plan.intervalValue ?? 1);
      await db.update(recurringPlansTable)
        .set({ nextRunDate: newNext, lastGeneratedDate: today })
        .where(eq(recurringPlansTable.id, plan.id));

      // Activity log
      await db.insert(activityLogsTable).values({
        entityType:  "customer",
        entityId:    plan.customerId,
        action:      "job_created",
        toValue:     "scheduled",
        note:        `Job ${jobNumber} auto-created from recurring plan "${plan.name}" for ${plan.nextRunDate}`,
        performedBy: "system",
      }).catch(() => {});

      generated++;
    } catch (err) {
      console.error(`[recurring-plan-engine] Error processing plan ${plan.id}:`, err);
      errors++;
    }
  }

  return { generated, skipped, errors };
}

// ─── Due-for-service query ────────────────────────────────────────────────────
// Returns enriched plans grouped as: overdue | due_today | due_soon (within 14 days)

export async function getDueForService(windowDays = 14) {
  const todayStr = businessDateStr();
  const windowStr = addDaysToDateOnly(todayStr, windowDays);

  const plans = await db
    .select()
    .from(recurringPlansTable)
    .where(
      and(
        eq(recurringPlansTable.status, "active"),
        isNotNull(recurringPlansTable.nextRunDate),
        lte(recurringPlansTable.nextRunDate, windowStr)
      )
    );

  if (!plans.length) return [];

  const customerIds = [...new Set(plans.map((p) => p.customerId))];
  const customers = customerIds.length
    ? await db.select().from(customersTable).where(
        customerIds.length === 1
          ? eq(customersTable.id, customerIds[0])
          : { _: db.select({ id: customersTable.id }).from(customersTable) } as never
      )
    : [];

  // Simple customer map (use separate query for safety)
  const custRows = await db.select().from(customersTable);
  const custMap = Object.fromEntries(custRows.map((c) => [c.id, c]));

  return plans.map((p) => {
    const cust = custMap[p.customerId];
    const due = p.nextRunDate!;
    let dueStatus: "overdue" | "due_today" | "due_soon";
    if (due < todayStr) dueStatus = "overdue";
    else if (due === todayStr) dueStatus = "due_today";
    else dueStatus = "due_soon";

    return {
      ...p,
      dueStatus,
      daysUntilDue: Math.round((
        new Date(`${due}T12:00:00Z`).getTime()
        - new Date(`${todayStr}T12:00:00Z`).getTime()
      ) / 86400000),
      customerName: customerDisplayName(cust, p.customerId),
      customerEmail: cust?.email ?? null,
      customerPhone: cust?.phone ?? null,
      clientType: cust?.clientType ?? null,
    };
  }).sort((a, b) => a.nextRunDate!.localeCompare(b.nextRunDate!));
}
