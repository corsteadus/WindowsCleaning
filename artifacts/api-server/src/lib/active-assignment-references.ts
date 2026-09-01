export class ActiveAssignmentReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActiveAssignmentReferenceError";
  }
}

export interface ActiveAssignmentReferenceLockAdapter {
  lockActiveCrews(ids: readonly number[]): Promise<readonly number[]>;
  lockActiveFieldTechUsers(ids: readonly string[]): Promise<readonly string[]>;
}

/**
 * Shared job-production boundary contract. The adapter must issue locking reads
 * in the same transaction that will insert the job.
 */
export async function validateAndLockActiveAssignmentReferences(
  references: {
    crewIds?: readonly (number | null | undefined)[];
    directUserIds?: readonly (string | null | undefined)[];
  },
  adapter: ActiveAssignmentReferenceLockAdapter,
): Promise<void> {
  const rawCrewIds = (references.crewIds ?? []).filter((id): id is number => id !== null && id !== undefined);
  if (rawCrewIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new ActiveAssignmentReferenceError("Crew assignment must be a positive integer");
  }
  const crewIds = [...new Set(rawCrewIds)];

  const rawUserIds = (references.directUserIds ?? []).filter((id): id is string => id !== null && id !== undefined);
  if (rawUserIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new ActiveAssignmentReferenceError("Direct assignee must be a non-empty user id");
  }
  const userIds = [...new Set(rawUserIds)];

  const lockedCrews = crewIds.length ? await adapter.lockActiveCrews(crewIds) : [];
  if (new Set(lockedCrews).size !== crewIds.length || crewIds.some((id) => !lockedCrews.includes(id))) {
    throw new ActiveAssignmentReferenceError("Every selected crew must exist and be active");
  }
  const lockedUsers = userIds.length ? await adapter.lockActiveFieldTechUsers(userIds) : [];
  if (new Set(lockedUsers).size !== userIds.length || userIds.some((id) => !lockedUsers.includes(id))) {
    throw new ActiveAssignmentReferenceError("Every direct assignee must exist, be active, and be a field tech");
  }
}