import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addProduct,
  createProduct,
  editProduct,
  findProductById,
  generateProductId,
  readProductById,
  updateProduct,
} from "../../src/db/admin-products.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { getMenu } from "../../src/db/menu.ts";
import { createOrder, findOrderByTrackingToken } from "../../src/db/orders.ts";
import { type OrderRequest, parseOrderRequest } from "../../src/orders/order-request.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const NEW_PRODUCT = {
  categoryId: "sicak-kahveler",
  name: "Flat White",
  description: "Çift shot espresso ve ince süt.",
  priceKurus: 14000,
  isAvailable: true,
};

function orderRequest(productId: string, idempotencyKey: string): OrderRequest {
  const parsed = parseOrderRequest({ customerName: "Ayşe", items: [{ productId, quantity: 2 }], idempotencyKey });
  if (!parsed.ok) {
    throw new Error(`invalid test request: ${parsed.code}`);
  }
  return parsed.request;
}

function menuProduct(db: DatabaseSync, id: string) {
  return getMenu(db)
    .flatMap((category) => category.products)
    .find((product) => product.id === id);
}

describe("admin product writes", () => {
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

  it("generates URL-safe ids within the product id rule", () => {
    const id = generateProductId();
    expect(id).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(generateProductId()).not.toBe(id);
  });

  it("creates a product at the end of its category with 0/1 availability", () => {
    const result = createProduct(db, { ...NEW_PRODUCT, isAvailable: false }, () => "flat-white");
    expect(result).toEqual({
      status: "created",
      product: { id: "flat-white", ...NEW_PRODUCT, isAvailable: false },
    });
    expect(db.prepare("SELECT is_available, sort_order FROM products WHERE id = 'flat-white'").get()).toEqual({
      is_available: 0,
      sort_order: 6,
    });
    expect(getMenu(db)[0]?.products.at(-1)?.id).toBe("flat-white");
  });

  it("regenerates an id that is already taken and never overwrites the existing product", () => {
    const ids = ["espresso", "flat-white"];
    const result = createProduct(db, NEW_PRODUCT, () => ids.shift() as string);
    expect(result.status === "created" && result.product.id).toBe("flat-white");
    expect(findProductById(db, "espresso")?.name).toBe("Espresso");
  });

  it("fails without writing when no unused id can be generated", () => {
    expect(() => createProduct(db, NEW_PRODUCT, () => "espresso")).toThrow("Could not generate an unused product id");
    expect(db.isTransaction).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS total FROM products").get()).toEqual({ total: 8 });
  });

  it("refuses an unknown category without writing", () => {
    expect(createProduct(db, { ...NEW_PRODUCT, categoryId: "tatlilar" })).toEqual({ status: "unknown_category" });
    expect(db.prepare("SELECT COUNT(*) AS total FROM products").get()).toEqual({ total: 8 });
  });

  it("updates only the fields present and keeps the id", () => {
    expect(updateProduct(db, "espresso", { priceKurus: 9500 })).toEqual({
      status: "updated",
      product: {
        id: "espresso",
        categoryId: "sicak-kahveler",
        name: "Espresso",
        description: "Yoğun ve aromalı tek shot espresso.",
        priceKurus: 9500,
        isAvailable: true,
      },
    });
    // A toggle from another tab keeps the price edited above.
    const toggled = updateProduct(db, "espresso", { isAvailable: false });
    expect(toggled.status === "updated" && toggled.product).toMatchObject({ priceKurus: 9500, isAvailable: false });
    expect(db.prepare("SELECT is_available FROM products WHERE id = 'espresso'").get()).toEqual({ is_available: 0 });
  });

  it("moves a product to another existing category and refuses an unknown one", () => {
    expect(updateProduct(db, "espresso", { categoryId: "soguk-icecekler" })).toMatchObject({
      status: "updated",
      product: { categoryId: "soguk-icecekler" },
    });
    expect(updateProduct(db, "espresso", { categoryId: "tatlilar", name: "X" })).toEqual({ status: "unknown_category" });
    expect(findProductById(db, "espresso")).toMatchObject({ categoryId: "soguk-icecekler", name: "Espresso" });
  });

  it("returns not_found for an unknown or out-of-bounds id", () => {
    expect(updateProduct(db, "yok", { name: "X" })).toEqual({ status: "not_found" });
    expect(updateProduct(db, "a".repeat(65), { name: "X" })).toEqual({ status: "not_found" });
    expect(updateProduct(db, "", { name: "X" })).toEqual({ status: "not_found" });
    expect(findProductById(db, "a".repeat(65))).toBeNull();
  });

  it("closing a product hides it from ordering, and reopening makes it orderable again", () => {
    updateProduct(db, "espresso", { isAvailable: false });
    expect(menuProduct(db, "espresso")?.isAvailable).toBe(false);
    expect(createOrder(db, orderRequest("espresso", "order_key_closed_0001"))).toEqual({
      status: "product_unavailable",
      productId: "espresso",
      productName: "Espresso",
    });

    updateProduct(db, "espresso", { isAvailable: true });
    expect(menuProduct(db, "espresso")?.isAvailable).toBe(true);
    expect(createOrder(db, orderRequest("espresso", "order_key_reopened_01")).status).toBe("created");
  });

  it("a product created as available can be ordered", () => {
    const created = createProduct(db, NEW_PRODUCT, () => "flat-white");
    expect(created.status).toBe("created");
    expect(createOrder(db, orderRequest("flat-white", "order_key_flatwhite01")).status).toBe("created");
  });

  it("renaming, repricing and closing a product leaves an earlier order's snapshots unchanged", () => {
    const placed = createOrder(db, orderRequest("espresso", "order_key_snapshot_01"));
    if (placed.status !== "created") {
      throw new Error("order not created");
    }
    const before = findOrderByTrackingToken(db, placed.order.trackingToken);
    expect(before).toMatchObject({ totalKurus: 18000, items: [{ name: "Espresso", unitPriceKurus: 9000, lineTotalKurus: 18000 }] });

    updateProduct(db, "espresso", { name: "Doppio", priceKurus: 20000, description: "Yeni", isAvailable: false });

    expect(findOrderByTrackingToken(db, placed.order.trackingToken)).toEqual(before);
    expect(
      db.prepare("SELECT product_name_snapshot, unit_price_kurus_snapshot, line_total_kurus FROM order_items").all(),
    ).toEqual([{ product_name_snapshot: "Espresso", unit_price_kurus_snapshot: 9000, line_total_kurus: 18000 }]);
    expect(db.prepare("SELECT total_kurus FROM orders").all()).toEqual([{ total_kurus: 18000 }]);
  });

  it("opens and closes the database in the env-based wrappers", () => {
    const created = addProduct(NEW_PRODUCT);
    expect(created.status).toBe("created");
    const id = created.status === "created" ? created.product.id : "";
    expect(editProduct(id, { name: "Flat White XL" })).toMatchObject({ status: "updated", product: { name: "Flat White XL" } });
    expect(readProductById(id)?.name).toBe("Flat White XL");
    expect(readProductById("a".repeat(65))).toBeNull();
    expect(editProduct("a".repeat(65), { name: "X" })).toEqual({ status: "not_found" });
  });
});
