export type CustomerDuplicateState = "idle" | "checking" | "none" | "candidates" | "error";
export type CustomerDuplicateDecision = "existing" | "separate" | null;

export function hasSeparateAccountReason(reason: string): boolean {
  return reason.trim().length > 0;
}

export function shouldDisableCustomerCreate(
  isPending: boolean,
  duplicateState: CustomerDuplicateState,
  duplicateDecision: CustomerDuplicateDecision,
  duplicateReason: string,
): boolean {
  if (
    isPending
    || duplicateState === "checking"
    || duplicateState === "idle"
    || duplicateState === "error"
  ) {
    return true;
  }
  return duplicateState === "candidates"
    && (
      duplicateDecision !== "separate"
      || !hasSeparateAccountReason(duplicateReason)
    );
}