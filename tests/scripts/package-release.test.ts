import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/package-release.sh", import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "89abcdef0123456789abcdef0123456789abcdef";
const ARCHIVE_NAME = `coffy-shop-${SHA}-linux-x64.tar.gz`;

// The script refuses to package anywhere but Linux x64, where the server runs.
const isReleaseHost = process.platform === "linux" && process.arch === "x64";

function write(root: string, path: string, content = ""): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

// A project tree shaped like the output of `npm run build`, small enough to
// package in milliseconds. The script finds the project from its own location.
function createProject(root: string, stampedSha = SHA): void {
  mkdirSync(join(root, "scripts"));
  copyFileSync(SCRIPT, join(root, "scripts/package-release.sh"));
  write(root, ".next/standalone/server.js", "// server\n");
  write(root, ".next/standalone/package.json", '{"type":"module"}\n');
  write(root, ".next/standalone/.next/server/app/api/version/route.js", `const sha = "${stampedSha}";\n`);
  write(root, ".next/standalone/node_modules/next/index.js", "");
  write(root, ".next/static/chunks/app.js", "// chunk\n");
  write(root, "public/logo.svg", "<svg/>\n");
  write(root, "migrations/0001_init.sql", "CREATE TABLE t (id INTEGER);\n");
  write(root, "migrations/README.md", "not a migration\n");
  for (const name of ["backup.ts", "migrate.ts", "seed.ts", "run.ts"]) {
    write(root, `src/cli/${name}`, "");
  }
  write(root, "src/db/connection.ts", "");
}

function runPackage(root: string, args: string[], sha: string | undefined = SHA) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH };
  if (sha !== undefined) {
    env.GITHUB_SHA = sha;
  }
  const result = spawnSync("bash", [join(root, "scripts/package-release.sh"), ...args], { env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function listArchive(archive: string): string[] {
  const result = spawnSync("tar", ["--list", "--verbose", "--numeric-owner", "--gzip", "--file", archive], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return result.stdout.trim().split("\n");
}

describe("package-release.sh", () => {
  let root: string;
  let output: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "coffy-package-"));
    output = join(root, "out");
    createProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes bash -n", () => {
    expect(spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" })).toMatchObject({ status: 0, stderr: "" });
  });

  it("rejects a call without an output directory", () => {
    const result = runPackage(root, []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: package-release.sh");
  });

  it.runIf(isReleaseHost)("packages the standalone server with static assets, public, migrations, entry points and the SHA", () => {
    const result = runPackage(root, [output]);
    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(result.stdout).toBe(`${join(output, ARCHIVE_NAME)}\n`);

    const entries = listArchive(join(output, ARCHIVE_NAME));
    const files = entries.map((line) => line.split(/\s+/).at(-1));
    expect(files).toEqual(
      expect.arrayContaining([
        "./server.js",
        "./package.json",
        "./node_modules/next/index.js",
        "./.next/server/app/api/version/route.js",
        "./.next/static/chunks/app.js",
        "./public/logo.svg",
        "./migrations/0001_init.sql",
        "./src/cli/backup.ts",
        "./src/cli/migrate.ts",
        "./src/cli/seed.ts",
        "./src/cli/run.ts",
        "./src/db/connection.ts",
        "./REVISION",
      ]),
    );
    expect(files).not.toContain("./migrations/README.md");

    // Owned by root in the archive and never group- or world-writable, so the
    // unpacked release is readable by coffy-shop but writable only by the uploader.
    for (const line of entries) {
      const [mode, owner] = line.split(/\s+/);
      expect(owner).toBe("0/0");
      expect(mode?.slice(5, 6)).toBe("-");
      expect(mode?.slice(8, 9)).toBe("-");
      expect(mode?.slice(4, 5)).toBe("r");
      expect(mode?.slice(7, 8)).toBe("r");
    }

    const revision = spawnSync("tar", ["--extract", "--to-stdout", "--gzip", "--file", join(output, ARCHIVE_NAME), "./REVISION"], {
      encoding: "utf8",
    });
    expect(revision.stdout).toBe(`${SHA}\n`);
  });

  it.runIf(isReleaseHost)("packages a project without a public directory", () => {
    rmSync(join(root, "public"), { recursive: true });
    expect(runPackage(root, [output]).status).toBe(0);
    expect(listArchive(join(output, ARCHIVE_NAME)).some((line) => line.includes("./public"))).toBe(false);
  });

  it.runIf(isReleaseHost)("refuses a build stamped with a different SHA", () => {
    write(root, ".next/standalone/.next/server/app/api/version/route.js", `const sha = "${OTHER_SHA}";\n`);
    const result = runPackage(root, [output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`the build is not stamped with ${SHA}`);
    expect(existsSync(output)).toBe(false);
  });

  it.runIf(isReleaseHost)("refuses a SHA that is not 40 lowercase hex characters", () => {
    const result = runPackage(root, [output], SHA.toUpperCase());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release SHA must be 40 lowercase hex characters");
  });

  it.runIf(isReleaseHost).each([
    ["the standalone server", ".next/standalone/server.js", "server.js is missing"],
    ["the static assets", ".next/static", ".next/static is missing"],
    ["a database entry point", "src/cli/migrate.ts", "src/cli/migrate.ts is missing"],
    ["the migration files", "migrations/0001_init.sql", "no migration files"],
  ])("refuses to package without %s", (_case, path, message) => {
    rmSync(join(root, path), { recursive: true });
    const result = runPackage(root, [output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(existsSync(output)).toBe(false);
  });

  // next build copies .env and .env.production into the standalone output.
  it.runIf(isReleaseHost).each([
    [".next/standalone/.env"],
    [".next/standalone/.env.production"],
    [".next/standalone/data/coffy.sqlite"],
    [".next/standalone/coffy.sqlite-wal"],
    ["public/deploy.pem"],
    ["public/id_ed25519"],
  ])("refuses to package %s", (path) => {
    write(root, path, "secret\n");
    const result = runPackage(root, [output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing to package environment, database or key files");
    expect(result.stderr).not.toContain("secret\n");
    expect(existsSync(output) ? readdirSync(output) : []).toEqual([]);
  });
});
