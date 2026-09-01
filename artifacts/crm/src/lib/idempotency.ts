export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function idempotencyRequest(key: string): RequestInit {
  return {
    headers: {
      "Idempotency-Key": key,
    },
  };
}