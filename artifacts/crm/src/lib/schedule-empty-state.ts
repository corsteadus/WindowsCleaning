import { hasClientCapability, type CapabilityEnvelope } from "./rbac.ts";

export interface ScheduleEmptyStateCopy {
  title: string;
  description: string;
}

export function getScheduleEmptyStateCopy(
  envelope: CapabilityEnvelope | null | undefined,
): ScheduleEmptyStateCopy {
  const canCreateAndConvert = hasClientCapability(envelope, "schedule.manage")
    && hasClientCapability(envelope, "estimates.convert");

  return canCreateAndConvert
    ? {
        title: "No jobs this week",
        description: "Create jobs or convert quotes to schedule work.",
      }
    : {
        title: "No assigned jobs this week",
        description: "Scheduled work assigned to you will appear here.",
      };
}

export function getCustomersEmptyStateDescription(
  envelope: CapabilityEnvelope | null | undefined,
): string {
  return hasClientCapability(envelope, "customers.manage")
    ? "Add your first customer to get started."
    : "Customers connected to your assigned work will appear here.";
}

export function getPropertiesEmptyStateDescription(
  envelope: CapabilityEnvelope | null | undefined,
): string {
  return hasClientCapability(envelope, "properties.manage")
    ? "Try another filter or add a new service location."
    : "Service locations connected to your assigned work will appear here.";
}