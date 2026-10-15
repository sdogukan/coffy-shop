import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type Env, openDatabase } from "./connection.ts";
import type { MenuProduct } from "./menu.ts";

// Staff edits to the catalog. Products are created and updated, never deleted,
// and nothing here touches orders or order_items: an order keeps the name and
// price snapshots it was placed with.

// Same bound as the products.id column and the cart's product id rule.
const MAX_PRODUCT_ID_LENGTH = 64;
// A collision of 64 random bits is not expected; the bound only guarantees
// the loop ends even with a broken generator.
const MAX_ID_ATTEMPTS = 5;

// Already validated by the caller (src/admin/product-input.ts).
export interface ProductFields {
  categoryId: string;
  name: string;
  description: string;
  priceKurus: number;
  isAvailable: boolean;
}

export type ProductPatch = Partial<ProductFields>;

export type CreateProductResult = { status: "created"; product: MenuProduct } | { status: "unknown_category" };

export type UpdateProductResult =
  | { status: "updated"; product: MenuProduct }
  | { status: "not_found" }
  | { status: "unknown_category" };

interface ProductRow {
  id: string;
  category_id: string;
  name: string;
  description: string;
  price_kurus: number;
  is_available: number;
}

// Column names come only from this list, never from request keys.
const PATCH_COLUMNS: readonly (readonly [keyof ProductFields, string])[] = [
  ["categoryId", "category_id"],
  ["name", "name"],
  ["description", "description"],
  ["priceKurus", "price_kurus"],
  ["isAvailable", "is_available"],
];

// 16 lowercase hex characters: URL-safe and within the 1-64 product id rule.
export function generateProductId(): string {
  return randomBytes(8).toString("hex");
}

function isProductId(value: string): boolean {
  return value.length >= 1 && value.length <= MAX_PRODUCT_ID_LENGTH;
}

function toProduct(row: ProductRow): MenuProduct {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    priceKurus: Number(row.price_kurus),
    isAvailable: row.is_available === 1,
  };
}

// availability is stored as exactly 0 or 1, which both getMenu and
// createOrder read as "is_available = 1 means orderable".
function toColumnValue(field: keyof ProductFields, value: ProductFields[keyof ProductFields]): string | number {
  if (field === "isAvailable") {
    return value === true ? 1 : 0;
  }
  return value as string | number;
}

function categoryExists(db: DatabaseSync, categoryId: string): boolean {
  return db.prepare("SELECT 1 FROM categories WHERE id = ?").get(categoryId) !== undefined;
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}

// An id outside the column's bounds never reaches SQLite.
export function findProductById(db: DatabaseSync, id: string): MenuProduct | null {
  if (!isProductId(id)) {
    return null;
  }
  const row = db
    .prepare("SELECT id, category_id, name, description, price_kurus, is_available FROM products WHERE id = ?")
    .get(id) as ProductRow | undefined;
  return row === undefined ? null : toProduct(row);
}

// Inserts the product at the end of its category. The category check, the id
// check and the insert run under one write lock, so a generated id is never
// taken by another writer in between and an existing product is never
// overwritten.
export function createProduct(
  db: DatabaseSync,
  fields: ProductFields,
  generateId: () => string = generateProductId,
): CreateProductResult {
  return inTransaction(db, () => {
    if (!categoryExists(db, fields.categoryId)) {
      return { status: "unknown_category" };
    }
    let id: string | undefined;
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && id === undefined; attempt += 1) {
      const candidate = generateId();
      if (isProductId(candidate) && db.prepare("SELECT 1 FROM products WHERE id = ?").get(candidate) === undefined) {
        id = candidate;
      }
    }
    if (id === undefined) {
      throw new Error("Could not generate an unused product id");
    }
    const { next } = db
      .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM products WHERE category_id = ?")
      .get(fields.categoryId) as { next: number };
    db.prepare(
      `INSERT INTO products (id, category_id, name, description, price_kurus, is_available, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      fields.categoryId,
      fields.name,
      fields.description,
      fields.priceKurus,
      toColumnValue("isAvailable", fields.isAvailable),
      Number(next),
    );
    return { status: "created", product: findProductById(db, id) as MenuProduct };
  });
}

// Writes only the fields present in the patch, so an availability toggle from
// one tab never overwrites a name edited in another (last write wins per
// field). The id itself is never changed.
export function updateProduct(db: DatabaseSync, id: string, patch: ProductPatch): UpdateProductResult {
  if (!isProductId(id)) {
    return { status: "not_found" };
  }
  return inTransaction(db, () => {
    if (findProductById(db, id) === null) {
      return { status: "not_found" };
    }
    if (patch.categoryId !== undefined && !categoryExists(db, patch.categoryId)) {
      return { status: "unknown_category" };
    }
    const present = PATCH_COLUMNS.filter(([field]) => patch[field] !== undefined);
    if (present.length > 0) {
      db.prepare(`UPDATE products SET ${present.map(([, column]) => `${column} = ?`).join(", ")} WHERE id = ?`).run(
        ...present.map(([field]) => toColumnValue(field, patch[field] as ProductFields[typeof field])),
        id,
      );
    }
    return { status: "updated", product: findProductById(db, id) as MenuProduct };
  });
}

// The functions below open the existing database (never create it), do one
// operation and always close the connection. Errors propagate to the caller.

export function readProductById(id: string, env: Env = process.env): MenuProduct | null {
  if (!isProductId(id)) {
    return null;
  }
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return findProductById(db, id);
  } finally {
    db?.close();
  }
}

export function addProduct(fields: ProductFields, env: Env = process.env): CreateProductResult {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return createProduct(db, fields);
  } finally {
    db?.close();
  }
}

export function editProduct(id: string, patch: ProductPatch, env: Env = process.env): UpdateProductResult {
  if (!isProductId(id)) {
    return { status: "not_found" };
  }
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return updateProduct(db, id, patch);
  } finally {
    db?.close();
  }
}
