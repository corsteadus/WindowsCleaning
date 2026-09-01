import { sql, type SQL } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";
import { customerLifecycleStatus, normalizeAccountType } from "./account-lifecycle.ts";

export type StrongMatchType = "email" | "phone";

export interface DuplicateCandidate {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string | null;
  lifecycleStatus: ReturnType<typeof customerLifecycleStatus>;
  accountType: ReturnType<typeof normalizeAccountType>;
  matchTypes: StrongMatchType[];
}

export interface DuplicateLeadContact {
  email: string | null;
  phone: string | null;
}

export interface DuplicateCustomerContactInput {
  email?: string | null;
  phone?: string | null;
  homePhone?: string | null;
  workPhone?: string | null;
  cellPhone?: string | null;
  altPhone?: string | null;
  alternatePhone?: string | null;
}

export interface DuplicateCustomerContact extends DuplicateLeadContact {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string | null;
  status?: string | null;
  lifecycleStatus?: string | null;
  homePhone?: string | null;
  workPhone?: string | null;
  cellPhone?: string | null;
  altPhone?: string | null;
  alternatePhone?: string | null;
  clientType?: string | null;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

export function normalizePhone(value: string | null | undefined): string | null {
  const normalized = value ? value.replace(/\D/g, "") : "";
  return normalized.length >= 7 ? normalized : null;
}

function customerPhoneValues(customer: DuplicateCustomerContact): Array<string | null | undefined> {
  return [
    customer.phone,
    customer.homePhone,
    customer.workPhone,
    customer.cellPhone,
    customer.altPhone,
    customer.alternatePhone,
  ];
}

function inputPhoneValues(input: DuplicateLeadContact | DuplicateCustomerContactInput): Array<string | null | undefined> {
  return [
    input.phone,
    "homePhone" in input ? input.homePhone : null,
    "workPhone" in input ? input.workPhone : null,
    "cellPhone" in input ? input.cellPhone : null,
    "altPhone" in input ? input.altPhone : null,
    "alternatePhone" in input ? input.alternatePhone : null,
  ];
}

export function findStrongDuplicateCandidatesFromCustomers(
  lead: DuplicateLeadContact | DuplicateCustomerContactInput,
  customers: DuplicateCustomerContact[],
): DuplicateCandidate[] {
  const leadEmail = normalizeEmail(lead.email);
  const leadPhones = new Set(
    inputPhoneValues(lead)
      .map(normalizePhone)
      .filter((phone): phone is string => Boolean(phone)),
  );

  return customers.flatMap((customer) => {
    const matchTypes: StrongMatchType[] = [];
    if (leadEmail && normalizeEmail(customer.email) === leadEmail) {
      matchTypes.push("email");
    }
    if (
      leadPhones.size > 0
      && customerPhoneValues(customer).some((phone) => {
        const normalized = normalizePhone(phone);
        return normalized !== null && leadPhones.has(normalized);
      })
    ) {
      matchTypes.push("phone");
    }
    if (matchTypes.length === 0) return [];

    return [{
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: customer.companyName ?? null,
      lifecycleStatus: customerLifecycleStatus(customer),
      accountType: normalizeAccountType(customer.clientType),
      matchTypes,
    }];
  });
}

type LeadDuplicateQueryExecutor = Pick<typeof db, "select">;

export async function findStrongDuplicateCandidates(
  executor: LeadDuplicateQueryExecutor,
  lead: DuplicateLeadContact,
): Promise<DuplicateCandidate[]> {
  return findStrongDuplicateCandidatesForContact(executor, lead);
}

export async function findStrongDuplicateCandidatesForCustomer(
  executor: LeadDuplicateQueryExecutor,
  customer: DuplicateCustomerContactInput,
): Promise<DuplicateCandidate[]> {
  return findStrongDuplicateCandidatesForContact(executor, customer);
}

async function findStrongDuplicateCandidatesForContact(
  executor: LeadDuplicateQueryExecutor,
  contact: DuplicateLeadContact | DuplicateCustomerContactInput,
): Promise<DuplicateCandidate[]> {
  const email = normalizeEmail(contact.email);
  const phones = Array.from(new Set(
    inputPhoneValues(contact)
      .map(normalizePhone)
      .filter((phone): phone is string => Boolean(phone)),
  ));
  const conditions: SQL[] = [];

  if (email) {
    conditions.push(sql`lower(trim(${customersTable.email})) = ${email}`);
  }
  for (const phone of phones) {
    for (const column of [
      customersTable.phone,
      customersTable.homePhone,
      customersTable.workPhone,
      customersTable.cellPhone,
      customersTable.altPhone,
      customersTable.alternatePhone,
    ]) {
      conditions.push(sql`regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g') = ${phone}`);
    }
  }
  if (conditions.length === 0) return [];

  const customers = await executor
    .select({
      id: customersTable.id,
      firstName: customersTable.firstName,
      lastName: customersTable.lastName,
      companyName: customersTable.companyName,
      email: customersTable.email,
      phone: customersTable.phone,
      homePhone: customersTable.homePhone,
      workPhone: customersTable.workPhone,
      cellPhone: customersTable.cellPhone,
      altPhone: customersTable.altPhone,
      alternatePhone: customersTable.alternatePhone,
      status: customersTable.status,
      lifecycleStatus: customersTable.lifecycleStatus,
      clientType: customersTable.clientType,
    })
    .from(customersTable)
    .where(sql.join(conditions, sql` OR `));

  return findStrongDuplicateCandidatesFromCustomers(contact, customers);
}

export function sanitizeConversionReason(value: string | null | undefined): string | null {
  const sanitized = (value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[phone]")
    .trim()
    .slice(0, 500);
  return sanitized || null;
}