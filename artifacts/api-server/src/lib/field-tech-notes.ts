/**
 * Field technicians may add an operational note, but never erase or replace
 * the office record. Callers must reject blank input before invoking this.
 */
export function appendFieldTechNote(existing: string | null | undefined, addition: string): string {
  const trimmed = addition.trim();
  if (!trimmed) throw new Error("Field technician notes must contain text");
  return [existing?.trim(), trimmed].filter(Boolean).join("\n");
}