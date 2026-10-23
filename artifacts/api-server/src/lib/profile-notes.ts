/**
 * Dated, signed notes — profile redesign piece C. The rules the route applies
 * (lib/db schema/profile_notes.ts holds the table).
 */
export const NOTE_KINDS = ["specific", "callback"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** Long enough for a real note, short enough that a paste of a whole email is refused. */
export const MAX_NOTE_LENGTH = 4000;

export function noteKindOf(value: unknown): NoteKind | null {
  return NOTE_KINDS.find((kind) => kind === value) ?? null;
}

/** The note as it will be stored, or why it cannot be. */
export function noteBodyOf(value: unknown): { body: string } | { error: string } {
  const body = typeof value === "string" ? value.trim() : "";
  if (!body) return { error: "Write the note first" };
  if (body.length > MAX_NOTE_LENGTH) return { error: `A note can be up to ${MAX_NOTE_LENGTH} characters` };
  return { body };
}

export interface NoteRow {
  id: number;
  kind: string;
  body: string;
  createdAt: Date;
  createdBy: string | null;
  carriedOver: boolean;
}

/** Newest first, as Kyle reads a callback log; the carried-over text last. */
export function serializeNotes(rows: readonly NoteRow[]) {
  return [...rows]
    .sort((a, b) => Number(a.carriedOver) - Number(b.carriedOver) || b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      // The text from before dated notes was never signed.
      createdBy: row.carriedOver ? null : row.createdBy,
      carriedOver: row.carriedOver,
    }));
}
