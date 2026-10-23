/**
 * The estimate booked on the Add Prospect form — profile redesign piece B2
 * (Kyle, Video 3). Services, each at one of the form's locations, with a price
 * or none; and, optionally, the estimator and time. The server writes it in
 * the same transaction as the prospect (api-server lib/intake.ts).
 *
 * Kyle (2026-10-24): a blank price is "to be quoted" — sent as null, and an
 * estimate with one is never emailed. $0.00 is a real price and can be sent
 * (api-server lib/estimate-pricing.ts).
 */
import { chicagoAppointmentStartsAt } from "./chicago-time.ts";

export interface EstimateLineDraft {
  key: string;
  serviceId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  /** 0 is the main address; 1 and 2 the form's extra locations. */
  location: number;
  serviceNotes: string;
}

export interface EstimateAppointmentDraft {
  date: string;
  time: string;
  duration: string;
  assignedUserId: string;
  appointmentNotes: string;
}

export const BLANK_APPOINTMENT: EstimateAppointmentDraft = { date: "", time: "", duration: "60", assignedUserId: "", appointmentNotes: "" };

const clean = (value: string | null | undefined) => (value ?? "").trim();
const priced = (line: EstimateLineDraft) => clean(line.unitPrice) !== "" && Number(line.unitPrice) >= 0;
const filled = (line: EstimateLineDraft) => Boolean(clean(line.description));

/** Nothing about the appointment was touched: the estimate is saved unscheduled. */
export function appointmentIsBlank(draft: EstimateAppointmentDraft): boolean {
  return !draft.date && !draft.time && !draft.assignedUserId && !clean(draft.appointmentNotes);
}

/** What stops the estimate from being saved, in words. */
export function estimateProblems(
  lines: readonly EstimateLineDraft[],
  appointment: EstimateAppointmentDraft,
  available: { main: boolean; locations: number },
): string[] {
  const problems: string[] = [];
  const used = lines.filter(filled);
  if (!used.length) problems.push("Add at least one service to the estimate, or untick it");
  for (const line of used) {
    const name = clean(line.description);
    const quantity = clean(line.quantity) === "" ? 1 : Number(line.quantity);
    if (!(quantity > 0)) problems.push(`${name}: quantity must be more than 0`);
    if (clean(line.unitPrice) && !(Number(line.unitPrice) >= 0)) problems.push(`${name}: the price is not a number`);
    if (line.location === 0 && !available.main) problems.push(`${name}: fill in the service address first`);
    if (line.location > available.locations) problems.push(`${name}: that location is not on the form`);
  }
  if (!appointmentIsBlank(appointment)) {
    const missing: string[] = [];
    if (!chicagoAppointmentStartsAt(appointment.date, appointment.time)) missing.push("a date and start time");
    if (!appointment.assignedUserId) missing.push("an estimator");
    if (missing.length) problems.push(`The estimate appointment still needs ${missing.join(" and ")}, or leave it all blank`);
  }
  return problems;
}

/** The `estimate` sent with the create request. */
export function buildEstimate(lines: readonly EstimateLineDraft[], appointment: EstimateAppointmentDraft, notes = "") {
  return {
    lines: lines.filter(filled).map((line) => ({
      serviceId: line.serviceId,
      description: clean(line.description),
      quantity: clean(line.quantity) === "" ? 1 : Number(line.quantity),
      // Blank is "to be quoted"; 0 is a price.
      unitPrice: clean(line.unitPrice) === "" ? null : Number(line.unitPrice),
      location: line.location,
      serviceNotes: clean(line.serviceNotes) || null,
    })),
    notes: clean(notes) || null,
    appointment: appointmentIsBlank(appointment) ? null : {
      startsAt: chicagoAppointmentStartsAt(appointment.date, appointment.time),
      durationMinutes: Number(appointment.duration),
      assignedUserId: appointment.assignedUserId,
      appointmentNotes: clean(appointment.appointmentNotes) || null,
    },
  };
}

/** Why "Save and email" is not offered yet, or null when it is. */
export function emailBlocker(lines: readonly EstimateLineDraft[], email: string): string | null {
  const used = lines.filter(filled);
  if (!used.length) return "Add a service first";
  const unpriced = used.filter((line) => !priced(line)).map((line) => clean(line.description));
  if (unpriced.length) return `To email it now, price ${unpriced.join(", ")}. Otherwise save, and email once priced.`;
  if (!clean(email)) return "Add an email address to send it to";
  return null;
}

/** The running total, counting only priced lines. */
export function estimateTotal(lines: readonly EstimateLineDraft[]): number {
  return lines.filter(filled).reduce((sum, line) => {
    const quantity = clean(line.quantity) === "" ? 1 : Number(line.quantity) || 0;
    return sum + quantity * (Number(line.unitPrice) || 0);
  }, 0);
}
