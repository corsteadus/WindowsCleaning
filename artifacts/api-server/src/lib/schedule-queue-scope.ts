import { sql, type SQL } from "drizzle-orm";
import { assignedJobCondition } from "./field-tech-scope.ts";

/**
 * Who sees what in the scheduling queue.
 *
 * This lives beside the queue's other rules rather than in the repository so
 * it can be tested without a database — the repository opens a connection pool
 * at import time, and a visibility rule is exactly the kind of thing that must
 * never go untested for want of one.
 *
 * Two separate restrictions, deliberately not collapsed into one flag:
 *
 *  - **Which rows.** Assignment-scoped roles see only work assigned to them,
 *    through the same predicate the jobs routes use. The queue must not become
 *    a way around assignment scoping.
 *  - **Whether money.** The same roles see no amounts, matching
 *    `routes/calendar.ts`. A field tech knowing when a job runs is operational;
 *    knowing what it is worth is not.
 */
export type QueueVisibility = {
  jobFilter: SQL<unknown>;
  showAmounts: boolean;
};

export function queueVisibility(
  isAssignmentScoped: boolean,
  userId: string | undefined,
): QueueVisibility {
  return {
    // A scoped role with no user id gets no rows rather than all of them. That
    // should be unreachable — authorization runs first — but the failure mode
    // if it ever is reached should be an empty queue, not the whole company's.
    jobFilter: isAssignmentScoped
      ? (userId ? assignedJobCondition(userId) : sql`FALSE`)
      : sql`TRUE`,
    showAmounts: !isAssignmentScoped,
  };
}
