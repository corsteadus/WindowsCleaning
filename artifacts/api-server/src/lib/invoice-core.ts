const QUANTITY_SCALE = 10_000n;

function parseMoneyCents(value: string | number): bigint {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new InvoiceValidationError("invalid_amount", "Money amounts must be non-negative decimals with at most two decimal places");
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function formatMoneyCents(cents: bigint): string {
  if (cents < 0n) throw new InvoiceValidationError("negative_amount", "Money amounts cannot be negative");
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export type InvoiceLineInput = {
  jobId?: number | null;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  discountAmount?: string | number | null;
  taxAmount?: string | number | null;
};

export type InvoiceJobRow = {
  id: number;
  customerId: number;
  jobNumber: string;
  propertyId: number | null;
  scheduledDate: string | null;
  totalAmount: string;
  status: string;
};

export type InvoiceLineSnapshot = {
  jobId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
  lineTotal: string;
  sortOrder: number;
};

export type InvoiceCreateInput = {
  customerId: number;
  propertyId?: number | null;
  jobIds?: number[];
  lines: InvoiceLineInput[];
  status?: string;
  dueDate?: string | null;
  notes?: string | null;
  amountPaid?: string | number;
  invoiceNumber?: string;
};

export type InvoiceInsertValues = {
  customerId: number;
  jobId: number | null;
  propertyId: number | null;
  invoiceNumber: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  dueDate: string | null;
  notes: string | null;
  lineItems: string | null;
};

export type InvoiceRow = {
  id: number;
  customerId: number;
  jobId: number | null;
  invoiceNumber: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export interface InvoiceCreateAdapter {
  acquireJobLocks(jobIds: number[]): Promise<void>;
  findJobsByIds(jobIds: number[]): Promise<InvoiceJobRow[]>;
  insertInvoice(values: InvoiceInsertValues): Promise<InvoiceRow>;
  insertInvoiceJob(values: { invoiceId: number; jobId: number }): Promise<void>;
  insertInvoiceLine(values: {
    invoiceId: number;
    jobId: number | null;
    description: string;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    taxAmount: string;
    lineTotal: string;
    sortOrder: number;
  }): Promise<void>;
}

export class InvoiceValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InvoiceValidationError";
    this.code = code;
  }
}

function parseQuantity(value: string | number): bigint {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) {
    throw new InvoiceValidationError("invalid_quantity", "Quantities must be non-negative decimals with at most four decimal places");
  }
  const [whole, fraction = ""] = raw.split(".");
  const quantity = BigInt(whole) * QUANTITY_SCALE + BigInt((fraction + "0000").slice(0, 4));
  if (quantity <= 0n) {
    throw new InvoiceValidationError("quantity_must_be_positive", "Line quantities must be greater than zero");
  }
  return quantity;
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function parseOptionalMoney(value: string | number | null | undefined): bigint {
  return value == null || value === "" ? 0n : parseMoneyCents(value);
}

function calculateLine(input: InvoiceLineInput, sortOrder: number): {
  snapshot: InvoiceLineSnapshot;
  subtotalCents: bigint;
  taxCents: bigint;
} {
  const description = input.description.trim();
  if (!description) {
    throw new InvoiceValidationError("invalid_description", "Every invoice line needs a description");
  }
  const quantity = parseQuantity(input.quantity);
  const unitPrice = parseMoneyCents(input.unitPrice);
  const discount = parseOptionalMoney(input.discountAmount);
  const tax = parseOptionalMoney(input.taxAmount);
  const gross = roundHalfUp(quantity * unitPrice, QUANTITY_SCALE);
  if (discount > gross) {
    throw new InvoiceValidationError("discount_exceeds_line", `Discount exceeds the line amount for "${description}"`);
  }
  const subtotal = gross - discount;
  const lineTotal = subtotal + tax;
  const jobId = input.jobId == null ? null : input.jobId;
  if (lineTotal < 0n) {
    throw new InvoiceValidationError("negative_line_total", `Line "${description}" cannot have a negative total`);
  }
  return {
    snapshot: {
      jobId,
      description,
      quantity: `${quantity / QUANTITY_SCALE}.${(quantity % QUANTITY_SCALE).toString().padStart(4, "0").replace(/0+$/, "") || "0"}`,
      unitPrice: formatMoneyCents(unitPrice),
      discountAmount: formatMoneyCents(discount),
      taxAmount: formatMoneyCents(tax),
      lineTotal: formatMoneyCents(lineTotal),
      sortOrder,
    },
    subtotalCents: subtotal,
    taxCents: tax,
  };
}

export function calculateInvoiceLines(lines: InvoiceLineInput[]): {
  snapshots: InvoiceLineSnapshot[];
  subtotalCents: bigint;
  taxCents: bigint;
  totalCents: bigint;
} {
  if (!lines.length) {
    throw new InvoiceValidationError("lines_required", "At least one invoice line is required");
  }
  let subtotalCents = 0n;
  let taxCents = 0n;
  const snapshots = lines.map((line, index) => {
    const calculated = calculateLine(line, index);
    subtotalCents += calculated.subtotalCents;
    taxCents += calculated.taxCents;
    return calculated.snapshot;
  });
  return {
    snapshots,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

export async function createInvoiceCore(
  input: InvoiceCreateInput,
  adapter: InvoiceCreateAdapter,
  now: Date = new Date(),
): Promise<{ invoice: InvoiceRow; jobs: InvoiceJobRow[]; lines: InvoiceLineSnapshot[] }> {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) {
    throw new InvoiceValidationError("invalid_customer_id", "A valid customer is required");
  }

  const requestedJobIds = input.jobIds ?? [];
  const seenJobIds = new Set<number>();
  for (const jobId of requestedJobIds) {
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new InvoiceValidationError("invalid_job_id", "Each linked job must be valid");
    }
    if (seenJobIds.has(jobId)) {
      throw new InvoiceValidationError("duplicate_job", "A job may be linked only once per invoice");
    }
    seenJobIds.add(jobId);
  }

  const calculated = calculateInvoiceLines(input.lines);
  for (const line of calculated.snapshots) {
    if (line.jobId != null) {
      if (!Number.isInteger(line.jobId) || line.jobId <= 0) {
        throw new InvoiceValidationError("invalid_job_id", "Each line job must be valid");
      }
      seenJobIds.add(line.jobId);
    }
  }
  const jobIds = [...seenJobIds].sort((a, b) => a - b);
  await adapter.acquireJobLocks(jobIds);
  const jobs = await adapter.findJobsByIds(jobIds);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  for (const jobId of jobIds) {
    const job = jobsById.get(jobId);
    if (!job) throw new InvoiceValidationError("job_not_found", `Job #${jobId} was not found`);
    if (job.customerId !== input.customerId) {
      throw new InvoiceValidationError("customer_mismatch", "Every invoice job must belong to the selected customer");
    }
  }

  const amountPaidCents = parseOptionalMoney(input.amountPaid);
  const totalCents = calculated.totalCents;
  if (amountPaidCents > totalCents) {
    throw new InvoiceValidationError("amount_paid_exceeds_total", "Amount paid cannot exceed the invoice total");
  }
  const balanceCents = totalCents - amountPaidCents;
  const invoice = await adapter.insertInvoice({
    customerId: input.customerId,
    jobId: jobIds.length === 1 ? jobIds[0] : null,
    propertyId: input.propertyId ?? null,
    invoiceNumber: input.invoiceNumber ?? `INV-${now.getTime()}`,
    status: input.status ?? (balanceCents === 0n ? "paid" : "draft"),
    subtotal: formatMoneyCents(calculated.subtotalCents),
    taxAmount: formatMoneyCents(calculated.taxCents),
    totalAmount: formatMoneyCents(totalCents),
    amountPaid: formatMoneyCents(amountPaidCents),
    balanceDue: formatMoneyCents(balanceCents),
    dueDate: input.dueDate ?? null,
    notes: input.notes?.trim() || null,
    lineItems: null,
  });
  for (const jobId of jobIds) {
    await adapter.insertInvoiceJob({ invoiceId: invoice.id, jobId });
  }
  for (const line of calculated.snapshots) {
    await adapter.insertInvoiceLine({
      invoiceId: invoice.id,
      ...line,
    });
  }
  return { invoice, jobs, lines: calculated.snapshots };
}

export function invoiceLineFromLegacyItem(
  item: Record<string, unknown>,
  fallbackJobId: number | null,
): InvoiceLineInput {
  return {
    jobId: item.jobId == null ? fallbackJobId : Number(item.jobId),
    description: String(item.description ?? item.name ?? "Service"),
    quantity: String(item.quantity ?? 1),
    unitPrice: String(item.unitPrice ?? item.rate ?? item.price ?? item.totalPrice ?? item.amount ?? 0),
    discountAmount: item.discountAmount == null ? null : String(item.discountAmount),
    taxAmount: item.taxAmount == null ? null : String(item.taxAmount),
  };
}

export function normalizeLegacyInvoiceLines(
  value: unknown,
  fallbackJobId: number | null,
  fallbackAmount: string | number,
): InvoiceLineInput[] {
  if (Array.isArray(value)) {
    return value.map((item) => invoiceLineFromLegacyItem(item as Record<string, unknown>, fallbackJobId));
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => invoiceLineFromLegacyItem(item as Record<string, unknown>, fallbackJobId));
      }
    } catch {
      // Preserve the legacy field as a general line below.
    }
  }
  return [{
    jobId: fallbackJobId,
    description: fallbackJobId == null ? "Invoice line" : "Job services",
    quantity: 1,
    unitPrice: fallbackAmount,
  }];
}