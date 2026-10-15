import type { DatabaseSync } from "node:sqlite";
import { seedCatalog } from "./catalog.ts";
import { runMigrations } from "./migrate.ts";

export interface ResetResult {
  migrationsApplied: string[];
  categoriesInserted: number;
  productsInserted: number;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

// Drops every table and view (schema_migrations included) in one write
// transaction, so a failed drop leaves the database as it was. Foreign keys
// are checked at COMMIT, when the referencing tables are gone as well.
function dropSchema(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("PRAGMA defer_foreign_keys = ON");
    const objects = db
      .prepare(
        "SELECT type, name FROM sqlite_schema WHERE type IN ('view', 'table') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type DESC",
      )
      .all() as { type: "view" | "table"; name: string }[];
    for (const { type, name } of objects) {
      db.exec(`DROP ${type === "view" ? "VIEW" : "TABLE"} ${quoteIdentifier(name)}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}

// Leaves the database exactly as a fresh migrate + seed would: the fixture
// catalog, no orders and no admin sessions. Only for local databases; the
// caller must have passed the path through assertResettableDatabasePath.
export function resetDatabase(db: DatabaseSync): ResetResult {
  dropSchema(db);
  const migrationsApplied = runMigrations(db);
  const { categoriesInserted, productsInserted } = seedCatalog(db);
  return { migrationsApplied, categoriesInserted, productsInserted };
}
