import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Staff password hashing with scrypt. The hash string is self-describing:
//
//   scrypt.<N>.<r>.<p>.<salt>.<key>      salt and key are unpadded base64url
//
// It contains no $, quotes, whitespace, # or backslash, so it can be written
// unquoted into the systemd EnvironmentFile and survives Next.js .env $-expansion.
// This file imports only Node built-ins: the hash CLI runs it with plain node.

export const MAX_ADMIN_PASSWORD_LENGTH = 1024;

const ALGORITHM = "scrypt";
const DEFAULT_COST = 32_768;
const DEFAULT_BLOCK_SIZE = 8;
const DEFAULT_PARALLELISM = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

// Parameters are read from the environment, so they are bounded before they
// reach crypto.scrypt: an out-of-range value makes the config invalid (admin
// disabled) instead of failing or stalling every login request.
const MIN_COST = 16_384;
const MAX_COST = 65_536;
const MIN_BLOCK_SIZE = 8;
const MAX_BLOCK_SIZE = 16;
const MIN_PARALLELISM = 1;
const MAX_PARALLELISM = 4;
const MIN_SALT_BYTES = 16;
const MAX_SALT_BYTES = 64;
const MIN_KEY_BYTES = 32;
const MAX_KEY_BYTES = 64;
// OpenSSL needs 128 * r * (N + p + 2) bytes; the defaults use about 32 MiB.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

const DECIMAL_PATTERN = /^[1-9][0-9]{0,9}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface AdminPasswordHash {
  cost: number;
  blockSize: number;
  parallelism: number;
  salt: Buffer;
  key: Buffer;
}

export function isAcceptablePassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_ADMIN_PASSWORD_LENGTH;
}

function parseBoundedInteger(value: string, min: number, max: number): number | null {
  if (!DECIMAL_PATTERN.test(value)) {
    return null;
  }
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

// Only the canonical encoding is accepted, so one hash has one spelling.
function parseBase64url(value: string, minBytes: number, maxBytes: number): Buffer | null {
  if (!BASE64URL_PATTERN.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || bytes.length < minBytes || bytes.length > maxBytes) {
    return null;
  }
  return bytes;
}

function isPowerOfTwo(value: number): boolean {
  return (value & (value - 1)) === 0;
}

// Returns null for anything that is not a hash this module would accept.
export function parseAdminPasswordHash(value: string): AdminPasswordHash | null {
  const parts = value.split(".");
  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    return null;
  }
  const [, costText, blockSizeText, parallelismText, saltText, keyText] = parts as [string, string, string, string, string, string];
  const cost = parseBoundedInteger(costText, MIN_COST, MAX_COST);
  const blockSize = parseBoundedInteger(blockSizeText, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE);
  const parallelism = parseBoundedInteger(parallelismText, MIN_PARALLELISM, MAX_PARALLELISM);
  const salt = parseBase64url(saltText, MIN_SALT_BYTES, MAX_SALT_BYTES);
  const key = parseBase64url(keyText, MIN_KEY_BYTES, MAX_KEY_BYTES);
  if (cost === null || blockSize === null || parallelism === null || salt === null || key === null) {
    return null;
  }
  if (!isPowerOfTwo(cost) || 128 * blockSize * (cost + parallelism + 2) > SCRYPT_MAXMEM) {
    return null;
  }
  return { cost, blockSize, parallelism, salt, key };
}

// Asynchronous on purpose: scrypt runs on the libuv thread pool, so a login
// never blocks the server's event loop.
function deriveKey(password: string, hash: Omit<AdminPasswordHash, "key">, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      hash.salt,
      keyLength,
      { N: hash.cost, r: hash.blockSize, p: hash.parallelism, maxmem: SCRYPT_MAXMEM },
      (error, key) => (error === null ? resolve(key) : reject(error)),
    );
  });
}

export async function hashAdminPassword(password: string): Promise<string> {
  if (!isAcceptablePassword(password)) {
    throw new Error(`The password must be 1 to ${MAX_ADMIN_PASSWORD_LENGTH} characters long`);
  }
  const params = { cost: DEFAULT_COST, blockSize: DEFAULT_BLOCK_SIZE, parallelism: DEFAULT_PARALLELISM, salt: randomBytes(SALT_BYTES) };
  const key = await deriveKey(password, params, KEY_BYTES);
  return [
    ALGORITHM,
    params.cost,
    params.blockSize,
    params.parallelism,
    params.salt.toString("base64url"),
    key.toString("base64url"),
  ].join(".");
}

// Constant-time comparison; both buffers have hash.key.length bytes.
export async function verifyAdminPassword(password: string, hash: AdminPasswordHash): Promise<boolean> {
  const derived = await deriveKey(password, hash, hash.key.length);
  return timingSafeEqual(derived, hash.key);
}
