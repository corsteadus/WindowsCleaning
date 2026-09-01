/**
 * Parse a route parameter as a safe, positive integer ID.
 *
 * Deliberately accepts only a complete decimal digit string. Number.parseInt
 * is not suitable here because it accepts prefixes such as "123abc".
 */
export function parsePositiveRouteId(
  value: string | null | undefined,
): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;

  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0
    ? numericValue
    : null;
}