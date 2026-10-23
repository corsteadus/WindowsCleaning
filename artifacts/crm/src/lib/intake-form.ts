/**
 * The Add Prospect / Add Customer intake — profile redesign piece B (Kyle,
 * Video 2, answers of 2026-10-21). What the form collects beyond the plain
 * fields, and the `intake` it sends: the server writes it in the same
 * transaction as the profile (api-server lib/intake.ts).
 */
import { purposesForChoice } from "./channel-routing.ts";

export const INTAKE_PHONES = [
  { slot: "Home", field: "homePhone" },
  { slot: "Work", field: "workPhone" },
  { slot: "Cell", field: "cellPhone" },
  { slot: "Cell 2", field: null },
  { slot: "Alt", field: "altPhone" },
  { slot: "Fax", field: "fax" },
] as const;
export type IntakeSlot = (typeof INTAKE_PHONES)[number]["slot"];

/** Kyle: up to three locations at creation, the main one included. */
export const MAX_EXTRA_LOCATIONS = 2;

export type Owner =
  | { kind: "account" }
  /** isNew: the name is still being typed into this row. */
  | { kind: "person"; firstName: string; lastName: string; isNew?: boolean };

export const ACCOUNT_OWNER: Owner = { kind: "account" };

export interface IntakeEmailRow { key: string; value: string; owner: Owner; routing: string }
export interface IntakeLocationRow { key: string; name: string; address: string; city: string; state: string; zip: string }

export interface IntakeState {
  phones: Partial<Record<IntakeSlot, string>>;
  owners: Partial<Record<IntakeSlot, Owner>>;
  emails: readonly IntakeEmailRow[];
  locations: readonly IntakeLocationRow[];
  marketingSource: string;
}

const clean = (value: string | null | undefined) => (value ?? "").trim();
export const personKey = (firstName: string, lastName: string) =>
  `${clean(firstName)} ${clean(lastName)}`.toLowerCase().replace(/\s+/g, " ");

/**
 * Everyone already named somewhere on the form, once each, so the next phone
 * or email can pick "Lauren Atieh" instead of typing her again.
 */
export function namedPeople(owners: readonly Owner[]): { key: string; firstName: string; lastName: string }[] {
  const seen = new Map<string, { key: string; firstName: string; lastName: string }>();
  for (const owner of owners) {
    if (owner.kind !== "person" || !clean(owner.firstName) || !clean(owner.lastName)) continue;
    const key = personKey(owner.firstName, owner.lastName);
    if (!seen.has(key)) seen.set(key, { key, firstName: clean(owner.firstName), lastName: clean(owner.lastName) });
  }
  return [...seen.values()];
}

const ownerPayload = (owner: Owner) =>
  owner.kind === "person" ? { firstName: clean(owner.firstName), lastName: clean(owner.lastName) } : null;

const filled = (row: IntakeLocationRow) => [row.address, row.city, row.state, row.zip].some((part) => clean(part));

/** What stops the form from being sent, in words. */
export function intakeProblems(state: IntakeState): string[] {
  const problems: string[] = [];
  const halfNamed = (owner: Owner | undefined) =>
    owner?.kind === "person" && (!clean(owner.firstName) || !clean(owner.lastName));
  for (const { slot } of INTAKE_PHONES) {
    if (clean(state.phones[slot]) && halfNamed(state.owners[slot])) {
      problems.push(`${slot} phone: give the person's first and last name`);
    }
  }
  for (const email of state.emails) {
    if (clean(email.value) && halfNamed(email.owner)) {
      problems.push(`${clean(email.value)}: give the person's first and last name`);
    }
  }
  state.locations.forEach((row, index) => {
    if (!filled(row)) return;
    const missing = (["address", "city", "state", "zip"] as const)
      .filter((key) => !clean(row[key]))
      .map((key) => (key === "address" ? "street" : key));
    if (missing.length) problems.push(`${clean(row.name) || `Location ${index + 2}`} needs ${missing.join(", ")}`);
  });
  return problems;
}

/** The `intake` sent with the create request; blank rows are left out. */
export function buildIntake(state: IntakeState) {
  return {
    phones: INTAKE_PHONES
      .filter(({ slot }) => clean(state.phones[slot]))
      .map(({ slot }) => ({ slot, value: clean(state.phones[slot]), owner: ownerPayload(state.owners[slot] ?? ACCOUNT_OWNER) })),
    emails: state.emails
      .filter((email) => clean(email.value))
      .map((email) => ({ value: clean(email.value), owner: ownerPayload(email.owner), purposes: purposesForChoice(email.routing) })),
    locations: state.locations
      .filter(filled)
      .map((row) => ({ name: clean(row.name), address: clean(row.address), city: clean(row.city), state: clean(row.state), zip: clean(row.zip) })),
    marketingSource: clean(state.marketingSource) || null,
  };
}
