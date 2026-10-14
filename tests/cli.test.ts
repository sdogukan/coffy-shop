import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

const CLI_DIR = fileURLToPath(new URL("../src/cli/", import.meta.url));

// The deploy wrapper runs these entry points with plain `node` and relies on
// their exit codes, so they are exercised the same way here.
function runCli(script: string, env: NodeJS.ProcessEnv, args: string[] = []) {
  const result = spawnSync(process.execPath, [join(CLI_DIR, script), ...args], {
    env: { ...env, PATH: process.env.PATH },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("database entry points", () => {
  let temp: TempDatabase;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    temp = createTempDatabase();
    env = { COFFY_DATABASE_PATH: temp.path, NODE_ENV: "production" };
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("migrate creates the database and is a no-op the second time", () => {
    expect(runCli("migrate.ts", env)).toMatchObject({ status: 0, stderr: "" });
    expect(runCli("migrate.ts", env)).toMatchObject({ status: 0, stdout: "No pending migrations\n" });
  });

  it("seed, reset and backup run against a migrated database", () => {
    runCli("migrate.ts", env);
    expect(runCli("seed.ts", env)).toMatchObject({ status: 0, stdout: "Seed inserted 2 categories and 8 products\n" });
    expect(runCli("seed.ts", env)).toMatchObject({ status: 0, stdout: "Seed inserted 0 categories and 0 products\n" });

    const refused = runCli("reset.ts", env);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("Catalog reset refused");
    expect(runCli("reset.ts", { ...env, NODE_ENV: "test" }).status).toBe(0);

    const destination = join(temp.dir, "backup.sqlite");
    expect(runCli("backup.ts", env, [destination]).status).toBe(0);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      expect(copy.prepare("SELECT COUNT(*) AS total FROM products").get()).toEqual({ total: 8 });
    } finally {
      copy.close();
    }
  });

  it.each(["migrate.ts", "seed.ts", "reset.ts", "backup.ts"])("%s exits non-zero without COFFY_DATABASE_PATH", (script) => {
    const result = runCli(script, { NODE_ENV: "production" }, ["/tmp/unused-backup.sqlite"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("COFFY_DATABASE_PATH is not set");
  });

  it("seed and backup do not create a missing database", () => {
    expect(runCli("seed.ts", env).status).toBe(1);
    expect(runCli("backup.ts", env, [join(temp.dir, "backup.sqlite")]).status).toBe(1);
    expect(existsSync(temp.path)).toBe(false);
  });

  it("backup exits non-zero without a destination", () => {
    runCli("migrate.ts", env);
    const result = runCli("backup.ts", env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage");
  });
});
