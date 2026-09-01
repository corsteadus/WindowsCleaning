export type JobDeleteEligibility = {
  canManageJobs: boolean;
  status: string | null | undefined;
  isDeleteProtected: boolean | undefined;
};

export function isCompletedJobStatus(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === "completed";
}

export function canOfferPermanentJobDelete({
  canManageJobs,
  status,
  isDeleteProtected,
}: JobDeleteEligibility): boolean {
  return canManageJobs
    && !isCompletedJobStatus(status)
    && isDeleteProtected === false;
}