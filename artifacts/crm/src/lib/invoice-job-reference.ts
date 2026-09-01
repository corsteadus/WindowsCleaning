export type InvoiceLinkedJob = {
  id: number;
  jobNumber?: string | null;
};

export type InvoiceJobReference =
  | { kind: "none" }
  | { kind: "available"; id: number; label: string; href: string }
  | { kind: "unavailable"; id: number; label: string };

export function resolveInvoiceJobReference(
  jobId: number | null | undefined,
  jobNumber: string | null | undefined,
  linkedJobs: readonly InvoiceLinkedJob[] | null | undefined,
): InvoiceJobReference {
  if (!Number.isInteger(jobId) || !jobId || jobId < 1) return { kind: "none" };

  const resolvedJob = linkedJobs?.find((job) => job.id === jobId);
  if (resolvedJob) {
    return {
      kind: "available",
      id: jobId,
      label: resolvedJob.jobNumber || jobNumber || `Job #${jobId}`,
      href: `/jobs/${jobId}`,
    };
  }
  return {
    kind: "unavailable",
    id: jobId,
    label: `Job #${jobId} — unavailable/deleted`,
  };
}