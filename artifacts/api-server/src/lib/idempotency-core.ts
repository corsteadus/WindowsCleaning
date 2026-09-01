import { createHash } from "node:crypto";

/**
 * Stable JSON is intentionally kept in memory only. The database stores the
 * SHA-256 digest, never the request body or any potentially sensitive fields.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

export function hashIdempotencyRequest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}