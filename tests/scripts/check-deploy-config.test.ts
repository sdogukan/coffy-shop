import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/ci/check-deploy-config.sh", import.meta.url));

const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nkey-material-that-must-not-print\n-----END OPENSSH PRIVATE KEY-----";
const VALID: Record<string, string> = {
  COFFY_DEPLOY_SSH_PRIVATE_KEY: PRIVATE_KEY,
  COFFY_DEPLOY_KNOWN_HOSTS: "coffy.example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIhostkey",
  COFFY_APP_URL: "https://coffy.example.test",
  COFFY_DEPLOY_HOST: "coffy.example.test",
  COFFY_DEPLOY_USER: "coffy-deploy",
  COFFY_DEPLOY_PATH: "/opt/coffy-shop",
  COFFY_PORT: "3002",
  COFFY_DATABASE_PATH: "/var/lib/coffy-shop/data/coffy.sqlite",
};

function runCheck(settings: Record<string, string>) {
  const result = spawnSync("bash", [SCRIPT], { env: { NODE_ENV: "test", PATH: process.env.PATH, ...settings }, encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}

function without(...names: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(VALID).filter(([name]) => !names.includes(name)));
}

describe("check-deploy-config.sh", () => {
  it("passes bash -n", () => {
    expect(spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" })).toMatchObject({ status: 0, stderr: "" });
  });

  it("accepts complete, well-formed settings", () => {
    expect(runCheck(VALID)).toMatchObject({ status: 0, output: "Demo deploy settings are present and well-formed.\n" });
  });

  it("names every missing secret and variable when nothing is configured", () => {
    const result = runCheck({});
    expect(result.status).toBe(1);
    expect(result.output).toBe(
      "::error title=Demo deploy settings missing::Set these in the Demo environment (deploy/README.md section 5): " +
        "secret COFFY_DEPLOY_SSH_PRIVATE_KEY, secret COFFY_DEPLOY_KNOWN_HOSTS, variable COFFY_APP_URL, " +
        "variable COFFY_DEPLOY_HOST, variable COFFY_DEPLOY_USER, variable COFFY_DEPLOY_PATH, variable COFFY_PORT, " +
        "variable COFFY_DATABASE_PATH\n",
    );
  });

  it("names only the missing settings and prints no configured value", () => {
    const result = runCheck({ ...without("COFFY_DEPLOY_KNOWN_HOSTS", "COFFY_PORT"), COFFY_DEPLOY_PATH: "" });
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "secret COFFY_DEPLOY_KNOWN_HOSTS, variable COFFY_DEPLOY_PATH, variable COFFY_PORT\n",
    );
    expect(result.output).not.toContain("COFFY_DEPLOY_SSH_PRIVATE_KEY");
    for (const value of Object.values(VALID)) {
      expect(result.output).not.toContain(value);
    }
    expect(result.output).not.toContain("key-material");
  });

  it.each([
    ["an http app URL", { COFFY_APP_URL: "http://coffy.example.test" }, "COFFY_APP_URL must be an https:// origin"],
    ["an app URL with a path", { COFFY_APP_URL: "https://coffy.example.test/shop" }, "COFFY_APP_URL must be an https:// origin"],
    ["a host that is an ssh option", { COFFY_DEPLOY_HOST: "-oProxyCommand=touch /tmp/x" }, "COFFY_DEPLOY_HOST must be"],
    ["a host with a space", { COFFY_DEPLOY_HOST: "coffy.example.test other" }, "COFFY_DEPLOY_HOST must be"],
    ["an uppercase user", { COFFY_DEPLOY_USER: "Deploy" }, "COFFY_DEPLOY_USER must be"],
    ["a relative deploy path", { COFFY_DEPLOY_PATH: "opt/coffy-shop" }, "COFFY_DEPLOY_PATH must be an absolute path"],
    ["a deploy path with ..", { COFFY_DEPLOY_PATH: "/opt/../etc" }, "COFFY_DEPLOY_PATH must be an absolute path"],
    ["a deploy path with a quote", { COFFY_DEPLOY_PATH: "/opt/coffy'shop" }, "COFFY_DEPLOY_PATH must be an absolute path"],
    ["a relative database path", { COFFY_DATABASE_PATH: "data/coffy.sqlite" }, "COFFY_DATABASE_PATH must be an absolute path"],
    ["a database inside the deploy path", { COFFY_DATABASE_PATH: "/opt/coffy-shop/current/coffy.sqlite" }, "COFFY_DATABASE_PATH must be outside COFFY_DEPLOY_PATH"],
    ["a port above 65535", { COFFY_PORT: "70000" }, "COFFY_PORT must be a port number"],
    ["a non-numeric port", { COFFY_PORT: "3002/tcp" }, "COFFY_PORT must be a port number"],
  ])("rejects %s", (_case, override, message) => {
    const result = runCheck({ ...VALID, ...override });
    expect(result.status).toBe(1);
    expect(result.output).toContain(`::error title=Demo deploy settings invalid::variable ${message}`);
  });

  it("accepts a database path that only shares a prefix with the deploy path", () => {
    expect(runCheck({ ...VALID, COFFY_DATABASE_PATH: "/opt/coffy-shop-data/coffy.sqlite" }).status).toBe(0);
  });
});
