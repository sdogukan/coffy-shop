import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRODUCT_FIXTURES, seedCatalog } from "../../src/db/catalog.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

interface ProductRow {
  id: string;
  category_id: string;
  name: string;
  price_kurus: number;
  is_available: number;
  price_type: string;
}

function products(db: DatabaseSync): ProductRow[] {
  return db
    .prepare(
      "SELECT id, category_id, name, price_kurus, is_available, typeof(price_kurus) AS price_type FROM products ORDER BY id",
    )
    .all() as unknown as ProductRow[];
}

function count(db: DatabaseSync, table: "categories" | "products"): number {
  return (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
}

describe("catalog seed", () => {
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

  it("seeds about eight products in at least two categories with an unavailable one and integer prices", () => {
    expect(seedCatalog(db)).toEqual({ categoriesInserted: 2, productsInserted: 8 });
    const rows = products(db);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((row) => row.category_id)).size).toBeGreaterThanOrEqual(2);
    expect(rows.filter((row) => row.is_available === 0).length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.price_type).toBe("integer");
      expect(Number.isInteger(row.price_kurus)).toBe(true);
    }
  });

  it("adds no rows when run again", () => {
    seedCatalog(db);
    expect(seedCatalog(db)).toEqual({ categoriesInserted: 0, productsInserted: 0 });
    expect(count(db, "categories")).toBe(2);
    expect(count(db, "products")).toBe(8);
  });

  it("keeps staff edits and re-inserts only deleted fixed-ID rows", () => {
    seedCatalog(db);
    db.prepare("UPDATE products SET name = ?, price_kurus = ?, is_available = ? WHERE id = ?").run(
      "Double Espresso",
      12345,
      0,
      "espresso",
    );
    db.prepare("DELETE FROM products WHERE id = ?").run("limonata");

    expect(seedCatalog(db)).toEqual({ categoriesInserted: 0, productsInserted: 1 });

    const byId = new Map(products(db).map((row) => [row.id, row]));
    expect(byId.get("espresso")).toMatchObject({ name: "Double Espresso", price_kurus: 12345, is_available: 0 });
    const limonata = PRODUCT_FIXTURES.find((product) => product.id === "limonata");
    expect(byId.get("limonata")).toMatchObject({ name: limonata?.name, price_kurus: limonata?.priceKurus });
  });
});
