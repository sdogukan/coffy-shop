import { seedCatalog } from "../db/catalog.ts";
import { openDatabase } from "../db/connection.ts";
import { runCli } from "./run.ts";

await runCli("seed", () => {
  const db = openDatabase();
  try {
    const { categoriesInserted, productsInserted } = seedCatalog(db);
    console.log(`Seed inserted ${categoriesInserted} categories and ${productsInserted} products`);
  } finally {
    db.close();
  }
});
