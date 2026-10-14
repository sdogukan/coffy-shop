import { resetCatalog } from "../db/catalog.ts";
import { openDatabase } from "../db/connection.ts";
import { runCli } from "./run.ts";

await runCli("reset", () => {
  const db = openDatabase();
  try {
    const { categoriesInserted, productsInserted } = resetCatalog(db);
    console.log(`Catalog reset to ${categoriesInserted} categories and ${productsInserted} products`);
  } finally {
    db.close();
  }
});
