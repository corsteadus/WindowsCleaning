import {
  chicagoAppointmentStartsAt,
  committedAppointmentMatches,
  hasAppointmentLocation,
  normalizedAppointmentPropertyIds,
} from "./chicago-time.ts";

export type QuoteAppointmentDraft = {
  date: string;
  time: string;
  duration: string;
  durationTouched: boolean;
  assignedUserId: string;
  propertyIds: number[];
  fallbackPropertyId: number | null;
  availablePropertyIds: number[];
  selectableTechnicianIds: string[];
  appointmentNotes: string;
  estimateNotes: string;
};

export type QuoteAppointmentRequest = {
  startsAt: string;
  durationMinutes: number;
  propertyIds: number[];
  assignedUserId: string;
  appointmentNotes: string | null;
  estimateNotes: string | null;
};

export type QuoteAppointmentPreparation =
  | { kind: "blank" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; request: QuoteAppointmentRequest };

type QuoteAppointmentFormData = Pick<FormData, "get" | "getAll">;

function formString(formData: QuoteAppointmentFormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function submittedQuoteAppointment(
  formData: QuoteAppointmentFormData,
  fallback: QuoteAppointmentDraft,
): QuoteAppointmentDraft {
  return {
    ...fallback,
    date: formString(formData, "appointmentDate"),
    time: formString(formData, "appointmentTime"),
    duration: formString(formData, "appointmentDuration"),
    durationTouched: formString(formData, "appointmentDurationTouched") === "true",
    assignedUserId: formString(formData, "assignedUserId") || "unassigned",
    propertyIds: normalizedAppointmentPropertyIds(
      formData.getAll("appointmentPropertyIds")
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
    fallbackPropertyId: Number(formString(formData, "appointmentFallbackPropertyId")) || null,
    appointmentNotes: formString(formData, "appointmentNotes"),
    estimateNotes: formString(formData, "estimateNotes"),
  };
}

export function captureAndRetainSubmittedQuoteAppointment(
  formData: QuoteAppointmentFormData,
  fallback: QuoteAppointmentDraft,
  retain: (draft: QuoteAppointmentDraft) => void,
): QuoteAppointmentDraft {
  const draft = submittedQuoteAppointment(formData, fallback);
  retain(draft);
  return draft;
}

export function prepareQuoteAppointment(
  draft: QuoteAppointmentDraft,
): QuoteAppointmentPreparation {
  const appointmentStarted = Boolean(
    draft.date
    || draft.time
    || draft.durationTouched
    || draft.propertyIds.length
    || draft.assignedUserId !== "unassigned"
    || draft.appointmentNotes.trim()
    || draft.estimateNotes.trim(),
  );
  if (!appointmentStarted) return { kind: "blank" };

  if (draft.selectableTechnicianIds.length === 0) {
    return {
      kind: "invalid",
      message: "No active Field or Team Technician is available. Leave every appointment field blank to create the quote without an appointment.",
    };
  }

  const startsAt = chicagoAppointmentStartsAt(draft.date, draft.time);
  const durationMinutes = Number(draft.duration);
  const propertyIds = normalizedAppointmentPropertyIds(
    draft.propertyIds.length
      ? draft.propertyIds
      : draft.fallbackPropertyId ? [draft.fallbackPropertyId] : [],
  );
  const availablePropertyIds = new Set(normalizedAppointmentPropertyIds(draft.availablePropertyIds));
  const locationsAreActiveAndOwned = propertyIds.every((id) => availablePropertyIds.has(id));
  const technicianIsSelectable = draft.assignedUserId !== "unassigned"
    && draft.selectableTechnicianIds.includes(draft.assignedUserId);

  if (
    !startsAt
    || !Number.isInteger(durationMinutes)
    || durationMinutes < 15
    || durationMinutes > 1440
    || !technicianIsSelectable
    || !hasAppointmentLocation(propertyIds)
    || !locationsAreActiveAndOwned
  ) {
    return {
      kind: "invalid",
      message: "Choose a valid Chicago date, time, duration, active Field or Team Technician, and active customer location.",
    };
  }

  return {
    kind: "ready",
    request: {
      startsAt,
      durationMinutes,
      propertyIds,
      assignedUserId: draft.assignedUserId,
      appointmentNotes: draft.appointmentNotes.trim() || null,
      estimateNotes: draft.estimateNotes.trim() || null,
    },
  };
}

export async function submitAndConfirmQuoteAppointment(input: {
  request: QuoteAppointmentRequest;
  submit: (request: QuoteAppointmentRequest) => Promise<unknown>;
  readback: () => Promise<unknown>;
}): Promise<boolean> {
  const committedResponse = await input.submit(input.request);
  if (!committedAppointmentMatches(input.request, committedResponse as any)) return false;

  const lifecycleAppointment = await input.readback();
  return committedAppointmentMatches(input.request, lifecycleAppointment as any);
}