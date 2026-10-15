import { createHash, timingSafeEqual } from "node:crypto";
import type { Env } from "../db/connection.ts";
import { type AdminPasswordHash, parseAdminPasswordHash, verifyAdminPassword } from "./password.ts";

export const ADMIN_USERNAME_ENV = "COFFY_ADMIN_USERNAME";
export const ADMIN_PASSWORD_HASH_ENV = "COFFY_ADMIN_PASSWORD_HASH";

export interface AdminConfig {
  username: string;
  passwordHash: AdminPasswordHash;
}

// Fails closed: a missing or blank username, or a missing, blank or
// malformed hash, returns null and the admin area stays disabled (login 503,
// every session rejected). Read on every call and only by admin code, so a
// broken value never affects the public menu or orders, and an edit to the
// env file takes effect for existing sessions too. Values are never logged.
export function readAdminConfig(env: Env = process.env): AdminConfig | null {
  const username = env[ADMIN_USERNAME_ENV];
  const hash = env[ADMIN_PASSWORD_HASH_ENV];
  if (username === undefined || username.trim() === "" || hash === undefined || hash === "") {
    return null;
  }
  const passwordHash = parseAdminPasswordHash(hash);
  return passwordHash === null ? null : { username, passwordHash };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// The username is compared through fixed-length SHA-256 digests in constant
// time, and scrypt always runs (against a key that cannot match when the
// username is wrong, with the same parameters), so the response time does
// not tell whether the username exists.
export async function verifyAdminCredentials(config: AdminConfig, username: string, password: string): Promise<boolean> {
  const usernameMatches = timingSafeEqual(sha256(username), sha256(config.username));
  const target = usernameMatches
    ? config.passwordHash
    : {
        ...config.passwordHash,
        salt: Buffer.alloc(config.passwordHash.salt.length),
        key: Buffer.alloc(config.passwordHash.key.length),
      };
  const passwordMatches = await verifyAdminPassword(password, target);
  return usernameMatches && passwordMatches;
}
