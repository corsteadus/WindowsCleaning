import {
  chicagoDateTimeLocalToIso,
  isoToChicagoDateTimeLocal,
} from "./chicago-time.ts";

export function taskDueAtFromControl(value: string): string | null {
  return value === "" ? null : chicagoDateTimeLocalToIso(value);
}

export function taskDueAtToControl(value: string | null | undefined): string {
  return isoToChicagoDateTimeLocal(value);
}

export function committedTaskDueAtMatches(
  requested: string | null,
  committed: string | null | undefined,
): boolean {
  if (requested === null) return committed == null;
  const requestedInstant = new Date(requested).valueOf();
  const committedInstant = new Date(committed ?? "").valueOf();
  return Number.isFinite(requestedInstant) && requestedInstant === committedInstant;
}