import { hasClientCapability, type CapabilityEnvelope } from "./rbac.ts";

export function isAppendOnlyJobNotes(envelope: CapabilityEnvelope | null | undefined): boolean {
  return hasClientCapability(envelope, "jobs.manage")
    && !hasClientCapability(envelope, "schedule.manage");
}

export type JobNotesPayload = { notes?: string; techNotes?: string };

export function buildJobNotesPayload({
  appendOnly,
  notesDraft,
  techNotesDraft,
  existingNotes,
  existingTechNotes,
}: {
  appendOnly: boolean;
  notesDraft: string | null;
  techNotesDraft: string | null;
  existingNotes: string | null | undefined;
  existingTechNotes: string | null | undefined;
}): JobNotesPayload {
  if (!appendOnly) {
    return {
      notes: notesDraft ?? existingNotes ?? "",
      techNotes: techNotesDraft ?? existingTechNotes ?? "",
    };
  }
  const payload: JobNotesPayload = {};
  if (notesDraft?.trim()) payload.notes = notesDraft;
  if (techNotesDraft?.trim()) payload.techNotes = techNotesDraft;
  return payload;
}

export function hasJobNotesChanges(
  appendOnly: boolean,
  notesDraft: string | null,
  techNotesDraft: string | null,
  existingNotes: string | null | undefined,
  existingTechNotes: string | null | undefined,
): boolean {
  return appendOnly
    ? Boolean(notesDraft?.trim() || techNotesDraft?.trim())
    : (notesDraft !== null && notesDraft !== (existingNotes ?? ""))
      || (techNotesDraft !== null && techNotesDraft !== (existingTechNotes ?? ""));
}