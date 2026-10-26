/**
 * An estimate's money, written in one place — phase 5. Every change to an
 * estimate's lines or discounts ends here, so its subtotal, each discount's
 * dollars, its discount total and its total always agree (lib/discounts.ts).
 * Tax is still 0 until phase 6.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { customerDiscountsTable, db, quoteDiscountsTable, quoteLineItemsTable, quotesTable } from "@workspace/db";
import { applyDiscounts, type DiscountInput } from "./discounts.ts";

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
  const lines = await tx.select({ totalPrice: quoteLineItemsTable.totalPrice }).from(quoteLineItemsTable)
    .where(eq(quoteLineItemsTable.quoteId, quoteId));
  const discounts = await readQuoteDiscounts(tx, quoteId);
  const subtotal = lines.reduce((sum, line) => sum + Math.round(Number(line.totalPrice) * 100), 0) / 100;
  const result = applyDiscounts(subtotal, discounts.map((row) => ({ name: row.name, kind: row.kind as DiscountInput["kind"], value: Number(row.value) })));
  for (const [i, row] of discounts.entries()) {
    if (Number(row.amount) !== result.discounts[i].amount) {
      await tx.update(quoteDiscountsTable).set({ amount: String(result.discounts[i].amount) }).where(eq(quoteDiscountsTable.id, row.id));
    }
  }
  await tx.update(quotesTable).set({
    subtotal: String(result.subtotal), discountTotal: String(result.discountTotal), totalAmount: String(result.total),
  }).where(eq(quotesTable.id, quoteId));
  return result;
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
