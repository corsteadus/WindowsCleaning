/**
 * Print a scrypt password hash suitable for the users.password_hash column.
 *
 * Usage (run from artifacts/api-server):
 *
 *   LOCAL_USER_PASSWORD='********' node --experimental-strip-types scripts/hash-password.ts
 *
 * The resulting hash is environment-independent: the same value can be
 * inserted into any environment's users table (e.g. when provisioning the
 * same local login in production). To provision a local login, set on the
 * user's row: username, password_hash (this output), and the desired role.
 *
 * The password is read from the environment only — never hardcode it here,
 * and never store the plaintext anywhere.
 */
import { hashPassword } from "../src/lib/password.ts";

const password = process.env.LOCAL_USER_PASSWORD ?? "";
if (password.length < 8) {
  console.error("LOCAL_USER_PASSWORD is required (min 8 characters)");
  process.exit(1);
}

console.log(await hashPassword(password));
