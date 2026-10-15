import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hashAdminPassword } from "../../src/admin/password.ts";

const DEPLOY_DIR = fileURLToPath(new URL("../../deploy/", import.meta.url));
const WRAPPER = join(DEPLOY_DIR, "coffy-shop-deploy");
const PROVISION = join(DEPLOY_DIR, "provision.sh");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const isRoot = process.getuid?.() === 0;

function readDeployFile(name: string): string {
  return readFileSync(join(DEPLOY_DIR, name), "utf8");
}

// Every file under deploy/ with a bash shebang, so a new script is checked
// without editing this list.
function shellScripts(dir: string = DEPLOY_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return shellScripts(path);
    }
    return readFileSync(path, "utf8").startsWith("#!/usr/bin/env bash\n") ? [path] : [];
  });
}

function runBash(script: string, args: string[]) {
  const result = spawnSync("bash", [script, ...args], {
    env: { NODE_ENV: "test", PATH: process.env.PATH },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function nonCommentLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
}

describe("deploy shell scripts", () => {
  const scripts = shellScripts();

  it("finds the provisioning script and the deploy wrapper", () => {
    expect(scripts.map((path) => relative(DEPLOY_DIR, path)).sort()).toEqual(["coffy-shop-deploy", "provision.sh"]);
  });

  it.each(scripts.map((path) => [relative(DEPLOY_DIR, path), path]))("%s passes bash -n", (_name, path) => {
    expect(runBash("-n", [path])).toMatchObject({ status: 0, stderr: "" });
  });

  it("reference no Dolmuş Takip path", () => {
    for (const path of scripts) {
      expect(readFileSync(path, "utf8")).not.toMatch(/\/[^\s"']*dolmu[sş]/i);
    }
  });
});

describe("deploy wrapper argument validation", () => {
  it.each([
    ["no arguments", []],
    ["a subcommand without a SHA", ["activate"]],
    ["an unknown subcommand", ["status", SHA]],
    ["an extra argument", ["activate", SHA, "--force"]],
    ["an empty SHA", ["activate", ""]],
    ["an uppercase SHA", ["activate", SHA.toUpperCase()]],
    ["a 39-character SHA", ["activate", SHA.slice(1)]],
    ["a 41-character SHA", ["activate", `${SHA}0`]],
    ["a non-hex character", ["rollback", `g${SHA.slice(1)}`]],
    ["a trailing newline", ["activate", `${SHA}\n`]],
    ["a leading space", ["activate", ` ${SHA.slice(1)}`]],
    ["a path", ["activate", `../../../etc/${SHA.slice(15)}`]],
    ["an option-like value", ["rollback", `-${SHA.slice(1)}`]],
  ])("rejects %s with usage and exit 2 before anything else runs", (_case, args) => {
    const result = runBash(WRAPPER, args);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^usage: coffy-shop-deploy \{activate\|rollback\}/);
    expect(result.stdout).toBe("");
  });

  it.skipIf(isRoot).each(["activate", "rollback"])("accepts %s with a 40-hex SHA and then requires root", (command) => {
    const result = runBash(WRAPPER, [command, SHA]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be run as root");
    expect(result.stdout).toBe("");
  });
});

describe("provisioning script", () => {
  it.each([
    ["an unknown option", ["--force"]],
    ["--node without a value", ["--node"]],
    ["a relative --node path", ["--node", "node"]],
  ])("rejects %s with exit 2", (_case, args) => {
    const result = runBash(PROVISION, args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: provision.sh");
  });

  it.skipIf(isRoot)("refuses to run without root", () => {
    const result = runBash(PROVISION, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be run as root");
  });
});

describe("server configuration files", () => {
  it("env example lists variable names only", () => {
    const lines = nonCommentLines(readDeployFile("coffy-shop.env.example"));
    for (const line of lines) {
      expect(line).toMatch(/^[A-Z][A-Z0-9_]*=$/);
    }
    expect(lines.map((line) => line.slice(0, -1))).toEqual([
      "NODE_ENV",
      "HOSTNAME",
      "PORT",
      "COFFY_DATABASE_PATH",
      "COFFY_RELEASE_ENVIRONMENT",
      "COFFY_ADMIN_USERNAME",
      "COFFY_ADMIN_PASSWORD_HASH",
    ]);
  });

  it("sudoers rule grants coffy-deploy only the absolute wrapper path", () => {
    expect(nonCommentLines(readDeployFile("sudoers/coffy-deploy"))).toEqual([
      "coffy-deploy ALL=(root) NOPASSWD: /usr/local/sbin/coffy-shop-deploy",
    ]);
  });

  it("unit runs as coffy-shop from the env file with only the data directory writable", () => {
    const directives = nonCommentLines(readDeployFile("systemd/coffy-shop.service"));
    expect(directives).toEqual(
      expect.arrayContaining([
        "User=coffy-shop",
        "Group=coffy-shop",
        "EnvironmentFile=/etc/coffy-shop/coffy-shop.env",
        "ExecStart=@COFFY_NODE_BIN@ /opt/coffy-shop/current/server.js",
        "NoNewPrivileges=yes",
        "ProtectSystem=strict",
      ]),
    );
    expect(directives.filter((line) => line.startsWith("ReadWritePaths="))).toEqual([
      "ReadWritePaths=/var/lib/coffy-shop",
    ]);
  });
});

describe("operator runbook", () => {
  const runbook = readDeployFile("README.md");

  it.each([
    "COFFY_DEPLOY_SSH_PRIVATE_KEY",
    "COFFY_DEPLOY_KNOWN_HOSTS",
    "COFFY_APP_URL",
    "COFFY_DEPLOY_HOST",
    "COFFY_DEPLOY_USER",
    "COFFY_DEPLOY_PATH",
    "COFFY_PORT",
    "COFFY_DATABASE_PATH",
  ])("names the GitHub Demo setting %s", (name) => {
    expect(runbook).toContain(`| \`${name}\` |`);
  });

  it.each(["## Backups", "## Migrations", "## Rollback (code)", "## Manual database restore"])(
    "documents %s",
    (heading) => {
      expect(runbook).toContain(`\n${heading}\n`);
    },
  );

  it("documents the staff hash command that package.json defines", () => {
    const packageJson = JSON.parse(readFileSync(join(DEPLOY_DIR, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(runbook).toContain("npm run --silent admin:hash-password");
    expect(packageJson.scripts["admin:hash-password"]).toBe("node src/cli/hash-admin-password.ts");
  });

  it("documents the hash format the backend produces", async () => {
    expect(runbook).toContain("`scrypt.<N>.<r>.<p>.<salt>.<key>`");
    expect(await hashAdminPassword("runbook format check")).toMatch(
      /^scrypt\.[0-9]+\.[0-9]+\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
  });

  it("documents fail-closed staff login and the restart after an env change", () => {
    expect(runbook).toContain("The admin area fails closed.");
    expect(runbook).toContain("sudo systemctl restart coffy-shop");
  });

  it("contains no staff password hash", () => {
    expect(runbook).not.toMatch(/scrypt\.[0-9]/);
  });
});
