import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export const DATABASE_PATH_ENV = "COFFY_DATABASE_PATH";

export type Env = Readonly<Record<string, string | undefined>>;

const BUSY_TIMEOUT_MS = 5000;

// The database lives outside the release directory, so the path must come
// from the environment and must be absolute (a relative path would resolve
// inside the release and be lost on the next deploy).
export function getDatabasePath(env: Env = process.env): string {
  const value = env[DATABASE_PATH_ENV];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${DATABASE_PATH_ENV} is not set`);
  }
  if (!isAbsolute(value)) {
    throw new Error(`${DATABASE_PATH_ENV} must be an absolute path`);
  }
  return value;
}

export interface OpenDatabaseOptions {
  // Only the migration runner may create the file. Every other caller opens
  // an existing database and fails when it is missing.
  create?: boolean;
  env?: Env;
}

export function openDatabase({ create = false, env = process.env }: OpenDatabaseOptions = {}): DatabaseSync {
  const path = getDatabasePath(env);
  if (!create) {
    return new DatabaseSync(new URL(`${pathToFileURL(path).href}?mode=rw`), { timeout: BUSY_TIMEOUT_MS });
  }
  // WAL is persistent in the file, so setting it where the file is created
  // covers every later connection, including the previous release's server
  // while a new release migrates.
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
