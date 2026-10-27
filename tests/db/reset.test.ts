import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdminSession } from "../../src/db/admin-sessions.ts";
import { CATEGORY_FIXTURES, PRODUCT_FIXTURES, seedCatalog } from "../../src/db/catalog.ts";
import { listMigrations, runMigrations } from "../../src/db/migrate.ts";
import { createOrder } from "../../src/db/orders.ts";
import { resetDatabase } from "../../src/db/reset.ts";
import { parseOrderRequest } from "../../src/orders/order-request.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
}

function schema(db: DatabaseSync) {
  return db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
}

function catalog(db: DatabaseSync) {
  return {
    categories: db.prepare("SELECT id, name, sort_order FROM categories ORDER BY id").all(),
    products: db
      .prepare(
        "SELECT id, category_id, name, description, price_kurus, is_available, contains_milk, sort_order FROM products ORDER BY id",
      )
      .all(),
  };
}

function fixtureCatalog() {
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
  return {
    categories: [...CATEGORY_FIXTURES].sort(byId).map((c) => ({ id: c.id, name: c.name, sort_order: c.sortOrder })),
    products: [...PRODUCT_FIXTURES].sort(byId).map((p) => ({
      id: p.id,
      category_id: p.categoryId,
      name: p.name,
      description: p.description,
      price_kurus: p.priceKurus,
      is_available: p.isAvailable,
      contains_milk: p.containsMilk,
      sort_order: p.sortOrder,
    })),
  };
}

function placeOrder(db: DatabaseSync, idempotencyKey: string): void {
  const parsed = parseOrderRequest({
    customerName: "Ayşe",
    items: [{ productId: "espresso", quantity: 2 }],
    idempotencyKey,
  });
  if (!parsed.ok || createOrder(db, parsed.request).status !== "created") {
    throw new Error("test order was not created");
  }
}

describe("resetDatabase", () => {
  let temp: TempDatabase;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempDatabase();
    db = openMigratedDatabase();
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it("wipes orders, sessions and menu edits and restores the fixtures with every migration recorded", () => {
    seedCatalog(db);
    placeOrder(db, "reset_order_key_0001");
    placeOrder(db, "reset_order_key_0002");
    createAdminSession(db, "a".repeat(64));
    db.prepare("UPDATE products SET price_kurus = 1, name = 'Değişti' WHERE id = 'espresso'").run();
    db.prepare("INSERT INTO products (id, category_id, name, price_kurus) VALUES ('extra', 'sicak-kahveler', 'Ekstra', 500)").run();
    db.prepare("INSERT INTO categories (id, name) VALUES ('ekstra', 'Ekstra')").run();
    expect(count(db, "orders")).toBe(2);

    expect(resetDatabase(db)).toEqual({ migrationsApplied: listMigrations(), categoriesInserted: 2, productsInserted: 8 });

    expect(catalog(db)).toEqual(fixtureCatalog());
    expect(count(db, "orders")).toBe(0);
    expect(count(db, "order_items")).toBe(0);
    expect(count(db, "admin_sessions")).toBe(0);
    expect(db.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map((row) => row.name)).toEqual(
      listMigrations(),
    );
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.isTransaction).toBe(false);
  });

  it("leaves the same schema as a fresh migrate, dropping tables and views no migration created", () => {
    const fresh = new DatabaseSync(":memory:");
    try {
      runMigrations(fresh);
      db.exec("CREATE TABLE leftover (id INTEGER PRIMARY KEY)");
      db.exec('CREATE VIEW "odd ""name""" AS SELECT id FROM leftover');

      resetDatabase(db);

      expect(schema(db)).toEqual(schema(fresh));
    } finally {
      fresh.close();
    }
  });

  it("resets an empty migrated database and is repeatable", () => {
    expect(resetDatabase(db)).toMatchObject({ categoriesInserted: 2, productsInserted: 8 });
    expect(resetDatabase(db)).toMatchObject({ categoriesInserted: 2, productsInserted: 8 });
    expect(catalog(db)).toEqual(fixtureCatalog());
  });

  it("drops nothing when it cannot take the write lock", () => {
    seedCatalog(db);
    placeOrder(db, "reset_order_key_0003");
    const blocked = new DatabaseSync(temp.path, { timeout: 50 });
    db.exec("BEGIN IMMEDIATE");
    try {
      expect(() => resetDatabase(blocked)).toThrow(/locked/);
      expect(blocked.isTransaction).toBe(false);
    } finally {
      db.exec("COMMIT");
      blocked.close();
    }
    expect(count(db, "orders")).toBe(1);
    expect(count(db, "products")).toBe(8);
    expect(count(db, "schema_migrations")).toBe(listMigrations().length);
  });
});
