import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedCatalog } from "../../src/db/catalog.ts";
import { DATABASE_PATH_ENV, openDatabase } from "../../src/db/connection.ts";
import { getMenu } from "../../src/db/menu.ts";
import { MIGRATIONS_DIR, listMigrations, runMigrations } from "../../src/db/migrate.ts";
import {
  addMilkOption,
  createMilkOption,
  editMilkOption,
  findMilkOptionById,
  generateMilkOptionId,
  getAvailableMilkOptions,
  readAvailableMilkOptions,
  updateMilkOption,
} from "../../src/db/milk-options.ts";
import { createOrder, findOrderByTrackingToken } from "../../src/db/orders.ts";
import { parseOrderRequest } from "../../src/orders/order-request.ts";
import { seedCatalogBefore0005 } from "../helpers/legacy-catalog.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const NORMAL_MILK = { id: "normal-sut", name: "Normal süt", surchargeKurus: 0, isDefault: true, isAvailable: true };

function placeOrder(db: DatabaseSync, idempotencyKey: string) {
  const parsed = parseOrderRequest({
    customerName: "Ayşe",
    items: [
      { productId: "cappuccino", quantity: 2 },
      { productId: "espresso", quantity: 1 },
    ],
    idempotencyKey,
  });
  if (!parsed.ok) {
    throw new Error(parsed.code);
  }
  const result = createOrder(db, parsed.request);
  if (result.status !== "created") {
    throw new Error(result.status);
  }
  return result.order;
}

function milkOptionRows(db: DatabaseSync) {
  return db.prepare("SELECT * FROM milk_options ORDER BY sort_order, id").all();
}

describe("milk option writes", () => {
  let temp: TempDatabase;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempDatabase();
    db = openMigratedDatabase();
    seedCatalog(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    temp.cleanup();
  });

  it("generates URL-safe ids within the id rule", () => {
    const id = generateMilkOptionId();
    expect(id).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(generateMilkOptionId()).not.toBe(id);
  });

  it("starts with only the default option, Normal süt", () => {
    expect(getAvailableMilkOptions(db)).toEqual([NORMAL_MILK]);
  });

  it("creates available, non-default options at the end of the list, each with its own id and position", () => {
    const ids = ["yulaf", "badem"];
    const oat = createMilkOption(db, { name: "Yulaf sütü", surchargeKurus: 1500 }, () => ids.shift() as string);
    const almond = createMilkOption(db, { name: "Badem sütü", surchargeKurus: 2000 }, () => ids.shift() as string);
    expect(oat).toEqual({ id: "yulaf", name: "Yulaf sütü", surchargeKurus: 1500, isDefault: false, isAvailable: true });
    expect(almond).toEqual({ id: "badem", name: "Badem sütü", surchargeKurus: 2000, isDefault: false, isAvailable: true });
    expect(db.prepare("SELECT id, sort_order FROM milk_options ORDER BY sort_order").all()).toEqual([
      { id: "normal-sut", sort_order: 0 },
      { id: "yulaf", sort_order: 1 },
      { id: "badem", sort_order: 2 },
    ]);
    expect(getAvailableMilkOptions(db).map((option) => option.id)).toEqual(["normal-sut", "yulaf", "badem"]);
  });

  it("regenerates an id that is already taken and never overwrites the existing option", () => {
    const ids = ["normal-sut", "a".repeat(65), "yulaf"];
    expect(createMilkOption(db, { name: "Yulaf sütü", surchargeKurus: 1500 }, () => ids.shift() as string).id).toBe("yulaf");
    expect(findMilkOptionById(db, "normal-sut")).toEqual(NORMAL_MILK);
  });

  it("fails without writing when no unused id can be generated", () => {
    expect(() => createMilkOption(db, { name: "Yulaf sütü", surchargeKurus: 1500 }, () => "normal-sut")).toThrow(
      "Could not generate an unused milk option id",
    );
    expect(db.isTransaction).toBe(false);
    expect(milkOptionRows(db)).toHaveLength(1);
  });

  it("updates only the fields present, so a surcharge edit keeps an availability change and the reverse", () => {
    createMilkOption(db, { name: "Yulaf sütü", surchargeKurus: 1500 }, () => "yulaf");
    expect(updateMilkOption(db, "yulaf", { isAvailable: false })).toEqual({
      status: "updated",
      milkOption: { id: "yulaf", name: "Yulaf sütü", surchargeKurus: 1500, isDefault: false, isAvailable: false },
    });
    expect(updateMilkOption(db, "yulaf", { surchargeKurus: 1750 })).toMatchObject({
      status: "updated",
      milkOption: { surchargeKurus: 1750, isAvailable: false },
    });
    expect(updateMilkOption(db, "yulaf", { surchargeKurus: 1800, isAvailable: true })).toMatchObject({
      status: "updated",
      milkOption: { surchargeKurus: 1800, isAvailable: true },
    });
  });

  it("removing an option (isAvailable false) hides it from the available list but keeps the row", () => {
    createMilkOption(db, { name: "Yulaf sütü", surchargeKurus: 1500 }, () => "yulaf");
    updateMilkOption(db, "yulaf", { isAvailable: false });
    expect(getAvailableMilkOptions(db)).toEqual([NORMAL_MILK]);
    expect(findMilkOptionById(db, "yulaf")).toMatchObject({ isAvailable: false });
  });

  it("lists the default first even when its position is after another option", () => {
    createMilkOption(db, { name: "Yulaf sütü", surchargeKurus: 1500 }, () => "yulaf");
    db.exec("UPDATE milk_options SET sort_order = 99 WHERE id = 'normal-sut'");
    expect(getAvailableMilkOptions(db).map((option) => option.id)).toEqual(["normal-sut", "yulaf"]);
  });

  it("refuses to change the default option and leaves it 0 kuruş and available", () => {
    expect(updateMilkOption(db, "normal-sut", { surchargeKurus: 500 })).toEqual({ status: "default_option" });
    expect(updateMilkOption(db, "normal-sut", { isAvailable: false })).toEqual({ status: "default_option" });
    expect(db.isTransaction).toBe(false);
    expect(findMilkOptionById(db, "normal-sut")).toEqual(NORMAL_MILK);
  });

  it("the table itself rejects a default row with a surcharge, a closed default and a second default", () => {
    expect(() => db.exec("UPDATE milk_options SET surcharge_kurus = 100 WHERE id = 'normal-sut'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE milk_options SET is_available = 0 WHERE id = 'normal-sut'")).toThrow(/CHECK/);
    expect(() =>
      db.exec("INSERT INTO milk_options (id, name, surcharge_kurus, is_default) VALUES ('ikinci', 'İkinci', 0, 1)"),
    ).toThrow(/UNIQUE/);
    expect(() =>
      db.exec("INSERT INTO milk_options (id, name, surcharge_kurus) VALUES ('kesirli', 'Kesirli', 12.5)"),
    ).toThrow();
    expect(milkOptionRows(db)).toHaveLength(1);
  });

  it("returns not_found for an unknown or out-of-bounds id", () => {
    expect(updateMilkOption(db, "yok", { isAvailable: false })).toEqual({ status: "not_found" });
    expect(updateMilkOption(db, "a".repeat(65), { isAvailable: false })).toEqual({ status: "not_found" });
    expect(updateMilkOption(db, "", { isAvailable: false })).toEqual({ status: "not_found" });
    expect(findMilkOptionById(db, "a".repeat(65))).toBeNull();
  });

  it("rolls back and rethrows when the write fails", () => {
    createMilkOption(db, { name: "Yulaf sütü", surchargeKurus: 1500 }, () => "yulaf");
    // A value the CHECK rejects, as a broken caller would send it.
    expect(() => updateMilkOption(db, "yulaf", { surchargeKurus: -1 })).toThrow(/CHECK/);
    expect(db.isTransaction).toBe(false);
    expect(findMilkOptionById(db, "yulaf")).toMatchObject({ surchargeKurus: 1500 });
  });

  it("changing a surcharge and removing an option leave an earlier order's total and items unchanged", () => {
    createMilkOption(db, { name: "Yulaf sütü", surchargeKurus: 1500 }, () => "yulaf");
    const placed = placeOrder(db, "milk_snapshot_key_001");
    const before = findOrderByTrackingToken(db, placed.trackingToken);
    const ordersBefore = db.prepare("SELECT * FROM orders").all();
    const itemsBefore = db.prepare("SELECT * FROM order_items ORDER BY product_id").all();

    updateMilkOption(db, "yulaf", { surchargeKurus: 4000 });
    updateMilkOption(db, "yulaf", { isAvailable: false });

    expect(findOrderByTrackingToken(db, placed.trackingToken)).toEqual(before);
    expect(db.prepare("SELECT * FROM orders").all()).toEqual(ordersBefore);
    expect(db.prepare("SELECT * FROM order_items ORDER BY product_id").all()).toEqual(itemsBefore);
  });

  it("opens and closes the database in the env-based wrappers", () => {
    const close = vi.spyOn(DatabaseSync.prototype, "close");
    const created = addMilkOption({ name: "Yulaf sütü", surchargeKurus: 1500 });
    expect(created).toMatchObject({ name: "Yulaf sütü", isDefault: false, isAvailable: true });
    expect(editMilkOption(created.id, { surchargeKurus: 1600 })).toMatchObject({ status: "updated", milkOption: { surchargeKurus: 1600 } });
    expect(readAvailableMilkOptions().map((option) => option.id)).toEqual(["normal-sut", created.id]);
    expect(editMilkOption("a".repeat(65), { isAvailable: false })).toEqual({ status: "not_found" });
    expect(close).toHaveBeenCalledTimes(3);
  });

  it("the wrappers throw for a missing database and do not create it", () => {
    const path = join(temp.dir, "missing.sqlite");
    expect(() => readAvailableMilkOptions({ [DATABASE_PATH_ENV]: path })).toThrow();
    expect(() => addMilkOption({ name: "Yulaf sütü", surchargeKurus: 1500 }, { [DATABASE_PATH_ENV]: path })).toThrow();
  });
});

describe("migration 0005_milk_options", () => {
  let temp: TempDatabase;
  let earlierMigrations: string;

  beforeEach(() => {
    temp = createTempDatabase();
    earlierMigrations = mkdtempSync(join(tmpdir(), "coffy-migrations-"));
    for (const name of listMigrations().filter((file) => file < "0005")) {
      copyFileSync(join(MIGRATIONS_DIR, name), join(earlierMigrations, name));
    }
  });

  afterEach(() => {
    rmSync(earlierMigrations, { recursive: true, force: true });
    temp.cleanup();
  });

  it("applies to a database migrated to 0004 that holds products and orders, and keeps the previous release's writes working", () => {
    const db = openDatabase({ create: true });
    try {
      runMigrations(db, earlierMigrations);
      seedCatalogBefore0005(db);
      const existing = placeOrder(db, "pre_0005_order_key_01");
      const before = findOrderByTrackingToken(db, existing.trackingToken);

      copyFileSync(join(MIGRATIONS_DIR, "0005_milk_options.sql"), join(earlierMigrations, "0005_milk_options.sql"));
      expect(runMigrations(db, earlierMigrations)).toEqual(["0005_milk_options.sql"]);

      const column = (db.prepare("PRAGMA table_info(products)").all() as { name: string; notnull: number; dflt_value: unknown }[]).find(
        (info) => info.name === "contains_milk",
      );
      expect(column).toMatchObject({ notnull: 1, dflt_value: "0" });
      expect(db.prepare("SELECT id, contains_milk FROM products ORDER BY id").all()).toEqual([
        { id: "americano", contains_milk: 0 },
        { id: "caffe-latte", contains_milk: 1 },
        { id: "cappuccino", contains_milk: 1 },
        { id: "cold-brew", contains_milk: 0 },
        { id: "espresso", contains_milk: 0 },
        { id: "iced-latte", contains_milk: 1 },
        { id: "limonata", contains_milk: 0 },
        { id: "turk-kahvesi", contains_milk: 0 },
      ]);
      expect(db.prepare("SELECT id, name, surcharge_kurus, is_default, is_available FROM milk_options").all()).toEqual([
        { id: "normal-sut", name: "Normal süt", surcharge_kurus: 0, is_default: 1, is_available: 1 },
      ]);
      expect(findOrderByTrackingToken(db, existing.trackingToken)).toEqual(before);

      // The previous release's createProduct column list (no contains_milk).
      db.prepare(
        `INSERT INTO products (id, category_id, name, description, price_kurus, is_available, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run("eski-surum", "sicak-kahveler", "Eski Sürüm", "", 5000, 1, 9);
      expect(db.prepare("SELECT contains_milk FROM products WHERE id = 'eski-surum'").get()).toEqual({ contains_milk: 0 });
      // The previous release's menu query (no contains_milk) still reads.
      expect(
        db.prepare("SELECT p.id, p.price_kurus, p.is_available FROM products p WHERE p.id = 'eski-surum'").get(),
      ).toEqual({ id: "eski-surum", price_kurus: 5000, is_available: 1 });
      placeOrder(db, "post_0005_order_key_1");
      expect(db.prepare("SELECT COUNT(*) AS total FROM orders").get()).toEqual({ total: 2 });
    } finally {
      db.close();
    }
  });

  it("a fresh migrate and seed marks the same three products and holds only Normal süt", () => {
    const db = openMigratedDatabase();
    try {
      seedCatalog(db);
      const marked = getMenu(db)
        .flatMap((category) => category.products)
        .filter((product) => product.containsMilk)
        .map((product) => product.id)
        .sort();
      expect(marked).toEqual(["caffe-latte", "cappuccino", "iced-latte"]);
      expect(getAvailableMilkOptions(db)).toEqual([NORMAL_MILK]);
    } finally {
      db.close();
    }
  });
});
