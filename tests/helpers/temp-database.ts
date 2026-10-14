import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { DATABASE_PATH_ENV, openDatabase } from "../../src/db/connection.ts";
import { runMigrations } from "../../src/db/migrate.ts";

export interface TempDatabase {
  dir: string;
  path: string;
  cleanup: () => void;
}

// Creates a fresh directory per test and points COFFY_DATABASE_PATH at a
// database file inside it. The file itself is not created here.
export function createTempDatabase(fileName = "coffy.sqlite"): TempDatabase {
  const dir = mkdtempSync(join(tmpdir(), "coffy-test-"));
  const path = join(dir, fileName);
  process.env[DATABASE_PATH_ENV] = path;
  return {
    dir,
    path,
    cleanup: () => {
      delete process.env[DATABASE_PATH_ENV];
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function openMigratedDatabase(): DatabaseSync {
  const db = openDatabase({ create: true });
  runMigrations(db);
  return db;
}
