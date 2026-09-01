import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  customersTable,
  db,
  invoicesTable,
  jobsTable,
  paymentsTable,
} from "@workspace/db";
import { businessDateStr } from "../lib/date.js";
import { canViewBusinessReporting } from "../lib/authorization.js";
import {
  dashboardWindows,
  dashboardRequestDecision,
  parseDashboardPeriod,
  percentChange,
  safeRate,
  type DateWindow,
} from "../lib/dashboard-reporting.js";

const router: IRouter = Router();

async function decisionMetrics(currentWindow: DateWindow, previousWindow: DateWindow) {
  const timezone = "America/Chicago";
  const rows = await db.execute(sql`
    WITH latest_revisions AS (
      SELECT DISTINCT ON (quote_id) id, quote_id
      FROM estimate_revisions
      ORDER BY quote_id, revision_number DESC, id DESC
    ),
    effective_links AS (
      SELECT DISTINCT ON (l.quote_id) l.quote_id, l.decision, l.decision_at
      FROM estimate_public_links l
      INNER JOIN latest_revisions r ON r.id = l.revision_id
      ORDER BY l.quote_id, l.sent_at DESC, l.id DESC
    ),
    reportable_decisions AS (
      SELECT quote_id, decision, decision_at
      FROM effective_links
      WHERE decision IN ('accepted', 'declined') AND decision_at IS NOT NULL
    ),
    legacy_accepted_quotes AS (
      SELECT DISTINCT quote_id FROM estimate_activities
      WHERE activity_type IN ('estimate_accepted', 'verbal_acceptance_recorded')
      UNION
      SELECT q.id FROM quotes q
      WHERE q.status IN ('accepted', 'approved')
    ),
    activity_conversions AS (
      SELECT a.quote_id, MIN(a.occurred_at) AS occurred_at
      FROM estimate_activities a
      WHERE activity_type = 'estimate_converted_and_scheduled'
        AND occurred_at >= (${previousWindow.start}::date::timestamp AT TIME ZONE ${timezone})
        AND occurred_at < ((${currentWindow.end}::date + 1)::timestamp AT TIME ZONE ${timezone})
      GROUP BY a.quote_id
    ),
    legacy_conversions AS (
      SELECT j.quote_id, MIN(j.created_at) AS occurred_at
      FROM jobs j
      INNER JOIN legacy_accepted_quotes d ON d.quote_id = j.quote_id
      WHERE j.created_at >= (${previousWindow.start}::date::timestamp AT TIME ZONE ${timezone})
        AND j.created_at < ((${currentWindow.end}::date + 1)::timestamp AT TIME ZONE ${timezone})
        AND NOT EXISTS (
          SELECT 1 FROM estimate_activities a
          WHERE a.quote_id = j.quote_id AND a.activity_type = 'estimate_converted_and_scheduled'
        )
      GROUP BY j.quote_id
    ),
    conversions AS (
      SELECT * FROM activity_conversions
      UNION ALL
      SELECT * FROM legacy_conversions
    )
    SELECT
      COUNT(*) FILTER (WHERE decision = 'accepted' AND decision_at >= (${currentWindow.start}::date::timestamp AT TIME ZONE ${timezone}) AND decision_at < ((${currentWindow.end}::date + 1)::timestamp AT TIME ZONE ${timezone}))::int AS current_accepted,
      COUNT(*) FILTER (WHERE decision = 'declined' AND decision_at >= (${currentWindow.start}::date::timestamp AT TIME ZONE ${timezone}) AND decision_at < ((${currentWindow.end}::date + 1)::timestamp AT TIME ZONE ${timezone}))::int AS current_declined,
      COUNT(*) FILTER (WHERE decision = 'accepted' AND decision_at >= (${previousWindow.start}::date::timestamp AT TIME ZONE ${timezone}) AND decision_at < ((${previousWindow.end}::date + 1)::timestamp AT TIME ZONE ${timezone}))::int AS previous_accepted,
      COUNT(*) FILTER (WHERE decision = 'declined' AND decision_at >= (${previousWindow.start}::date::timestamp AT TIME ZONE ${timezone}) AND decision_at < ((${previousWindow.end}::date + 1)::timestamp AT TIME ZONE ${timezone}))::int AS previous_declined,
      (SELECT COUNT(*)::int FROM conversions WHERE occurred_at >= (${currentWindow.start}::date::timestamp AT TIME ZONE ${timezone})) AS current_converted,
      (SELECT COUNT(*)::int FROM conversions WHERE occurred_at < (${currentWindow.start}::date::timestamp AT TIME ZONE ${timezone})) AS previous_converted
    FROM reportable_decisions
    WHERE decision_at >= (${previousWindow.start}::date::timestamp AT TIME ZONE ${timezone})
      AND decision_at < ((${currentWindow.end}::date + 1)::timestamp AT TIME ZONE ${timezone})
  `);
  const row = rows.rows[0] as Record<string, number> | undefined;
  return {
    current: {
      accepted: Number(row?.current_accepted ?? 0),
      declined: Number(row?.current_declined ?? 0),
      converted: Number(row?.current_converted ?? 0),
    },
    previous: {
      accepted: Number(row?.previous_accepted ?? 0),
      declined: Number(row?.previous_declined ?? 0),
      converted: Number(row?.previous_converted ?? 0),
    },
  };
}

async function postedSales(window: DateWindow): Promise<number> {
  const [row] = await db.select({
    total: sql<string>`COALESCE(SUM(${paymentsTable.amount}), 0)`,
  }).from(paymentsTable).where(and(
    eq(paymentsTable.status, "posted"),
    sql`${paymentsTable.paymentDate} >= ${window.start}`,
    sql`${paymentsTable.paymentDate} <= ${window.end}`,
  ));
  return Number(row?.total ?? 0);
}

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  const requestDecision = dashboardRequestDecision(
    canViewBusinessReporting(req.user?.role),
    req.query.period,
  );
  if (!requestDecision.ok) {
    res.status(requestDecision.status).json(requestDecision.status === 403
      ? { error: "Financial reporting access required", code: "forbidden" }
      : { error: "period must be today, last_7_days, last_month, last_quarter, or this_year" });
    return;
  }
  const period = requestDecision.period;
  const today = businessDateStr();
  const windows = dashboardWindows(period, today);
  const monthWindow = { start: `${today.slice(0, 7)}-01`, end: today };
  const yearWindow = { start: `${today.slice(0, 4)}-01-01`, end: today };

  const [
    decisions,
    periodSales,
    previousSales,
    monthlySales,
    ytdSales,
    invoiceSnapshot,
    attentionSnapshot,
    todayJobsList,
    pastDueInvoicesList,
  ] = await Promise.all([
    decisionMetrics(windows.current, windows.previous),
    postedSales(windows.current),
    postedSales(windows.previous),
    postedSales(monthWindow),
    postedSales(yearWindow),
    db.select({
      outstanding: sql<string>`COALESCE(SUM(${invoicesTable.balanceDue}) FILTER (
        WHERE ${invoicesTable.status} NOT IN ('paid', 'voided') AND ${invoicesTable.balanceDue}::numeric > 0
      ), 0)`,
      pastDueCount: sql<number>`COUNT(*) FILTER (
        WHERE ${invoicesTable.status} NOT IN ('paid', 'voided')
          AND ${invoicesTable.balanceDue}::numeric > 0
          AND ${invoicesTable.dueDate} < ${today}
      )::int`,
      pastDueValue: sql<string>`COALESCE(SUM(${invoicesTable.balanceDue}) FILTER (
        WHERE ${invoicesTable.status} NOT IN ('paid', 'voided')
          AND ${invoicesTable.balanceDue}::numeric > 0
          AND ${invoicesTable.dueDate} < ${today}
      ), 0)`,
    }).from(invoicesTable),
    Promise.all([
      db.select({ count: sql<number>`COUNT(*)::int` }).from(jobsTable).where(
        sql`${jobsTable.scheduledDate} IS NULL AND ${jobsTable.status} NOT IN ('completed', 'canceled')`
      ),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(invoicesTable).where(
        sql`${invoicesTable.status} NOT IN ('paid', 'voided') AND ${invoicesTable.balanceDue}::numeric > 0`
      ),
    ]),
    db.select({
      id: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      status: jobsTable.status,
      scheduledDate: jobsTable.scheduledDate,
      scheduledStartTime: jobsTable.scheduledStartTime,
      scheduledEndTime: jobsTable.scheduledEndTime,
      totalAmount: jobsTable.totalAmount,
      customerId: jobsTable.customerId,
      customerName: sql<string>`COALESCE(NULLIF(TRIM(${customersTable.firstName} || ' ' || ${customersTable.lastName}), ''), 'Customer')`,
    }).from(jobsTable)
      .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
      .where(eq(jobsTable.scheduledDate, today))
      .orderBy(jobsTable.scheduledStartTime).limit(10),
    db.select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      status: invoicesTable.status,
      totalAmount: invoicesTable.totalAmount,
      balanceDue: invoicesTable.balanceDue,
      dueDate: invoicesTable.dueDate,
      customerId: invoicesTable.customerId,
      customerName: sql<string>`COALESCE(NULLIF(TRIM(${customersTable.firstName} || ' ' || ${customersTable.lastName}), ''), 'Customer')`,
    }).from(invoicesTable)
      .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
      .where(sql`${invoicesTable.status} NOT IN ('paid', 'voided')
        AND ${invoicesTable.balanceDue}::numeric > 0 AND ${invoicesTable.dueDate} < ${today}`)
      .orderBy(invoicesTable.dueDate).limit(8),
  ]);
  const { current, previous } = decisions;

  const currentCloseRate = safeRate(current.accepted, current.accepted + current.declined);
  const previousCloseRate = safeRate(previous.accepted, previous.accepted + previous.declined);
  const metric = (value: number, previousValue: number) => ({
    value,
    previousValue,
    percentChange: percentChange(value, previousValue),
  });
  const snapshot = invoiceSnapshot[0];
  res.json({
    period,
    window: windows.current,
    previousWindow: windows.previous,
    definitions: {
      decisions: "Latest current-revision customer decision by decision date; status-only legacy decisions without an auditable timestamp are excluded.",
      closeRate: "Accepted divided by accepted plus declined; 0% when no decisions exist.",
      converted: "Accepted estimates converted during the period, using the conversion event or a legacy linked-job creation date.",
      sales: "Posted payment amounts by payment date; invoice totals and allocations are not added.",
      outstanding: "Positive invoice balance excluding paid and voided invoices.",
      pastDue: "Outstanding invoice with a due date before today.",
    },
    metrics: {
      acceptedEstimates: metric(current.accepted, previous.accepted),
      declinedEstimates: metric(current.declined, previous.declined),
      closeRate: metric(currentCloseRate, previousCloseRate),
      estimatesConverted: metric(current.converted, previous.converted),
      periodSales: metric(periodSales, previousSales),
      monthlySales,
      ytdSales,
      totalOutstanding: Number(snapshot?.outstanding ?? 0),
      pastDueCount: Number(snapshot?.pastDueCount ?? 0),
      pastDueValue: Number(snapshot?.pastDueValue ?? 0),
    },
    operational: {
      jobsToday: todayJobsList.length,
      unscheduledJobs: Number(attentionSnapshot[0][0]?.count ?? 0),
      unpaidInvoices: Number(attentionSnapshot[1][0]?.count ?? 0),
      todayJobsList: todayJobsList.map((job) => ({ ...job, totalAmount: Number(job.totalAmount) })),
      pastDueInvoicesList: pastDueInvoicesList.map((invoice) => ({
        ...invoice,
        totalAmount: Number(invoice.totalAmount),
        balanceDue: Number(invoice.balanceDue),
      })),
    },
  });
});

export default router;