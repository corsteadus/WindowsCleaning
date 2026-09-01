/**
 * extractCustomerArray — runtime-safe customer array extraction.
 *
 * The generated OpenAPI client types listCustomers as returning `Customer[]`,
 * but the actual API response is the paginated envelope
 * `{ customers: T[], total: number, page: number, ... }`.
 *
 * This helper handles both shapes so callers never need `as unknown as`.
 * The only internal cast is `as T[]` after an `Array.isArray` runtime guard —
 * the minimal cast that TypeScript requires when narrowing from `unknown[]`.
 *
 * @param raw - The `data` value from a useListCustomers (or similar) query.
 * @returns   A flat array of customer-like objects, or [] when data is absent.
 */
export function extractCustomerArray<T extends object>(raw: unknown): T[] {
  if (raw == null || typeof raw !== "object") return [];
  if (Array.isArray(raw)) return raw as T[];
  const paginated = raw as { customers?: T[] };
  return paginated.customers ?? [];
}
