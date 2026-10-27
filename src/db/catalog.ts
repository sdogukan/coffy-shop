import type { DatabaseSync } from "node:sqlite";

export interface CategoryFixture {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ProductFixture {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceKurus: number;
  isAvailable: 0 | 1;
  containsMilk: 0 | 1;
  sortOrder: number;
}

export const CATEGORY_FIXTURES: readonly CategoryFixture[] = [
  { id: "sicak-kahveler", name: "Sıcak Kahveler", sortOrder: 1 },
  { id: "soguk-icecekler", name: "Soğuk İçecekler", sortOrder: 2 },
];

export const PRODUCT_FIXTURES: readonly ProductFixture[] = [
  { id: "espresso", categoryId: "sicak-kahveler", name: "Espresso", description: "Yoğun ve aromalı tek shot espresso.", priceKurus: 9000, isAvailable: 1, containsMilk: 0, sortOrder: 1 },
  { id: "americano", categoryId: "sicak-kahveler", name: "Americano", description: "Sıcak su ile yumuşatılmış espresso.", priceKurus: 11000, isAvailable: 1, containsMilk: 0, sortOrder: 2 },
  { id: "cappuccino", categoryId: "sicak-kahveler", name: "Cappuccino", description: "Espresso, sıcak süt ve yoğun süt köpüğü.", priceKurus: 13000, isAvailable: 1, containsMilk: 1, sortOrder: 3 },
  { id: "caffe-latte", categoryId: "sicak-kahveler", name: "Caffè Latte", description: "Espresso, buharda ısıtılmış süt ve ince süt köpüğü.", priceKurus: 13500, isAvailable: 1, containsMilk: 1, sortOrder: 4 },
  { id: "turk-kahvesi", categoryId: "sicak-kahveler", name: "Türk Kahvesi", description: "Geleneksel yöntemle pişirilmiş Türk kahvesi.", priceKurus: 10000, isAvailable: 1, containsMilk: 0, sortOrder: 5 },
  { id: "iced-latte", categoryId: "soguk-icecekler", name: "Iced Latte", description: "Buz, soğuk süt ve espresso.", priceKurus: 14500, isAvailable: 1, containsMilk: 1, sortOrder: 1 },
  { id: "cold-brew", categoryId: "soguk-icecekler", name: "Cold Brew", description: "18 saat soğuk demlenmiş, yumuşak içimli kahve.", priceKurus: 15000, isAvailable: 0, containsMilk: 0, sortOrder: 2 },
  { id: "limonata", categoryId: "soguk-icecekler", name: "Ev Yapımı Limonata", description: "Taze sıkılmış limon ve nane ile.", priceKurus: 9500, isAvailable: 1, containsMilk: 0, sortOrder: 3 },
];

export interface SeedResult {
  categoriesInserted: number;
  productsInserted: number;
}

// Inserts only the fixture rows whose fixed ID is missing. Existing rows are
// never updated, so menu edits made by staff survive every re-seed.
function insertMissingFixtures(db: DatabaseSync): SeedResult {
  const insertCategory = db.prepare(
    "INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
  );
  const insertProduct = db.prepare(
    `INSERT INTO products (id, category_id, name, description, price_kurus, is_available, contains_milk, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
  );
  let categoriesInserted = 0;
  let productsInserted = 0;
  for (const category of CATEGORY_FIXTURES) {
    categoriesInserted += Number(insertCategory.run(category.id, category.name, category.sortOrder).changes);
  }
  for (const product of PRODUCT_FIXTURES) {
    productsInserted += Number(
      insertProduct.run(
        product.id,
        product.categoryId,
        product.name,
        product.description,
        product.priceKurus,
        product.isAvailable,
        product.containsMilk,
        product.sortOrder,
      ).changes,
    );
  }
  return { categoriesInserted, productsInserted };
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

export function seedCatalog(db: DatabaseSync): SeedResult {
  return inTransaction(db, () => insertMissingFixtures(db));
}
