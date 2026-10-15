import { beforeAll, describe, expect, it } from "vitest";
import { readAdminConfig, verifyAdminCredentials } from "../../src/admin/config.ts";
import { hashAdminPassword } from "../../src/admin/password.ts";

let hash: string;

beforeAll(async () => {
  hash = await hashAdminPassword("kahve-yonetici");
});

function env(username: string | undefined, passwordHash: string | undefined) {
  return { COFFY_ADMIN_USERNAME: username, COFFY_ADMIN_PASSWORD_HASH: passwordHash };
}

describe("readAdminConfig", () => {
  it("returns the username and parsed hash when both are valid", () => {
    expect(readAdminConfig(env("barista", hash))).toMatchObject({ username: "barista", passwordHash: { cost: 32768 } });
  });

  it.each([
    ["the username is missing", () => env(undefined, hash)],
    ["the username is empty", () => env("", hash)],
    ["the username is blank", () => env("   ", hash)],
    ["the hash is missing", () => env("barista", undefined)],
    ["the hash is empty", () => env("barista", "")],
    ["the hash is malformed", () => env("barista", "not-a-hash")],
    ["the hash has out-of-range parameters", () => env("barista", hash.replace(".32768.", ".1048576."))],
    ["nothing is set", () => ({})],
  ])("fails closed when %s", (_label, makeEnv) => {
    expect(readAdminConfig(makeEnv())).toBeNull();
  });

  it("reads the environment on every call", () => {
    const live: Record<string, string | undefined> = env("barista", hash);
    expect(readAdminConfig(live)).not.toBeNull();
    live.COFFY_ADMIN_PASSWORD_HASH = "";
    expect(readAdminConfig(live)).toBeNull();
  });
});

describe("verifyAdminCredentials", () => {
  it("accepts only the configured username with the hashed password", async () => {
    const config = readAdminConfig(env("barista", hash))!;
    expect(await verifyAdminCredentials(config, "barista", "kahve-yonetici")).toBe(true);
    expect(await verifyAdminCredentials(config, "barista", "yanlis")).toBe(false);
    expect(await verifyAdminCredentials(config, "Barista", "kahve-yonetici")).toBe(false);
    expect(await verifyAdminCredentials(config, "barista ", "kahve-yonetici")).toBe(false);
    expect(await verifyAdminCredentials(config, "b".repeat(1024), "kahve-yonetici")).toBe(false);
  });
});
