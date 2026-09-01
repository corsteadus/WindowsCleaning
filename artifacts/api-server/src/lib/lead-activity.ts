export function leadNoteActivityValues(
  leadId: number,
  note: string,
  performedBy: string | null,
) {
  return {
    entityType: "lead" as const,
    entityId: leadId,
    action: "note_added",
    note: note.trim(),
    performedBy,
  };
}

/**
 * Notes deliberately do not appear here. The legacy leads.notes column is
 * read-only history; all new note text is appended as lead activity instead.
 */
export function leadPatchValues(body: Record<string, unknown>): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  const fields = [
    "firstName", "lastName", "email", "phone", "source", "status",
    "address", "city", "state", "zip", "estimatedValue", "followUpDate",
    "assignedTo", "lostReason", "clientType", "accountType",
  ];
  for (const field of fields) {
    if (body[field] !== undefined) updateData[field] = body[field];
  }
  return updateData;
}