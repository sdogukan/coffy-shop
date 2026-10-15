import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/connection.ts";
import { listMigrations, runMigrations } from "../../src/db/migrate.ts";
import { createTempDatabase, type TempDatabase } from "../helpers/temp-database.ts";

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (row) => row.name,
  );
}

describe("runMigrations", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("leaves exactly the catalog and order tables and records each migration once when run twice", () => {
    const first = openDatabase({ create: true });
    expect(runMigrations(first)).toEqual(listMigrations());
    first.close();

    const second = openDatabase({ create: true });
    try {
      expect(runMigrations(second)).toEqual([]);
      expect(tableNames(second)).toEqual(["categories", "order_items", "orders", "products", "schema_migrations"]);
      const recorded = second.prepare("SELECT name FROM schema_migrations ORDER BY name").all();
      expect(recorded).toEqual(listMigrations().map((name) => ({ name })));
    } finally {
      second.close();
    }
  });

  it("enforces integer kuruş prices and 0/1 availability", () => {
    const db = openDatabase({ create: true });
    try {
      runMigrations(db);
      db.exec("INSERT INTO categories (id, name) VALUES ('c', 'Kahve')");
      const insert = db.prepare(
        "INSERT INTO products (id, category_id, name, price_kurus, is_available) VALUES (?, 'c', 'Test', ?, ?)",
      );
      expect(() => insert.run("p1", 12.5, 1)).toThrow();
      expect(() => insert.run("p2", "100", 1)).not.toThrow();
      expect(() => insert.run("p3", -1, 1)).toThrow();
      expect(() => insert.run("p4", 100, 2)).toThrow();
      expect(() => insert.run("p5", 100, 1)).not.toThrow();
      expect(db.prepare("SELECT typeof(price_kurus) AS type FROM products WHERE id = 'p2'").get()).toEqual({
        type: "integer",
      });
    } finally {
      db.close();
    }
  });

  describe("with a custom migrations directory", () => {
    let migrationsDir: string;

    beforeEach(() => {
      migrationsDir = mkdtempSync(join(tmpdir(), "coffy-migrations-"));
    });

    afterEach(() => {
      rmSync(migrationsDir, { recursive: true, force: true });
    });

    it("rolls back a failing migration file completely and does not record it", () => {
      writeFileSync(join(migrationsDir, "0001_ok.sql"), "CREATE TABLE first (id INTEGER);");
      writeFileSync(join(migrationsDir, "0002_broken.sql"), "CREATE TABLE second (id INTEGER); INSERT INTO missing VALUES (1);");
      const db = openDatabase({ create: true });
      try {
        expect(() => runMigrations(db, migrationsDir)).toThrow("Migration 0002_broken.sql failed");
        expect(db.isTransaction).toBe(false);
        expect(tableNames(db)).toEqual(["first", "schema_migrations"]);
        expect(db.prepare("SELECT name FROM schema_migrations").all()).toEqual([{ name: "0001_ok.sql" }]);
      } finally {
        db.close();
      }
    });

    it("applies files in name order", () => {
      writeFileSync(join(migrationsDir, "0002_add_column.sql"), "ALTER TABLE items ADD COLUMN label TEXT;");
      writeFileSync(join(migrationsDir, "0001_items.sql"), "CREATE TABLE items (id INTEGER);");
      const db = openDatabase({ create: true });
      try {
        expect(runMigrations(db, migrationsDir)).toEqual(["0001_items.sql", "0002_add_column.sql"]);
      } finally {
        db.close();
      }
    });

    it("refuses misnamed SQL files instead of skipping them", () => {
      writeFileSync(join(migrationsDir, "init.sql"), "CREATE TABLE items (id INTEGER);");
      expect(() => listMigrations(migrationsDir)).toThrow("init.sql");
    });
  });
});
