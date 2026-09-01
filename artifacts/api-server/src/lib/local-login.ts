/**
 * Core logic for local username/password login, kept free of Express and
 * Drizzle so it can be unit-tested with fakes (same pattern as
 * quote-convert/lead-convert cores).
 */

export interface LocalLoginUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string;
  passwordHash: string | null;
  isActive: boolean;
}

export interface AuthenticatedLocalUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string;
}

export interface LocalLoginDeps {
  /** Look up a user by normalized (lowercased, trimmed) username. */
  findUserByUsername(normalizedUsername: string): Promise<LocalLoginUser | null>;
  /** Verify a plaintext password against a stored hash. */
  verifyPassword(plain: string, storedHash: string): Promise<boolean>;
  /** Equalize timing when no real hash exists for this username. */
  burnPasswordCheck(plain: string): Promise<void>;
}

export type LocalLoginResult =
  | { ok: true; user: AuthenticatedLocalUser }
  | { ok: false };

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function authenticateLocalUser(
  deps: LocalLoginDeps,
  usernameRaw: string,
  password: string,
): Promise<LocalLoginResult> {
  const normalized = normalizeUsername(usernameRaw);
  if (!normalized || !password) {
    await deps.burnPasswordCheck(password);
    return { ok: false };
  }

  const user = await deps.findUserByUsername(normalized);
  if (!user || !user.isActive || !user.passwordHash) {
    await deps.burnPasswordCheck(password);
    return { ok: false };
  }

  const valid = await deps.verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false };

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      role: user.role,
    },
  };
}

interface LoginThrottleOptions {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Fixed-window failure counter keyed by e.g. `${ip}|${username}`.
 * In-memory: resets on server restart, which is acceptable for this scale.
 */
export class LoginThrottle {
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly failures = new Map<
    string,
    { count: number; windowStart: number }
  >();
  private static readonly MAX_TRACKED_KEYS = 10_000;

  constructor(options: LoginThrottleOptions = {}) {
    this.maxFailures = options.maxFailures ?? 10;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  isBlocked(key: string): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (this.now() - entry.windowStart >= this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string): void {
    const t = this.now();
    const entry = this.failures.get(key);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      if (this.failures.size >= LoginThrottle.MAX_TRACKED_KEYS) this.prune(t);
      this.failures.set(key, { count: 1, windowStart: t });
      return;
    }
    entry.count += 1;
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private prune(t: number): void {
    for (const [key, entry] of this.failures) {
      if (t - entry.windowStart >= this.windowMs) this.failures.delete(key);
    }
    if (this.failures.size >= LoginThrottle.MAX_TRACKED_KEYS) {
      // Everything is fresh — drop oldest insertions to bound memory.
      const excess = this.failures.size - LoginThrottle.MAX_TRACKED_KEYS + 1;
      let dropped = 0;
      for (const key of this.failures.keys()) {
        if (dropped++ >= excess) break;
        this.failures.delete(key);
      }
    }
  }
}
