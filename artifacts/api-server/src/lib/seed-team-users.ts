import { hashPassword } from "./password.ts";
import { TEAM_USER_ROLES, type TeamUserRole } from "./authorization.ts";

/**
 * The three sandbox logins, provisioned into an empty database.
 *
 * A fresh database has no users, which means nobody can sign in and the app
 * cannot be opened at all — not even to create the first account. This exists
 * to break that circle after a branch reset or a move to a new provider.
 *
 * Passwords are hashed with the same `hashPassword` the login path verifies
 * against, so a seeded account is indistinguishable from one created through
 * the UI. Nothing here writes a plaintext password anywhere.
 */

export type SeedAccount = {
  username: string;
  password: string;
  role: TeamUserRole;
  firstName: string;
  lastName: string;
  email: string;
};

export type SeedRow = {
  username: string;
  passwordHash: string;
  role: TeamUserRole;
  firstName: string;
  lastName: string;
  email: string;
  isActive: true;
};

/**
 * Refuses a role the authorization layer does not know.
 *
 * A typo here would create an account that authenticates and then fails every
 * capability check — a confusing way to spend an afternoon. `isKnownAuthorizationRole`
 * rejects unknown roles at request time; this rejects them at seed time.
 */
export function assertSeedable(account: SeedAccount): void {
  if (!(TEAM_USER_ROLES as readonly string[]).includes(account.role)) {
    throw new Error(
      `Refusing to seed ${account.username}: "${account.role}" is not one of ${TEAM_USER_ROLES.join(", ")}`,
    );
  }
  if (!account.username.trim()) throw new Error("Refusing to seed an account with no username");
  if (account.password.length < 12) {
    throw new Error(`Refusing to seed ${account.username}: password is too short to be a real one`);
  }
}

export async function toSeedRow(account: SeedAccount): Promise<SeedRow> {
  assertSeedable(account);
  return {
    username: account.username,
    passwordHash: await hashPassword(account.password),
    role: account.role,
    firstName: account.firstName,
    lastName: account.lastName,
    email: account.email,
    isActive: true,
  };
}

/**
 * `async` rather than a plain function returning a promise: a synchronous
 * throw from a promise-returning function escapes the caller's `.catch()`,
 * which is a trap worth not laying.
 */
export async function toSeedRows(accounts: readonly SeedAccount[]): Promise<SeedRow[]> {
  const names = new Set<string>();
  for (const account of accounts) {
    const key = account.username.toLowerCase();
    // `users_username_lower_unique` would reject this at insert time; saying so
    // here names the duplicate instead of quoting an index.
    if (names.has(key)) throw new Error(`Duplicate seed username: ${account.username}`);
    names.add(key);
  }
  return Promise.all(accounts.map(toSeedRow));
}
