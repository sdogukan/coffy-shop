import type { DatabaseSync } from "node:sqlite";
import { type Env, openDatabase } from "./connection.ts";

// Prices stay integer kuruş here; formatting to TRY belongs to the UI.
export interface MenuProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceKurus: number;
  isAvailable: boolean;
  containsMilk: boolean;
}

export interface MenuCategory {
  id: string;
  name: string;
  products: MenuProduct[];
}

interface MenuRow {
  category_id: string;
  category_name: string;
  product_id: string | null;
  product_name: string | null;
  description: string | null;
  price_kurus: number | null;
  is_available: number | null;
  contains_milk: number | null;
}

// One query for the whole menu. The LEFT JOIN keeps a category that has no
// products yet, so it still shows up (with an empty list).
const MENU_QUERY = `
  SELECT c.id AS category_id, c.name AS category_name,
         p.id AS product_id, p.name AS product_name, p.description, p.price_kurus, p.is_available,
         p.contains_milk
  FROM categories c
  LEFT JOIN products p ON p.category_id = c.id
  ORDER BY c.sort_order, c.id, p.sort_order, p.id`;

export function getMenu(db: DatabaseSync): MenuCategory[] {
  const rows = db.prepare(MENU_QUERY).all() as unknown as MenuRow[];
  const categories: MenuCategory[] = [];
  let current: MenuCategory | undefined;
  for (const row of rows) {
    if (current?.id !== row.category_id) {
      current = { id: row.category_id, name: row.category_name, products: [] };
      categories.push(current);
    }
    if (row.product_id !== null) {
      current.products.push({
        id: row.product_id,
        categoryId: row.category_id,
        name: row.product_name ?? "",
        description: row.description ?? "",
        priceKurus: Number(row.price_kurus),
        isAvailable: row.is_available === 1,
        containsMilk: row.contains_milk === 1,
      });
    }
  }
  return categories;
}

// Opens the existing database (never creates it, so a wrong path fails
// instead of serving an empty menu), reads the menu and always closes the
// connection. Errors propagate to the caller.
export function readMenu(env: Env = process.env): MenuCategory[] {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return getMenu(db);
  } finally {
    db?.close();
  }
}
