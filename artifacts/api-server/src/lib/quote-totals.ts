/**
 * An estimate's money, written in one place — phase 5. Every change to an
 * estimate's lines or discounts ends here, so its subtotal, each discount's
 * dollars, its discount total, its sales tax and its total always agree
 * (lib/discounts.ts, lib/sales-tax.ts).
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { customerDiscountsTable, customersTable, db, quoteDiscountsTable, quoteLineItemsTable, quotesTable, servicesTable, taxRatesTable } from "@workspace/db";
import { applyDiscounts, type DiscountInput } from "./discounts.ts";
import { combinedRate, salesTax } from "./sales-tax.ts";

type DrizzleTX = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function readQuoteDiscounts(tx: DrizzleTX | typeof db, quoteId: number) {
  return tx.select().from(quoteDiscountsTable)
    .where(eq(quoteDiscountsTable.quoteId, quoteId))
    .orderBy(asc(quoteDiscountsTable.sortOrder), asc(quoteDiscountsTable.id));
}

/** The estimate's discounts as shown and as frozen into a revision. */
export const serializeDiscounts = (rows: Awaited<ReturnType<typeof readQuoteDiscounts>>) => rows.map((row) => ({
  id: row.id, name: row.name, kind: row.kind as DiscountInput["kind"], value: Number(row.value), amount: Number(row.amount),
  customerDiscountId: row.customerDiscountId,
}));

/** Recalculates and writes the estimate's totals from its lines and discounts. */
export async function writeQuoteTotalsTx(tx: DrizzleTX, quoteId: number) {
  const lines = await tx.select({ totalPrice: quoteLineItemsTable.totalPrice, taxable: quoteLineItemsTable.taxable }).from(quoteLineItemsTable)
    .where(eq(quoteLineItemsTable.quoteId, quoteId));
  const [quote] = await tx.select({ taxRate: quotesTable.taxRate, taxExempt: customersTable.taxExempt }).from(quotesTable)
    .leftJoin(customersTable, eq(customersTable.id, quotesTable.customerId)).where(eq(quotesTable.id, quoteId));
  const discounts = await readQuoteDiscounts(tx, quoteId);
  const subtotal = lines.reduce((sum, line) => sum + Math.round(Number(line.totalPrice) * 100), 0) / 100;
  const result = applyDiscounts(subtotal, discounts.map((row) => ({ name: row.name, kind: row.kind as DiscountInput["kind"], value: Number(row.value) })));
  for (const [i, row] of discounts.entries()) {
    if (Number(row.amount) !== result.discounts[i].amount) {
      await tx.update(quoteDiscountsTable).set({ amount: String(result.discounts[i].amount) }).where(eq(quoteDiscountsTable.id, row.id));
    }
  }
  // Phase 6: on the amount after discounts, taxable lines only; never for a Tax Exempt customer.
  const rate = quote?.taxExempt ? null : quote?.taxRate == null ? null : Number(quote.taxRate);
  const tax = salesTax(lines.map((line) => ({ totalPrice: Number(line.totalPrice), taxable: line.taxable })), result.discountTotal, rate);
  const total = (Math.round(result.total * 100) + Math.round(tax.tax * 100)) / 100;
  await tx.update(quotesTable).set({
    subtotal: String(result.subtotal), discountTotal: String(result.discountTotal), taxTotal: String(tax.tax), totalAmount: String(total),
  }).where(eq(quotesTable.id, quoteId));
  return { ...result, tax: tax.tax, taxableBase: tax.taxableBase, total };
}

/** Replaces the estimate's discounts; the caller then writes the totals. */
export async function replaceQuoteDiscountsTx(
  tx: DrizzleTX, quoteId: number, discounts: ReadonlyArray<DiscountInput & { customerDiscountId?: number | null }>,
) {
  await tx.delete(quoteDiscountsTable).where(eq(quoteDiscountsTable.quoteId, quoteId));
  if (!discounts.length) return;
  await tx.insert(quoteDiscountsTable).values(discounts.map((discount, sortOrder) => ({
    quoteId, name: discount.name, kind: discount.kind, value: String(discount.value), sortOrder,
    customerDiscountId: discount.customerDiscountId ?? null,
  })));
}

/** A new estimate starts with the profile's own discounts (senior, military …). */
export async function copyProfileDiscountsTx(tx: DrizzleTX, quoteId: number, customerId: number | null) {
  if (!customerId) return 0;
  const saved = await tx.select().from(customerDiscountsTable)
    .where(and(eq(customerDiscountsTable.customerId, customerId), isNull(customerDiscountsTable.archivedAt)))
    .orderBy(asc(customerDiscountsTable.id));
  await replaceQuoteDiscountsTx(tx, quoteId, saved.map((row) => ({
    name: row.name, kind: row.kind as DiscountInput["kind"], value: Number(row.value), customerDiscountId: row.id,
  })));
  return saved.length;
}

/** Whether each catalogue service is Taxable (phase 6), for lines that do not say. */
export async function serviceTaxability(tx: DrizzleTX | typeof db, serviceIds: ReadonlyArray<number | null | undefined>) {
  const ids = [...new Set(serviceIds.filter((id): id is number => typeof id === "number" && id > 0))];
  if (!ids.length) return new Map<number, boolean>();
  const rows = await tx.select({ id: servicesTable.id, taxable: servicesTable.taxable }).from(servicesTable).where(inArray(servicesTable.id, ids));
  return new Map(rows.map((row) => [row.id, row.taxable]));
}

/**
 * The tax an estimate charges — phase 6: its state rate, its county rate, or both
 * added together (Kyle #2), frozen onto the estimate. null turns tax off. A Tax
 * Exempt customer's estimate cannot charge tax.
 */
export async function taxChoiceOf(tx: DrizzleTX | typeof db, raw: unknown, customerId: number | null):
  Promise<{ taxRate: string | null; taxLabel: string | null; taxStateRateId: number | null; taxCountyRateId: number | null } | { error: string }> {
  const none = { taxRate: null, taxLabel: null, taxStateRateId: null, taxCountyRateId: null };
  if (raw === null || raw === false) return none;
  const value = raw as { stateRateId?: unknown; countyRateId?: unknown } | undefined;
  const ids = [value?.stateRateId, value?.countyRateId].filter((id) => id != null && id !== "").map(Number);
  if (!ids.length) return none;
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return { error: "Choose a tax rate from Settings" };
  if (customerId) {
    const [customer] = await tx.select({ taxExempt: customersTable.taxExempt }).from(customersTable).where(eq(customersTable.id, customerId));
    if (customer?.taxExempt) return { error: "This customer is Tax Exempt, so the estimate cannot charge sales tax" };
  }
  const rates = await tx.select().from(taxRatesTable).where(and(inArray(taxRatesTable.id, ids), eq(taxRatesTable.isActive, true)));
  if (rates.length !== ids.length) return { error: "That tax rate is not set up, or has been turned off" };
  const state = rates.find((rate) => rate.kind === "state" && rate.id === Number(value?.stateRateId));
  const county = rates.find((rate) => rate.kind === "county" && rate.id === Number(value?.countyRateId));
  if ((value?.stateRateId != null && value.stateRateId !== "" && !state) || (value?.countyRateId != null && value.countyRateId !== "" && !county)) {
    return { error: "A state rate and a county rate are chosen in their own places" };
  }
  const { rate, label } = combinedRate([state, county].filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => ({ name: r.name, rate: Number(r.rate) })));
  return { taxRate: String(rate), taxLabel: label, taxStateRateId: state?.id ?? null, taxCountyRateId: county?.id ?? null };
}
