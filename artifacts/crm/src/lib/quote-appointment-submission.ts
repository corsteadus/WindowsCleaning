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

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

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

  // Name what is actually wrong. The old message listed all five requirements
  // at once, which told nobody which field to fix.
  const missing: string[] = [];
  if (!startsAt) missing.push("a valid date and start time");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
    missing.push("a duration between 15 minutes and 24 hours");
  }
  if (!technicianIsSelectable) missing.push("an active Field or Team Technician");
  if (!hasAppointmentLocation(propertyIds)) missing.push("a customer location");
  else if (!locationsAreActiveAndOwned) missing.push("locations that belong to this customer and are still active");

  // `!startsAt` is already in `missing`; repeating it here is what narrows it
  // to a string for the request below.
  if (missing.length || !startsAt) {
    return {
      kind: "invalid",
      message: `The estimate appointment still needs ${joinPhrases(missing)}. `
        + "Leave every appointment field blank to save the quote without an appointment.",
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