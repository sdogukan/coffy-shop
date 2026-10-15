import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CartPage, { dynamic } from "../../app/sepet/page.tsx";
import { seedCatalog } from "../../src/db/catalog.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

describe("cart page", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
    const db = openMigratedDatabase();
    seedCatalog(db);
    db.close();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("is rendered per request, never prerendered at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("reads the menu and renders the cart heading with a loading state until the browser cart is read", () => {
    const html = renderToStaticMarkup(<CartPage />);
    expect(html).toContain("<h1>Sepet</h1>");
    expect(html).toContain("Sepet yükleniyor…");
    expect(html).not.toContain("Sepetiniz boş");
  });
});
