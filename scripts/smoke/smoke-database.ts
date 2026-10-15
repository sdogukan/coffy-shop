import { seedCatalog } from "../../src/db/catalog.ts";
import { DATABASE_PATH_ENV, openDatabase } from "../../src/db/connection.ts";
import { runMigrations } from "../../src/db/migrate.ts";

// The smoke's own database: created, migrated and seeded exactly like a fresh
// install, at a path passed in explicitly (never COFFY_DATABASE_PATH from the
// shell).
export function createSmokeDatabase(databasePath: string): void {
  const db = openDatabase({ create: true, env: { [DATABASE_PATH_ENV]: databasePath } });
  try {
    runMigrations(db);
    seedCatalog(db);
  } finally {
    db.close();
  }
}

// After a passing run, the happy path's order must be stored as ready in THIS
// database; otherwise the server was reading some other database.
export function assertReadyOrderStored(databasePath: string): void {
  const db = openDatabase({ env: { [DATABASE_PATH_ENV]: databasePath } });
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'ready'").get() as { count: number };
    if (Number(row.count) === 0) {
      throw new Error("the specs passed but the smoke database holds no ready order, so the server did not use it");
    }
  } finally {
    db.close();
  }
}
