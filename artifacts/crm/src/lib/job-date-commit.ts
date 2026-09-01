export function committedScheduledDateMatches(
  requestedDate: string | null | undefined,
  committedDate: string | null | undefined,
): boolean {
  return requestedDate === undefined || requestedDate === committedDate;
}

export type JobScheduleFields = {
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
};

export function committedJobScheduleMatches(
  requested: JobScheduleFields,
  committed: JobScheduleFields,
): boolean {
  return (requested.scheduledDate === undefined || requested.scheduledDate === committed.scheduledDate)
    && (requested.scheduledStartTime === undefined || requested.scheduledStartTime === committed.scheduledStartTime)
    && (requested.scheduledEndTime === undefined || requested.scheduledEndTime === committed.scheduledEndTime);
}