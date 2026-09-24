import { deriveEstimateStatus, type EstimateDisplayStatus, type EstimateLifecycleInput } from "./estimate-lifecycle.ts";

/**
 * The status of a page of estimates, worked out in one pass.
 *
 * Kyle (Random Edits #4) wants the status "in the Estimates list, at the top of
 * the individual estimate, and anywhere the estimate appears in scheduling or
 * reporting". The list therefore needs the same derived status as the detail
 * page — but per-estimate queries would be a query per row, so the rows are
 * fetched in four set-based reads and matched up here.
 */

export interface QuoteRow { id: number; status?: string | null }
export interface AppointmentRow { quoteId: number }
export interface RevisionRow { quoteId: number; id: number; revisionNumber: number }
export interface PublicLinkRow {
  quoteId: number;
  revisionId: number | null;
  sentAt?: Date | string | null;
  firstOpenedAt?: Date | string | null;
  decision?: string | null;
  expiresAt?: Date | string | null;
}
export interface LinkedJobRow { quoteId: number | null }

export interface QuoteStatusSources {
  quotes: readonly QuoteRow[];
  appointments: readonly AppointmentRow[];
  revisions: readonly RevisionRow[];
  links: readonly PublicLinkRow[];
  jobs: readonly LinkedJobRow[];
}

/** The newest revision of each estimate. */
function latestRevisions(revisions: readonly RevisionRow[]): Map<number, RevisionRow> {
  const latest = new Map<number, RevisionRow>();
  for (const revision of revisions) {
    const current = latest.get(revision.quoteId);
    if (!current || revision.revisionNumber > current.revisionNumber) latest.set(revision.quoteId, revision);
  }
  return latest;
}

/** The link that was sent most recently for each estimate. */
function latestLinks(links: readonly PublicLinkRow[]): Map<number, PublicLinkRow> {
  const time = (value: Date | string | null | undefined) => {
    if (!value) return 0;
    const at = value instanceof Date ? value : new Date(value);
    return Number.isNaN(at.getTime()) ? 0 : at.getTime();
  };
  const latest = new Map<number, PublicLinkRow>();
  for (const link of links) {
    const current = latest.get(link.quoteId);
    if (!current || time(link.sentAt) >= time(current.sentAt)) latest.set(link.quoteId, link);
  }
  return latest;
}

export function buildQuoteStatusInputs(sources: QuoteStatusSources): Map<number, EstimateLifecycleInput> {
  const appointments = new Set(sources.appointments.map((row) => row.quoteId));
  const revisions = latestRevisions(sources.revisions);
  const links = latestLinks(sources.links);
  const linkedJobs = new Set(sources.jobs.map((row) => row.quoteId).filter((id): id is number => id !== null));

  const inputs = new Map<number, EstimateLifecycleInput>();
  for (const quote of sources.quotes) {
    const revision = revisions.get(quote.id);
    const link = links.get(quote.id);
    // A link that belongs to an older revision says nothing about this one.
    const effective = link && revision && link.revisionId === revision.id ? link : undefined;
    inputs.set(quote.id, {
      legacyStatus: quote.status ?? null,
      hasAppointment: appointments.has(quote.id),
      hasFinalizedRevision: Boolean(revision),
      sentAt: effective?.sentAt ?? null,
      firstOpenedAt: effective?.firstOpenedAt ?? null,
      decision: effective?.decision ?? null,
      expiresAt: effective?.expiresAt ?? null,
      hasLinkedJob: linkedJobs.has(quote.id),
    });
  }
  return inputs;
}

export function deriveQuoteStatuses(
  sources: QuoteStatusSources,
  now = new Date(),
): Map<number, EstimateDisplayStatus> {
  const statuses = new Map<number, EstimateDisplayStatus>();
  for (const [quoteId, input] of buildQuoteStatusInputs(sources)) {
    statuses.set(quoteId, deriveEstimateStatus({ ...input, now }));
  }
  return statuses;
}
