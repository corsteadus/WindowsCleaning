/**
 * Each estimate as the profile lists it — Kyle, Videos 4 and 5: "I want to be
 * able to go back and see all the history … previous pricing, the locations,
 * and who the estimate was assigned to." Built from rows the profile route
 * reads in one go; nothing here touches the database.
 */

export interface EstimateSummary {
  /** Where the work is: every location a line or the appointment is for. */
  locations: Array<{ id: number; label: string }>;
  /** Who is going out to see it, and when. */
  estimator: string | null;
  appointmentAt: string | null;
  lineCount: number;
  /** Lines still to be quoted (Kyle, 2026-10-24) — none can be sent or scheduled. */
  pendingCount: number;
  /** The latest finalized revision, or null when it has never been finalized. */
  revisionNumber: number | null;
  /** Jobs already made from it. */
  jobCount: number;
}

export interface EstimateSummaryInput {
  quotes: ReadonlyArray<{ id: number; propertyId: number | null }>;
  appointments: ReadonlyArray<{ quoteId: number; startsAt: Date | string; assignedUserId: string | null }>;
  users: ReadonlyArray<{ id: string; firstName: string | null; lastName: string | null; username: string | null }>;
  locations: ReadonlyArray<{ quoteId: number; propertyId: number }>;
  lines: ReadonlyArray<{ quoteId: number; propertyId: number | null; pricePending: boolean }>;
  revisions: ReadonlyArray<{ quoteId: number; revisionNumber: number }>;
  jobs: ReadonlyArray<{ quoteId: number | null }>;
  properties: ReadonlyArray<{ id: number; name: string | null; address: string | null }>;
}

const nameOf = (user: EstimateSummaryInput["users"][number]) =>
  [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || "Someone";

/** A location by its own name, else its street — "Primary service property" says nothing. */
const labelOf = (property: EstimateSummaryInput["properties"][number] | undefined, id: number) => {
  const name = property?.name?.trim();
  if (name && name !== "Primary service property") return name;
  return property?.address?.trim() || `Location #${id}`;
};

export function summarizeEstimates(input: EstimateSummaryInput): Map<number, EstimateSummary> {
  const summaries = new Map<number, EstimateSummary>();
  for (const quote of input.quotes) {
    const appointment = input.appointments.find((row) => row.quoteId === quote.id) ?? null;
    const lines = input.lines.filter((row) => row.quoteId === quote.id);
    const ids = new Set<number>();
    for (const row of input.locations) if (row.quoteId === quote.id) ids.add(row.propertyId);
    for (const line of lines) if (line.propertyId) ids.add(line.propertyId);
    if (!ids.size && quote.propertyId) ids.add(quote.propertyId);
    const assignee = appointment?.assignedUserId ? input.users.find((user) => user.id === appointment.assignedUserId) : undefined;
    const revisions = input.revisions.filter((row) => row.quoteId === quote.id).map((row) => row.revisionNumber);
    summaries.set(quote.id, {
      locations: [...ids].map((id) => ({ id, label: labelOf(input.properties.find((property) => property.id === id), id) })),
      estimator: assignee ? nameOf(assignee) : null,
      appointmentAt: appointment ? new Date(appointment.startsAt).toISOString() : null,
      lineCount: lines.length,
      pendingCount: lines.filter((line) => line.pricePending).length,
      revisionNumber: revisions.length ? Math.max(...revisions) : null,
      jobCount: input.jobs.filter((row) => row.quoteId === quote.id).length,
    });
  }
  return summaries;
}
