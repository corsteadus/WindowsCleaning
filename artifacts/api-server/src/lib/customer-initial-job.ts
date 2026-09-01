import { isDateOnly, isTimeOnly } from "./date.ts";

export interface InitialJobServiceSnapshotInput {
  serviceId: number;
  serviceName: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface InitialJobInput {
  accepted: true;
  scheduledDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  crewId: number;
  employeeIds: string[];
  notes?: string | null;
  serviceSnapshot: InitialJobServiceSnapshotInput[];
}

export class CustomerInitialJobValidationError extends Error {
  readonly status = 400;
  readonly code = "invalid_initial_job";
}

export function normalizeInitialJob(value: unknown): InitialJobInput {
  const input = value as Partial<InitialJobInput> | null;
  if (!input || input.accepted !== true) {
    throw new CustomerInitialJobValidationError("The initial job must be explicitly accepted");
  }
  if (!isDateOnly(input.scheduledDate)) {
    throw new CustomerInitialJobValidationError("A valid scheduled date is required");
  }
  if (!isTimeOnly(input.scheduledStartTime) || !isTimeOnly(input.scheduledEndTime)) {
    throw new CustomerInitialJobValidationError("Valid start and end times are required");
  }
  if (input.scheduledEndTime! <= input.scheduledStartTime!) {
    throw new CustomerInitialJobValidationError("The scheduled end time must be after the start time");
  }
  const crewId = Number(input.crewId);
  if (!Number.isInteger(crewId) || crewId <= 0) {
    throw new CustomerInitialJobValidationError("An active crew is required");
  }
  const employeeIds = Array.isArray(input.employeeIds)
    ? [...new Set(input.employeeIds.map(String).map((id) => id.trim()).filter(Boolean))]
    : [];
  if (!employeeIds.length) {
    throw new CustomerInitialJobValidationError("At least one active employee is required");
  }
  if (!Array.isArray(input.serviceSnapshot) || !input.serviceSnapshot.length) {
    throw new CustomerInitialJobValidationError("At least one accepted service snapshot is required");
  }
  const serviceSnapshot = input.serviceSnapshot.map((line) => {
    const serviceId = Number(line?.serviceId);
    const quantity = Number(line?.quantity);
    const unitPrice = Number(line?.unitPrice);
    const totalPrice = Number(line?.totalPrice);
    const serviceName = String(line?.serviceName ?? "").trim();
    if (!Number.isInteger(serviceId) || serviceId <= 0 || !serviceName || !(quantity > 0)
      || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(totalPrice) || totalPrice < 0) {
      throw new CustomerInitialJobValidationError("Every service snapshot needs a service, name, quantity, unit price, and total");
    }
    if (Math.abs(totalPrice - quantity * unitPrice) > 0.01) {
      throw new CustomerInitialJobValidationError("Service snapshot totals must equal quantity times unit price");
    }
    return {
      serviceId,
      serviceName,
      description: line.description == null ? null : String(line.description),
      quantity,
      unitPrice,
      totalPrice,
    };
  });
  return {
    accepted: true,
    scheduledDate: input.scheduledDate!,
    scheduledStartTime: input.scheduledStartTime!,
    scheduledEndTime: input.scheduledEndTime!,
    crewId,
    employeeIds,
    notes: input.notes == null ? null : String(input.notes),
    serviceSnapshot,
  };
}

export function initialJobSnapshot(input: InitialJobInput, property: {
  id: number; name: string | null; address: string; city: string; state: string; zip: string;
}) {
  return input.serviceSnapshot.map((line) => ({
    ...line,
    description: line.description || line.serviceName,
    assignedUserIds: input.employeeIds,
    propertyId: property.id,
    accepted: true,
    locationSnapshot: {
      id: property.id,
      name: property.name,
      address: property.address,
      city: property.city,
      state: property.state,
      zip: property.zip,
    },
  }));
}

export function initialJobIdempotencyResourceType(jobId: number): string {
  if (!Number.isInteger(jobId) || jobId <= 0) throw new Error("Initial job id must be a positive integer");
  return `customer_initial_job:job:${jobId}`;
}

export function initialJobIdFromResourceType(resourceType: string | null | undefined): number {
  const match = /^customer_initial_job:job:(\d+)$/.exec(resourceType ?? "");
  const jobId = match ? Number(match[1]) : 0;
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error("Idempotency metadata is missing the exact initial job identity");
  }
  return jobId;
}

export function assertActiveInitialJobReferences(
  input: InitialJobInput,
  references: { crewActive: boolean; activeEmployeeIds: string[]; activeServices: Array<{ id: number; name: string }> },
): void {
  if (!references.crewActive) throw new CustomerInitialJobValidationError("The selected crew is not active");
  const activeEmployeeIds = new Set(references.activeEmployeeIds);
  if (input.employeeIds.some((id) => !activeEmployeeIds.has(id))) {
    throw new CustomerInitialJobValidationError("Every assigned employee must be active");
  }
  const activeServices = new Map(references.activeServices.map((service) => [service.id, service.name]));
  if (input.serviceSnapshot.some((line) => activeServices.get(line.serviceId) !== line.serviceName)) {
    throw new CustomerInitialJobValidationError("Every accepted service snapshot must match an active catalog service");
  }
}

export function duplicateOverrideActivity(audit: { candidateCount: number; matchTypes: string[]; reason: string }) {
  return {
    action: "customer_duplicate_override",
    toValue: JSON.stringify({ candidateCount: audit.candidateCount, matchTypes: audit.matchTypes }),
    note: `Separate account created after strong contact match review. Reason: ${audit.reason}`,
  };
}