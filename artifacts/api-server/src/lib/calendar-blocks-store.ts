import { and, eq, lte, gte, sql } from "drizzle-orm";
// The schema, not the package root: the root opens a connection pool on
// import, which would make a rule about dates untestable without a database.
import { calendarEventsTable } from "@workspace/db/schema";
import { blockDecision, type Booking, type SchedulingBlock } from "./calendar-blocks.ts";

/**
 * Reading the blocks that stand in the way of a booking.
 *
 * Kept apart from the rules themselves so those stay testable without a
 * database, and used by every path that can put work on a day: creating a job,
 * rescheduling one, and moving a whole day.
 *
 * **Only hard blocks are enforced here.** A soft block warns, and a warning
 * belongs on the screen where somebody can answer it — refusing it in the API
 * would turn "the scheduler decides" into "the server decides".
 */
/**
 * Anything that can run the one query below — the real `db` or a transaction,
 * so a reschedule can read the blocks with the job row already locked.
 */
interface Reader {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => { where: (condition: unknown) => Promise<unknown[]> };
  };
}

/** Every active block covering a date, whatever its scope. */
export async function blocksOnDate(reader: Reader, date: string): Promise<SchedulingBlock[]> {
  const rows = await reader.select({
    id: calendarEventsTable.id,
    title: calendarEventsTable.title,
    startDate: calendarEventsTable.startDate,
    endDate: calendarEventsTable.endDate,
    startTime: calendarEventsTable.startTime,
    endTime: calendarEventsTable.endTime,
    isAllDay: calendarEventsTable.isAllDay,
    scopeType: calendarEventsTable.scopeType,
    crewId: calendarEventsTable.crewId,
    userId: calendarEventsTable.userId,
    blockMode: calendarEventsTable.blockMode,
    reason: calendarEventsTable.reason,
    isActive: calendarEventsTable.isActive,
  }).from(calendarEventsTable).where(and(
    eq(calendarEventsTable.eventType, "scheduling_block"),
    eq(calendarEventsTable.isActive, true),
    lte(calendarEventsTable.startDate, date),
    gte(sql`COALESCE(${calendarEventsTable.endDate}, ${calendarEventsTable.startDate})`, date),
  ));
  return rows as SchedulingBlock[];
}

/**
 * The reason a booking is refused, or null when it may proceed.
 *
 * Soft blocks deliberately return null: they are a warning for the screen, not
 * a refusal for the API.
 */
export async function hardBlockRefusal(
  reader: Reader,
  booking: Booking,
): Promise<string | null> {
  const blocks = await blocksOnDate(reader, booking.date);
  if (blocks.length === 0) return null;
  const decision = blockDecision(booking, blocks);
  return decision.kind === "refused" ? decision.message : null;
}
