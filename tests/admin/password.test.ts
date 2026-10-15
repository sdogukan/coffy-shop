import { describe, expect, it } from "vitest";
import {
  hashAdminPassword,
  isAcceptablePassword,
  MAX_ADMIN_PASSWORD_LENGTH,
  parseAdminPasswordHash,
  verifyAdminPassword,
} from "../../src/admin/password.ts";

const SALT = Buffer.alloc(16, 1).toString("base64url");
const KEY = Buffer.alloc(32, 2).toString("base64url");

function hashString(cost: number | string, blockSize: number | string, parallelism: number | string, salt = SALT, key = KEY) {
  return ["scrypt", cost, blockSize, parallelism, salt, key].join(".");
}

describe("admin password hashing", () => {
  it("produces a self-describing hash without characters env files would mangle, which verifies only the same password", async () => {
    const hash = await hashAdminPassword("doğru parola 1");
    expect(hash).toMatch(/^scrypt\.32768\.8\.1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toMatch(/[$"'\s#\\]/);
    const parsed = parseAdminPasswordHash(hash);
    expect(parsed).not.toBeNull();
    expect(await verifyAdminPassword("doğru parola 1", parsed!)).toBe(true);
    expect(await verifyAdminPassword("doğru parola 2", parsed!)).toBe(false);
    expect(await verifyAdminPassword("", parsed!)).toBe(false);
  });

  it("uses a fresh salt per hash", async () => {
    expect(await hashAdminPassword("aynı")).not.toBe(await hashAdminPassword("aynı"));
  });

  it("refuses an empty or oversized password", async () => {
    await expect(hashAdminPassword("")).rejects.toThrow("1 to 1024 characters");
    await expect(hashAdminPassword("a".repeat(MAX_ADMIN_PASSWORD_LENGTH + 1))).rejects.toThrow("1 to 1024 characters");
    expect(isAcceptablePassword("a".repeat(MAX_ADMIN_PASSWORD_LENGTH))).toBe(true);
    expect(isAcceptablePassword(123)).toBe(false);
  });

  it("accepts the parameter bounds", () => {
    expect(parseAdminPasswordHash(hashString(16384, 8, 1))).toMatchObject({ cost: 16384, blockSize: 8, parallelism: 1 });
    expect(parseAdminPasswordHash(hashString(16384, 16, 4))).not.toBeNull();
    expect(parseAdminPasswordHash(hashString(32768, 8, 4))).not.toBeNull();
  });

  it.each([
    ["an empty string", ""],
    ["a bcrypt-style hash", "$2b$10$abcdefghijklmnopqrstuv"],
    ["another algorithm", hashString(32768, 8, 1).replace("scrypt", "argon2")],
    ["a missing part", ["scrypt", 32768, 8, 1, SALT].join(".")],
    ["an extra part", `${hashString(32768, 8, 1)}.x`],
    ["a cost below the minimum", hashString(8192, 8, 1)],
    ["a cost above the maximum", hashString(131072, 8, 1)],
    ["a cost that is not a power of two", hashString(20000, 8, 1)],
    ["a cost needing more than the memory bound", hashString(65536, 8, 1)],
    ["a block size below the minimum", hashString(16384, 4, 1)],
    ["a block size above the maximum", hashString(16384, 32, 1)],
    ["a parallelism above the maximum", hashString(16384, 8, 5)],
    ["a zero parameter", hashString(16384, 8, 0)],
    ["a leading zero", hashString("016384", 8, 1)],
    ["a signed number", hashString("+16384", 8, 1)],
    ["a fractional number", hashString("16384.5", 8, 1)],
    ["a salt that is too short", hashString(16384, 8, 1, Buffer.alloc(8).toString("base64url"))],
    ["a key that is too short", hashString(16384, 8, 1, SALT, Buffer.alloc(16).toString("base64url"))],
    ["a key that is too long", hashString(16384, 8, 1, SALT, Buffer.alloc(65).toString("base64url"))],
    ["padded base64", hashString(16384, 8, 1, `${SALT}==`)],
    ["standard base64 characters", hashString(16384, 8, 1, SALT.replace(/.$/, "+"))],
    ["a non-canonical base64url tail", hashString(16384, 8, 1, `${SALT.slice(0, -1)}B`)],
    ["surrounding whitespace", ` ${hashString(16384, 8, 1)}`],
  ])("rejects %s", (_label, value) => {
    expect(parseAdminPasswordHash(value)).toBeNull();
  });
});
