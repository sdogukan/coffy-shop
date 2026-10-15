import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCT_FIXTURES, seedCatalog } from "../../src/db/catalog.ts";
import { DATABASE_PATH_ENV } from "../../src/db/connection.ts";
import { getMenu, readMenu } from "../../src/db/menu.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

function seededDatabase(): DatabaseSync {
  const db = openMigratedDatabase();
  seedCatalog(db);
  return db;
}

describe("getMenu", () => {
  let temp: TempDatabase;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempDatabase();
    db = seededDatabase();
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it("orders categories and their products by sort_order", () => {
    const menu = getMenu(db);
    expect(menu.map((category) => category.name)).toEqual(["Sıcak Kahveler", "Soğuk İçecekler"]);
    expect(menu[0]?.products.map((product) => product.id)).toEqual([
      "espresso",
      "americano",
      "cappuccino",
      "caffe-latte",
      "turk-kahvesi",
    ]);
    expect(menu[1]?.products.map((product) => product.id)).toEqual(["iced-latte", "cold-brew", "limonata"]);
  });

  it("follows sort_order rather than insertion order and breaks ties by id", () => {
    db.prepare("UPDATE categories SET sort_order = 0 WHERE id = 'soguk-icecekler'").run();
    db.prepare("UPDATE products SET sort_order = 9 WHERE id = 'espresso'").run();
    db.prepare("UPDATE products SET sort_order = 2 WHERE id = 'cappuccino'").run();

    const menu = getMenu(db);
    expect(menu.map((category) => category.id)).toEqual(["soguk-icecekler", "sicak-kahveler"]);
    expect(menu[1]?.products.map((product) => product.id)).toEqual([
      "americano",
      "cappuccino",
      "caffe-latte",
      "turk-kahvesi",
      "espresso",
    ]);
  });

  it("maps price_kurus to integer priceKurus and the row to the MenuProduct shape", () => {
    const products = getMenu(db).flatMap((category) => category.products);
    expect(products).toHaveLength(PRODUCT_FIXTURES.length);
    expect(products[0]).toEqual({
      id: "espresso",
      categoryId: "sicak-kahveler",
      name: "Espresso",
      description: "Yoğun ve aromalı tek shot espresso.",
      priceKurus: 9000,
      isAvailable: true,
    });
    for (const product of products) {
      expect(Number.isInteger(product.priceKurus)).toBe(true);
      expect(product.priceKurus).toBe(PRODUCT_FIXTURES.find((fixture) => fixture.id === product.id)?.priceKurus);
    }
  });

  it("maps is_available 0/1 to a boolean isAvailable", () => {
    const products = getMenu(db).flatMap((category) => category.products);
    const byId = new Map(products.map((product) => [product.id, product]));
    expect(byId.get("cold-brew")?.isAvailable).toBe(false);
    expect(byId.get("espresso")?.isAvailable).toBe(true);
    for (const product of products) {
      expect(typeof product.isAvailable).toBe("boolean");
    }
  });

  it("keeps a category without products as an empty list", () => {
    db.prepare("INSERT INTO categories (id, name, sort_order) VALUES ('tatlilar', 'Tatlılar', 3)").run();
    expect(getMenu(db).at(-1)).toEqual({ id: "tatlilar", name: "Tatlılar", products: [] });
  });

  it("returns an empty menu for an empty catalog", () => {
    db.exec("DELETE FROM products");
    db.exec("DELETE FROM categories");
    expect(getMenu(db)).toEqual([]);
  });
});

describe("readMenu", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    temp.cleanup();
  });

  it("reads the menu from the database at COFFY_DATABASE_PATH and closes the connection", () => {
    seededDatabase().close();
    const close = vi.spyOn(DatabaseSync.prototype, "close");

    const menu = readMenu({ [DATABASE_PATH_ENV]: temp.path });

    expect(menu.map((category) => category.id)).toEqual(["sicak-kahveler", "soguk-icecekler"]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the connection when the query fails", () => {
    // An empty file opens as a database but has no catalog tables.
    writeFileSync(temp.path, "");
    const close = vi.spyOn(DatabaseSync.prototype, "close");

    expect(() => readMenu({ [DATABASE_PATH_ENV]: temp.path })).toThrow(/no such table/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("throws for a missing file and does not create it", () => {
    expect(() => readMenu({ [DATABASE_PATH_ENV]: temp.path })).toThrow();
    expect(existsSync(temp.path)).toBe(false);
  });

  it("throws for a path in a directory that does not exist and does not create it", () => {
    const path = join(temp.dir, "missing-dir", "coffy.sqlite");
    expect(() => readMenu({ [DATABASE_PATH_ENV]: path })).toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it("throws when COFFY_DATABASE_PATH is unset", () => {
    expect(() => readMenu({})).toThrow("COFFY_DATABASE_PATH is not set");
  });

  it("defaults to process.env", () => {
    seededDatabase().close();
    expect(readMenu()).toHaveLength(2);
  });
});
