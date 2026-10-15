import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import RootLayout from "../../app/layout.tsx";
import HomePage, { dynamic } from "../../app/page.tsx";
import { seedCatalog } from "../../src/db/catalog.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

describe("menu page", () => {
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

  it("lists the seeded categories in order with their products, TRY prices and availability", () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain("<h1>Menü</h1>");
    const hot = html.indexOf(">Sıcak Kahveler</h2>");
    const cold = html.indexOf(">Soğuk İçecekler</h2>");
    expect(hot).toBeGreaterThan(-1);
    expect(cold).toBeGreaterThan(hot);
    expect(html).toContain("<h3>Espresso</h3>");
    expect(html).toContain("Yoğun ve aromalı tek shot espresso.");
    expect(html).toContain('<p class="product-price">₺90,00</p>');

    const coldBrewStart = html.indexOf("<h3>Cold Brew</h3>");
    const coldBrew = html.slice(coldBrewStart, html.indexOf("</li>", coldBrewStart));
    expect(coldBrew).toContain("Satışta değil");
    expect(coldBrew).toContain('disabled="">Sepete ekle</button>');
  });

  it("fails instead of serving an empty menu when the database is missing", () => {
    temp.cleanup();
    expect(() => renderToStaticMarkup(<HomePage />)).toThrow();
  });
});

describe("root layout", () => {
  it("declares Turkish as the document language", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main />
      </RootLayout>,
    );
    expect(html).toContain('<html lang="tr">');
  });

  it("has a top bar linking to the menu and to the cart, without a count before the cart is read", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main />
      </RootLayout>,
    );
    expect(html).toContain('<a class="top-bar-brand" href="/">Coffy Shop</a>');
    expect(html).toContain('<a class="top-bar-cart" href="/sepet">Sepet </a>');
  });
});
