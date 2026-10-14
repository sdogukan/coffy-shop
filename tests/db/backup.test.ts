import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabase } from "../../src/db/backup.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

describe("backupDatabase", () => {
  let temp: TempDatabase;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempDatabase();
    db = openMigratedDatabase();
    seedCatalog(db);
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it("writes a readable copy of the live database", async () => {
    const destination = join(temp.dir, "backup.sqlite");
    await backupDatabase(db, destination);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      expect(copy.prepare("SELECT COUNT(*) AS total FROM products").get()).toEqual({ total: 8 });
      expect(copy.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get()).toEqual({ total: 1 });
    } finally {
      copy.close();
    }
  });

  it("never overwrites an existing file, including the source database", async () => {
    const destination = join(temp.dir, "existing.sqlite");
    writeFileSync(destination, "keep me");
    await expect(backupDatabase(db, destination)).rejects.toThrow("already exists");
    await expect(backupDatabase(db, temp.path)).rejects.toThrow("already exists");
  });

  it("rejects a relative destination", async () => {
    await expect(backupDatabase(db, "backup.sqlite")).rejects.toThrow("absolute path");
    expect(existsSync("backup.sqlite")).toBe(false);
  });

  it("removes a partial file when the backup fails", async () => {
    const destination = join(temp.dir, "missing-dir", "backup.sqlite");
    await expect(backupDatabase(db, destination)).rejects.toThrow();
    expect(existsSync(destination)).toBe(false);
  });
});
