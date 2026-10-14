import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export function listMigrations(dir: string = MIGRATIONS_DIR): string[] {
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  const misnamed = files.filter((name) => !MIGRATION_FILE_PATTERN.test(name));
  if (misnamed.length > 0) {
    throw new Error(`Migration file names must match NNNN_name.sql: ${misnamed.join(", ")}`);
  }
  return files.sort();
}

// Applies every pending migration in name order and returns the names applied
// by this run. Each file runs in its own BEGIN IMMEDIATE transaction together
// with its schema_migrations row, so a concurrent run waits for the write lock
// and then sees the file as applied. Migration files must not contain their
// own BEGIN/COMMIT.
export function runMigrations(db: DatabaseSync, dir: string = MIGRATIONS_DIR): string[] {
  const migrations = listMigrations(dir);
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL) STRICT",
  );
  const isApplied = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");
  const record = db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");
  const applied: string[] = [];

  for (const name of migrations) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (isApplied.get(name) === undefined) {
        db.exec(readFileSync(join(dir, name), "utf8"));
        record.run(name, new Date().toISOString());
        applied.push(name);
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return applied;
}
