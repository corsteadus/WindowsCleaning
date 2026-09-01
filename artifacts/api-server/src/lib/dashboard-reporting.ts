export type DashboardPeriod = "today" | "last_7_days" | "last_month" | "last_quarter" | "this_year";

export interface DateWindow {
  start: string;
  end: string;
}

export interface DashboardWindows {
  current: DateWindow;
  previous: DateWindow;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function endOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0, 12));
}

export function dashboardWindows(period: DashboardPeriod, today: string): DashboardWindows {
  const now = utcDate(today);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (period === "today") {
    return {
      current: { start: today, end: today },
      previous: { start: iso(addDays(now, -1)), end: iso(addDays(now, -1)) },
    };
  }
  if (period === "last_7_days") {
    return {
      current: { start: iso(addDays(now, -6)), end: today },
      previous: { start: iso(addDays(now, -13)), end: iso(addDays(now, -7)) },
    };
  }
  if (period === "last_month") {
    const currentEnd = new Date(Date.UTC(year, month, 0, 12));
    const currentStart = new Date(Date.UTC(currentEnd.getUTCFullYear(), currentEnd.getUTCMonth(), 1, 12));
    const previousEnd = addDays(currentStart, -1);
    const previousStart = new Date(Date.UTC(previousEnd.getUTCFullYear(), previousEnd.getUTCMonth(), 1, 12));
    return {
      current: { start: iso(currentStart), end: iso(currentEnd) },
      previous: { start: iso(previousStart), end: iso(previousEnd) },
    };
  }
  if (period === "last_quarter") {
    const currentQuarterStartMonth = Math.floor(month / 3) * 3;
    const currentEnd = new Date(Date.UTC(year, currentQuarterStartMonth, 0, 12));
    const currentStart = new Date(Date.UTC(currentEnd.getUTCFullYear(), Math.floor(currentEnd.getUTCMonth() / 3) * 3, 1, 12));
    const previousEnd = addDays(currentStart, -1);
    const previousStart = new Date(Date.UTC(previousEnd.getUTCFullYear(), Math.floor(previousEnd.getUTCMonth() / 3) * 3, 1, 12));
    return {
      current: { start: iso(currentStart), end: iso(currentEnd) },
      previous: { start: iso(previousStart), end: iso(previousEnd) },
    };
  }

  const currentStart = new Date(Date.UTC(year, 0, 1, 12));
  const previousStart = new Date(Date.UTC(year - 1, 0, 1, 12));
  const previousEnd = new Date(Date.UTC(year - 1, month, now.getUTCDate(), 12));
  if (previousEnd.getUTCMonth() !== month) {
    previousEnd.setTime(endOfMonth(year - 1, month).getTime());
  }
  return {
    current: { start: iso(currentStart), end: today },
    previous: { start: iso(previousStart), end: iso(previousEnd) },
  };
}

export function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function parseDashboardPeriod(value: unknown): DashboardPeriod | null {
  const periods: DashboardPeriod[] = ["today", "last_7_days", "last_month", "last_quarter", "this_year"];
  return periods.includes(value as DashboardPeriod) ? value as DashboardPeriod : null;
}

export function dashboardRequestDecision(
  authorized: boolean,
  requestedPeriod: unknown,
): { ok: true; period: DashboardPeriod } | { ok: false; status: 400 | 403 } {
  if (!authorized) return { ok: false, status: 403 };
  const period = parseDashboardPeriod(requestedPeriod ?? "last_7_days");
  return period ? { ok: true, period } : { ok: false, status: 400 };
}

export function financialSnapshot(
  invoices: Array<{ status: string; balanceDue: number; dueDate?: string | null }>,
  today: string,
) {
  const outstanding = invoices.filter((invoice) =>
    !["paid", "voided", "credited"].includes(invoice.status) && invoice.balanceDue > 0
  );
  const pastDue = outstanding.filter((invoice) => Boolean(invoice.dueDate && invoice.dueDate < today));
  return {
    totalOutstanding: outstanding.reduce((sum, invoice) => sum + invoice.balanceDue, 0),
    pastDueCount: pastDue.length,
    pastDueValue: pastDue.reduce((sum, invoice) => sum + invoice.balanceDue, 0),
  };
}

export function isPeriodReportableDecision(decision: string | null, decisionAt: Date | null): boolean {
  return (decision === "accepted" || decision === "declined") && decisionAt instanceof Date;
}

export function isAuthoritativeConversionActivity(activityType: string): boolean {
  return activityType === "estimate_converted_and_scheduled";
}