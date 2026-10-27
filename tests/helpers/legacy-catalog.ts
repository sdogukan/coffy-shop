import type { DatabaseSync } from "node:sqlite";
import { CATEGORY_FIXTURES, PRODUCT_FIXTURES } from "../../src/db/catalog.ts";

// Seeds the fixture catalog with the column list a release before migration
// 0005 used (no contains_milk), for tests that start from an older schema.
// The current seedCatalog needs every migration applied first.
export function seedCatalogBefore0005(db: DatabaseSync): void {
  const insertCategory = db.prepare("INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)");
  const insertProduct = db.prepare(
    `INSERT INTO products (id, category_id, name, description, price_kurus, is_available, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const category of CATEGORY_FIXTURES) {
    insertCategory.run(category.id, category.name, category.sortOrder);
  }
  for (const product of PRODUCT_FIXTURES) {
    insertProduct.run(
      product.id,
      product.categoryId,
      product.name,
      product.description,
      product.priceKurus,
      product.isAvailable,
      product.sortOrder,
    );
  }
}
