export type CrewTeamUserOption = {
  id: string;
  role?: string | null;
  isActive?: boolean;
};

const FIELD_TECH_ROLE_ALIASES = new Set(["field_tech", "team_tech"]);

export function isSelectableCrewTechnician(
  user: CrewTeamUserOption,
): boolean {
  return user.isActive === true
    && typeof user.role === "string"
    && FIELD_TECH_ROLE_ALIASES.has(user.role);
}

export function filterSelectableCrewTechnicians<T extends CrewTeamUserOption>(
  users: readonly T[],
): T[] {
  return users.filter(isSelectableCrewTechnician);
}