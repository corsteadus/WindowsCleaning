import crypto from "crypto";

// scrypt parameters for newly created hashes.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// Upper bounds accepted when verifying a stored hash, so a corrupted or
// tampered record cannot make the server allocate unbounded memory.
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 4;

const HEX_RE = /^(?:[0-9a-f]{2})+$/;

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      keyLength,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 },
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      },
    );
  });
}

/**
 * Hash a plaintext password for storage.
 * Format: `scrypt:<N>:<r>:<p>:<salt hex>:<key hex>`
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scryptAsync(plain, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    key.toString("hex"),
  ].join(":");
}

/**
 * Verify a plaintext password against a stored hash produced by hashPassword.
 * Returns false (never throws) for malformed or non-scrypt stored values.
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4]!;
  const keyHex = parts[5]!;

  if (!Number.isInteger(N) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0) return false;
  if (!Number.isInteger(r) || r < 1 || r > MAX_R) return false;
  if (!Number.isInteger(p) || p < 1 || p > MAX_P) return false;
  // Exact-length checks: accept only the format hashPassword emits, so a
  // corrupted or tampered record cannot force large allocations or scrypt work.
  if (saltHex.length !== SALT_BYTES * 2 || !HEX_RE.test(saltHex)) return false;
  if (keyHex.length !== KEY_LENGTH * 2 || !HEX_RE.test(keyHex)) return false;

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(keyHex, "hex");
    const actual = await scryptAsync(plain, salt, expected.length, { N, r, p });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * Perform a scrypt verification against a throwaway hash. Used when the
 * username does not exist (or has no password set) so that failed logins take
 * comparable time whether or not the username is valid — no existence oracle.
 */
export async function burnPasswordCheck(plain: string): Promise<void> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(crypto.randomBytes(32).toString("hex"));
  }
  const dummy = await dummyHashPromise;
  await verifyPassword(plain, dummy);
}
