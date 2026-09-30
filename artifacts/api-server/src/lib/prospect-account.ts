export function canonicalProspectCreateBody(
  body: Record<string, unknown> | null | undefined,
  prospectDate: string,
): Record<string, unknown> {
  return {
    ...(body ?? {}),
    status: "prospect",
    lifecycleStatus: "prospect",
    prospectDate: typeof body?.prospectDate === "string" && body.prospectDate.trim()
      ? body.prospectDate
      : prospectDate,
  };
}

export function prospectLifecycleTransition(
  isProspectRoute: boolean,
  fromLifecycle: string,
  toLifecycle: string,
  conversionDate: string,
): { customerDate?: string; action: string } {
  if (isProspectRoute && fromLifecycle === "prospect" && toLifecycle === "customer") {
    return { customerDate: conversionDate, action: "prospect_converted" };
  }
  // Kyle A#21: archiving and deactivating are different acts, and the history
  // has to say which one happened.
  if (toLifecycle === "archived") return { action: "archived" };
  if (toLifecycle === "inactive") return { action: "deactivated" };
  return { action: "reactivated" };
}