import { isDateOnly, isTimeOnly } from "./date.ts";

export interface ImportJobTemporalValues {
  scheduledDate?: unknown;
  scheduledStartTime?: unknown;
  scheduledEndTime?: unknown;
}

export interface ValidImportJobTemporalValues {
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
}

function optionalExact(
  value: unknown,
  field: string,
  validator: (candidate: unknown) => candidate is string,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!validator(value)) throw new Error(`${field} must be a valid exact date/time value`);
  return value;
}

/**
 * Validate before entering any job-writing adapter. Valid date-only/time-only
 * strings are returned byte-for-byte; absent values remain null.
 */
export function validateImportJobTemporalValues(
  values: ImportJobTemporalValues,
): ValidImportJobTemporalValues {
  return {
    scheduledDate: optionalExact(values.scheduledDate, "scheduledDate", isDateOnly),
    scheduledStartTime: optionalExact(values.scheduledStartTime, "scheduledStartTime", isTimeOnly),
    scheduledEndTime: optionalExact(values.scheduledEndTime, "scheduledEndTime", isTimeOnly),
  };
}

export function validateImportJobBatch<T extends ImportJobTemporalValues>(
  jobs: readonly T[],
): Array<T & ValidImportJobTemporalValues> {
  return jobs.map((job) => ({ ...job, ...validateImportJobTemporalValues(job) }));
}

export async function writeValidatedImportedJob<T>(
  values: ImportJobTemporalValues,
  writer: (validated: ValidImportJobTemporalValues) => Promise<T>,
): Promise<T> {
  return writer(validateImportJobTemporalValues(values));
}