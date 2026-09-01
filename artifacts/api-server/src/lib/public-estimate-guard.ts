const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;

export function isValidPublicEstimateToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export class FixedWindowRequestLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs: number, maxKeys = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  allow(key: string, now = Date.now()): boolean {
    for (const [candidate, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(candidate);
    }
    const current = this.entries.get(key);
    if (!current) {
      if (this.entries.size >= this.maxKeys) return false;
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }

  get size(): number {
    return this.entries.size;
  }
}

export const publicEstimateIpLimiter = new FixedWindowRequestLimiter(120, 60_000, 5_000);
export const publicEstimateTokenLimiter = new FixedWindowRequestLimiter(60, 60_000, 10_000);

export function publicEstimateLimitKey(ip: string | undefined, token: string): string {
  return `${ip || "unknown"}:${token.slice(0, 12)}`;
}