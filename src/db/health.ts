import type { DatabaseSync } from "node:sqlite";
import { type Env, openDatabase } from "./connection.ts";

const REQUIRED_TABLES = ["schema_migrations", "categories", "products"] as const;

// Ready means: the file at COFFY_DATABASE_PATH already exists, opens, and the
// migrated tables can be read. The file is never created here, so a wrong
// path cannot look ready with an empty database.
export function isDatabaseReady(env: Env = process.env): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    for (const table of REQUIRED_TABLES) {
      db.prepare(`SELECT COUNT(*) FROM ${table}`).get();
    }
    return true;
  } catch (error) {
    console.error(`Database readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    db?.close();
  }
}
