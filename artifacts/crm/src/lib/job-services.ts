/**
 * The services on a job, and the customer-facing description of each —
 * Kyle's correction note #31.
 *
 * He asked that every service line on a quote **and on the job it becomes**
 * carry a Description saying what the customer is receiving, and that it stay
 * separate from Job Notes and Tech / Crew Notes, which are internal and are
 * not for the customer.
 *
 * The quote half already worked: a line's Description is written on the quote
 * (his earlier #9) and the customer sees it on their estimate page. The job
 * half did not, for two reasons.
 *
 * **One, the job screen never showed the services at all.** A job keeps them
 * in `jobs.line_items`, a JSON string, and nothing read it.
 *
 * **Two, the same idea is spelled two different ways**, because two different
 * paths create jobs, and — worse — the word `description` means opposite
 * things on each:
 *
 * | Path | service name | customer-facing text |
 * |---|---|---|
 * | an accepted estimate converted | `description` | `serviceNotes` |
 * | a new customer's first job | `serviceName` | `description` |
 *
 * Renaming either one would rewrite history that is already stored, so this
 * reads both and gives the rest of the app one shape. `serviceName` is the
 * tell: where it exists, `description` is the customer's text; where it does
 * not, `description` is the name.
 */

export interface JobService {
  /** What the service is called. */
  name: string;
  /** What the customer is receiving, in words meant for them. May be empty. */
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

function readOne(raw: Record<string, unknown>): JobService | null {
  const serviceName = str(raw.serviceName);
  const description = str(raw.description);
  // Where a line names the service separately, `description` is the
  // customer's text. Where it does not, `description` is the name and the
  // customer's text arrived under `serviceNotes`.
  const name = serviceName || description;
  const customerText = serviceName ? description : str(raw.serviceNotes);
  if (!name && !customerText) return null;

  const quantity = num(raw.quantity);
  const unitPrice = num(raw.unitPrice);
  const stored = raw.totalPrice;
  return {
    name,
    description: customerText,
    quantity,
    unitPrice,
    // A legacy row may carry no total; quantity × price is the same number.
    totalPrice: stored == null ? quantity * unitPrice : num(stored),
  };
}

/**
 * The services on a job, from whatever `jobs.line_items` holds.
 *
 * It is a free-text column, so it can be null, empty, malformed, or an object
 * rather than an array. A job screen that throws because an old row is odd is
 * worse than one that shows no services, so anything unreadable yields none.
 */
export function jobServices(lineItems: unknown): JobService[] {
  let parsed: unknown = lineItems;
  if (typeof lineItems === "string") {
    const trimmed = lineItems.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map(readOne)
    .filter((service): service is JobService => service !== null);
}

/** Whether any service on this job has something written for the customer. */
export function hasCustomerDescriptions(services: readonly JobService[]): boolean {
  return services.some((service) => service.description.length > 0);
}
