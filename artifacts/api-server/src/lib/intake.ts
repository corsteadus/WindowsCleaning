/**
 * The Add Prospect / Add Customer intake — profile redesign piece B, Kyle's
 * Video 2 and his answers of 2026-10-21.
 *
 * What the old form could not say at creation, and the profile page can:
 * the six phones each with whose number it is, several emails each with a
 * person and a routing, up to three named job locations, and the marketing
 * source from the managed list. It travels as `intake` beside the ordinary
 * fields and is written in the same transaction as the customer, so a
 * profile is never half-created.
 *
 * The flat columns (homePhone, email, …) are derived from it here, before the
 * duplicate check, so that check — and everything else that reads them —
 * sees exactly what the channels hold.
 */

export const INTAKE_PHONE_SLOTS = ["Home", "Work", "Cell", "Cell 2", "Alt", "Fax"] as const;
export type IntakePhoneSlot = (typeof INTAKE_PHONE_SLOTS)[number];

const FLAT_PHONE: Record<IntakePhoneSlot, "homePhone" | "workPhone" | "cellPhone" | "altPhone" | "fax" | null> = {
  Home: "homePhone",
  Work: "workPhone",
  Cell: "cellPhone",
  "Cell 2": null,
  Alt: "altPhone",
  Fax: "fax",
};

/** Kyle: up to three at creation — the main one and two more. */
export const MAX_EXTRA_LOCATIONS = 2;
const PURPOSES = new Set(["general", "billing", "estimates"]);

export interface IntakePerson { key: string; firstName: string; lastName: string }
export interface IntakePhone { slot: IntakePhoneSlot; value: string; personKey: string | null }
export interface IntakeEmail { value: string; personKey: string | null; purposes: string[] }
export interface IntakeLocation { name: string; address: string; city: string; state: string; zip: string }

export interface IntakePlan {
  /** New people named as owners, one per distinct name. */
  people: IntakePerson[];
  phones: IntakePhone[];
  /** In order; the first is the account's main address. */
  emails: IntakeEmail[];
  locations: IntakeLocation[];
  marketingSource: string | null;
}

export class IntakeError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "IntakeError";
  }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const nameKey = (firstName: string, lastName: string) => `${firstName} ${lastName}`.toLowerCase().replace(/\s+/g, " ");

/**
 * Validate the intake, or return null when there is none. An owner that names
 * the account holder is the account holder, not a new person.
 */
export function parseIntake(
  raw: unknown,
  account: { firstName: string; lastName: string },
): IntakePlan | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new IntakeError("intake must be an object");
  const input = raw as Record<string, unknown>;
  const accountKey = nameKey(text(account.firstName), text(account.lastName));
  const people = new Map<string, IntakePerson>();

  const ownerOf = (owner: unknown, where: string): string | null => {
    if (owner == null) return null;
    if (typeof owner !== "object") throw new IntakeError(`${where}: owner must be a name`);
    const firstName = text((owner as Record<string, unknown>).firstName);
    const lastName = text((owner as Record<string, unknown>).lastName);
    if (!firstName && !lastName) return null;
    if (!firstName || !lastName) throw new IntakeError(`${where}: give the person's first and last name`);
    const key = nameKey(firstName, lastName);
    if (key === accountKey) return null;
    if (!people.has(key)) people.set(key, { key, firstName, lastName });
    return key;
  };

  const phones: IntakePhone[] = [];
  for (const item of Array.isArray(input.phones) ? input.phones : []) {
    const row = (item ?? {}) as Record<string, unknown>;
    const slot = INTAKE_PHONE_SLOTS.find((label) => label.toLowerCase() === text(row.slot).toLowerCase());
    if (!slot) throw new IntakeError(`Unknown phone "${text(row.slot)}"`);
    const value = text(row.value);
    if (!value) continue;
    if (phones.some((phone) => phone.slot === slot)) throw new IntakeError(`${slot} phone is given twice`);
    phones.push({ slot, value, personKey: ownerOf(row.owner, `${slot} phone`) });
  }

  const emails: IntakeEmail[] = [];
  for (const item of Array.isArray(input.emails) ? input.emails : []) {
    const row = (item ?? {}) as Record<string, unknown>;
    const value = text(row.value);
    if (!value) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new IntakeError(`"${value}" is not an email address`);
    if (emails.some((email) => email.value.toLowerCase() === value.toLowerCase())) continue;
    const purposes = Array.isArray(row.purposes)
      ? [...new Set(row.purposes.map((purpose) => text(purpose)).filter((purpose) => PURPOSES.has(purpose)))]
      : ["general"];
    emails.push({ value, personKey: ownerOf(row.owner, value), purposes });
  }

  const locations: IntakeLocation[] = [];
  for (const [index, item] of (Array.isArray(input.locations) ? input.locations : []).entries()) {
    const row = (item ?? {}) as Record<string, unknown>;
    const location = {
      name: text(row.name), address: text(row.address), city: text(row.city), state: text(row.state), zip: text(row.zip),
    };
    if (!location.address && !location.city && !location.state && !location.zip) continue;
    const missing = (["address", "city", "state", "zip"] as const).filter((key) => !location[key]);
    if (missing.length) {
      throw new IntakeError(`${location.name || `Location ${index + 2}`} needs ${missing.map((key) => key === "address" ? "street" : key).join(", ")}`);
    }
    locations.push({ ...location, name: location.name || `Location ${locations.length + 2}` });
  }
  if (locations.length > MAX_EXTRA_LOCATIONS) {
    throw new IntakeError(`Up to ${MAX_EXTRA_LOCATIONS + 1} locations can be added at creation; add more from the profile`);
  }

  return { people: [...people.values()], phones, emails, locations, marketingSource: text(input.marketingSource) || null };
}

/**
 * The flat columns the rest of Corstead reads, as the intake decides them.
 * Every slot is written, so a phone typed into the old field and left out of
 * the intake cannot survive beside it.
 */
export function intakeFlatFields(plan: IntakePlan): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const slot of INTAKE_PHONE_SLOTS) {
    const flat = FLAT_PHONE[slot];
    if (flat) fields[flat] = plan.phones.find((phone) => phone.slot === slot)?.value ?? null;
  }
  fields.email = plan.emails[0]?.value ?? null;
  if (plan.marketingSource) fields.source = plan.marketingSource;
  return fields;
}

/**
 * The estimate booked on the same screen — piece B2, Kyle's Video 3. Each
 * line names its location by position: 0 is the main address, 1 and 2 the
 * extra locations of the same intake, which do not exist until the profile
 * is written. A blank price is null, "to be quoted"; $0 is a price (Kyle,
 * 2026-10-24; lib/estimate-pricing.ts).
 */
export interface IntakeEstimateLine {
  serviceId: number | null;
  description: string;
  quantity: number;
  /** null while still to be quoted. */
  unitPrice: number | null;
  location: number;
  serviceNotes: string | null;
}

export interface IntakeEstimate {
  lines: IntakeEstimateLine[];
  notes: string | null;
  /** Passed to the quote appointment rules once the locations are known. */
  appointment: Record<string, unknown> | null;
}

export function parseIntakeEstimate(
  raw: unknown,
  available: { main: boolean; extraLocations: number },
): IntakeEstimate | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new IntakeError("estimate must be an object");
  const input = raw as Record<string, unknown>;
  const lines: IntakeEstimateLine[] = [];
  for (const item of Array.isArray(input.lines) ? input.lines : []) {
    const row = (item ?? {}) as Record<string, unknown>;
    const description = text(row.description);
    if (!description) continue;
    const quantity = row.quantity === "" || row.quantity == null ? 1 : Number(row.quantity);
    if (!(quantity > 0)) throw new IntakeError(`${description}: quantity must be more than 0`);
    const unitPrice = row.unitPrice === "" || row.unitPrice == null ? null : Number(row.unitPrice);
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) throw new IntakeError(`${description}: the price is not a number`);
    const location = row.location == null || row.location === "" ? 0 : Number(row.location);
    const exists = location === 0 ? available.main : Number.isInteger(location) && location >= 1 && location <= available.extraLocations;
    if (!exists) {
      throw new IntakeError(location === 0
        ? `${description}: add the service address first`
        : `${description}: that location is not on the form`);
    }
    const serviceId = Number(row.serviceId);
    lines.push({
      serviceId: Number.isInteger(serviceId) && serviceId > 0 ? serviceId : null,
      description, quantity, unitPrice, location,
      serviceNotes: text(row.serviceNotes) || null,
    });
  }
  if (!lines.length) throw new IntakeError("Add at least one service to the estimate");
  const appointment = input.appointment && typeof input.appointment === "object" && !Array.isArray(input.appointment)
    ? input.appointment as Record<string, unknown>
    : null;
  return { lines, notes: text(input.notes) || null, appointment };
}

/** The appointment's locations: every location a line is for, main first. */
export function estimateLocationIds(estimate: IntakeEstimate, propertyIds: readonly number[]): number[] {
  return [...new Set(estimate.lines.map((line) => line.location))].sort((a, b) => a - b).map((index) => propertyIds[index]);
}
