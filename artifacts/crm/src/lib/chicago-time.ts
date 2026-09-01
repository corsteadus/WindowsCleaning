const CHICAGO_TIME_ZONE = "America/Chicago";
const WALL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHICAGO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function isoToChicagoDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const instant = new Date(iso);
  if (Number.isNaN(instant.valueOf())) return "";
  const parts = Object.fromEntries(
    formatter.formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Converts an explicit Chicago wall time to an instant. Nonexistent spring
 * times and ambiguous fall-back times return null rather than silently moving
 * or choosing one of two instants.
 */
export function chicagoDateTimeLocalToIso(value: string): string | null {
  const match = WALL_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(naive);
  if (
    month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59
    || normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day
  ) return null;

  const matches: number[] = [];
  // Chicago is always UTC-5 or UTC-6. Searching this bounded range also makes
  // DST gaps/overlaps explicit without relying on the browser's local zone.
  for (let offsetHours = 5; offsetHours <= 6; offsetHours += 1) {
    const candidate = naive + offsetHours * 60 * 60 * 1000;
    if (isoToChicagoDateTimeLocal(new Date(candidate).toISOString()) === value) {
      matches.push(candidate);
    }
  }
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}

export function chicagoAppointmentStartsAt(date: string, time: string): string | null {
  return chicagoDateTimeLocalToIso(`${date}T${time}`);
}

export function committedAppointmentMatches(
  requested: {
    startsAt: string;
    durationMinutes: number;
    propertyIds: number[];
    assignedUserId: string | null;
    appointmentNotes: string | null;
    estimateNotes: string | null;
  },
  committed: Partial<{
    startsAt: string;
    durationMinutes: number;
    propertyIds: number[];
    assignedUserId: string | null;
    appointmentNotes: string | null;
    estimateNotes: string | null;
  }> | null | undefined,
): boolean {
  if (!committed) return false;
  const requestedInstant = new Date(requested.startsAt).valueOf();
  const committedInstant = new Date(committed.startsAt ?? "").valueOf();
  return Number.isFinite(requestedInstant)
    && requestedInstant === committedInstant
    && requested.durationMinutes === committed.durationMinutes
    && normalizedAppointmentPropertyIds(requested.propertyIds).join(",")
      === normalizedAppointmentPropertyIds(committed.propertyIds).join(",")
    && requested.assignedUserId === (committed.assignedUserId ?? null)
    && requested.appointmentNotes === (committed.appointmentNotes ?? null)
    && requested.estimateNotes === (committed.estimateNotes ?? null);
}

export function normalizedAppointmentPropertyIds(ids: readonly number[] | null | undefined): number[] {
  return [...new Set((ids ?? []).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
}

export function hasAppointmentLocation(ids: readonly number[] | null | undefined): boolean {
  return normalizedAppointmentPropertyIds(ids).length > 0;
}