import {
  findStrongDuplicateCandidatesFromCustomers,
  sanitizeConversionReason,
  type DuplicateCandidate,
  type DuplicateCustomerContact,
} from "./lead-duplicate-candidates.ts";

export interface CustomerCreateInput {
  fields: Record<string, unknown>;
  createSeparateAccount?: boolean;
  overrideReason?: string | null;
  existingCustomerId?: number | null;
  idempotencyKey?: string | null;
  /** Deliberately ignored by the core; candidate counts are never trusted. */
  clientCandidateCount?: number | null;
}

export type CustomerCreateAudit = {
  candidateCount: number;
  matchTypes: string[];
  reason: string;
};

export type CustomerCreateResult<Customer> =
  | { kind: "created"; customer: Customer; audit: CustomerCreateAudit | null }
  | { kind: "existing"; customer: Customer }
  | { kind: "replay"; customer: Customer };

export type CustomerCreateIdempotencyClaim =
  | { kind: "claimed"; key: string }
  | { kind: "replay"; customerId: number }
  | { kind: "conflict" }
  | { kind: "inProgress" };

export interface CustomerCreateAdapter<Customer extends { id: number }> {
  lockContactSignals(fields: Record<string, unknown>): Promise<void>;
  findStrongDuplicateCandidates(fields: Record<string, unknown>): Promise<DuplicateCandidate[]>;
  findCustomerById(id: number): Promise<Customer | null>;
  createCustomer(): Promise<Customer>;
  claimIdempotency?(key: string): Promise<CustomerCreateIdempotencyClaim>;
  completeIdempotency?(key: string, customerId: number): Promise<void>;
}

export class CustomerDuplicateResolutionError extends Error {
  readonly status = 409;
  readonly code = "duplicate_customer_resolution_required";
  readonly candidates: DuplicateCandidate[];

  constructor(
    candidates: DuplicateCandidate[],
    message = "Strong contact matches require an explicit account resolution",
  ) {
    super(message);
    this.candidates = candidates;
    this.name = "CustomerDuplicateResolutionError";
  }
}

export class CustomerExistingAccountError extends Error {
  readonly status = 409;
  readonly code = "customer_existing_account_invalid";

  constructor(message: string) {
    super(message);
    this.name = "CustomerExistingAccountError";
  }
}

export class CustomerCreateIdempotencyError extends Error {
  readonly status = 409;
  readonly code: "idempotency_conflict" | "idempotency_in_progress";

  constructor(code: "idempotency_conflict" | "idempotency_in_progress") {
    super(
      code === "idempotency_conflict"
        ? "This Idempotency-Key was already used with a different request"
        : "An identical request is already in progress",
    );
    this.name = "CustomerCreateIdempotencyError";
    this.code = code;
  }
}

export function customerCreateContactFields(fields: Record<string, unknown>): DuplicateCustomerContact {
  return {
    id: 0,
    firstName: String(fields.firstName ?? ""),
    lastName: String(fields.lastName ?? ""),
    companyName: typeof fields.companyName === "string" ? fields.companyName : null,
    email: typeof fields.email === "string" ? fields.email : null,
    phone: typeof fields.phone === "string" ? fields.phone : null,
    homePhone: typeof fields.homePhone === "string" ? fields.homePhone : null,
    workPhone: typeof fields.workPhone === "string" ? fields.workPhone : null,
    cellPhone: typeof fields.cellPhone === "string" ? fields.cellPhone : null,
    altPhone: typeof fields.altPhone === "string" ? fields.altPhone : null,
    alternatePhone: typeof fields.alternatePhone === "string" ? fields.alternatePhone : null,
  };
}

export async function createCustomerCore<Customer extends { id: number }>(
  input: CustomerCreateInput,
  adapter: CustomerCreateAdapter<Customer>,
): Promise<CustomerCreateResult<Customer>> {
  const idempotencyKey = input.idempotencyKey ?? null;

  if (idempotencyKey && adapter.claimIdempotency) {
    const claim = await adapter.claimIdempotency(idempotencyKey);
    if (claim.kind === "conflict") throw new CustomerCreateIdempotencyError("idempotency_conflict");
    if (claim.kind === "inProgress") throw new CustomerCreateIdempotencyError("idempotency_in_progress");
    if (claim.kind === "replay") {
      const existing = await adapter.findCustomerById(claim.customerId);
      if (!existing) throw new CustomerExistingAccountError("Idempotency record points to a missing customer");
      return { kind: "replay", customer: existing };
    }
  }

  await adapter.lockContactSignals(input.fields);
  const candidates = await adapter.findStrongDuplicateCandidates(input.fields);
  const selectedExistingId = typeof input.existingCustomerId === "number" && Number.isInteger(input.existingCustomerId)
    ? input.existingCustomerId
    : null;

  if (selectedExistingId !== null) {
    const selected = candidates.find((candidate) => candidate.id === selectedExistingId);
    if (!selected) {
      throw new CustomerExistingAccountError("Selected customer is not one of the current strong candidates");
    }
    if (["inactive", "archived"].includes(selected.lifecycleStatus)) {
      throw new CustomerExistingAccountError("Inactive or archived customers cannot be selected as an existing account");
    }
    const customer = await adapter.findCustomerById(selectedExistingId);
    if (!customer) throw new CustomerExistingAccountError("Selected customer was not found");
    if (idempotencyKey && adapter.completeIdempotency) {
      await adapter.completeIdempotency(idempotencyKey, customer.id);
    }
    return { kind: "existing", customer };
  }

  let audit: CustomerCreateAudit | null = null;
  if (candidates.length > 0) {
    const reason = sanitizeConversionReason(input.overrideReason);
    if (input.createSeparateAccount !== true || !reason) {
      throw new CustomerDuplicateResolutionError(candidates);
    }
    audit = {
      candidateCount: candidates.length,
      matchTypes: [...new Set(candidates.flatMap((candidate) => candidate.matchTypes))],
      reason,
    };
  }

  const customer = await adapter.createCustomer();
  if (idempotencyKey && adapter.completeIdempotency) {
    await adapter.completeIdempotency(idempotencyKey, customer.id);
  }
  return { kind: "created", customer, audit };
}

export function findCandidatesInMemory(
  fields: Record<string, unknown>,
  customers: DuplicateCustomerContact[],
): DuplicateCandidate[] {
  return findStrongDuplicateCandidatesFromCustomers(customerCreateContactFields(fields), customers);
}