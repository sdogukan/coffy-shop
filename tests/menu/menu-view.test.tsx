import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MenuCategory } from "../../src/db/menu.ts";
import { MenuView } from "../../src/menu/menu-view.tsx";

const MENU: MenuCategory[] = [
  {
    id: "sicak-kahveler",
    name: "Sıcak Kahveler",
    products: [
      { id: "espresso", categoryId: "sicak-kahveler", name: "Espresso", description: "Yoğun tek shot.", priceKurus: 9000, isAvailable: true },
    ],
  },
  {
    id: "soguk-icecekler",
    name: "Soğuk İçecekler",
    products: [
      { id: "cold-brew", categoryId: "soguk-icecekler", name: "Cold Brew", description: "Soğuk demleme.", priceKurus: 12050, isAvailable: false },
    ],
  },
  { id: "tatlilar", name: "Tatlılar", products: [] },
];

function productItem(html: string, name: string): string {
  const start = html.indexOf(`<h3>${name}</h3>`);
  return html.slice(start, html.indexOf("</li>", start));
}

describe("MenuView", () => {
  it("renders every category as a heading with its products' name, description, TRY price and availability", () => {
    const html = renderToStaticMarkup(<MenuView menu={MENU} />);
    expect(html).toContain('<h2 id="kategori-sicak-kahveler">Sıcak Kahveler</h2>');
    expect(html).toContain('<h2 id="kategori-soguk-icecekler">Soğuk İçecekler</h2>');
    expect(html).toContain('<h2 id="kategori-tatlilar">Tatlılar</h2>');
    expect(html).toContain("Bu kategoride henüz ürün yok.");

    const espresso = productItem(html, "Espresso");
    expect(espresso).toContain("Yoğun tek shot.");
    expect(espresso).toContain('<p class="product-price">₺90,00</p>');
    expect(espresso).toContain('<p class="product-availability">Satışta</p>');
    expect(espresso).toMatch(/<button type="button" class="button">Sepete ekle<\/button>/);
  });

  it("shows 'Satışta değil' and a disabled add button for an unavailable product", () => {
    const coldBrew = productItem(renderToStaticMarkup(<MenuView menu={MENU} />), "Cold Brew");
    expect(coldBrew).toContain('<p class="product-price">₺120,50</p>');
    expect(coldBrew).toContain('<p class="product-availability">Satışta değil</p>');
    expect(coldBrew).toMatch(/<button type="button" class="button" disabled="">Sepete ekle<\/button>/);
  });

  it("escapes product text instead of rendering it as markup", () => {
    const menu: MenuCategory[] = [
      {
        id: "c",
        name: "Kategori",
        products: [
          { id: "p", categoryId: "c", name: "<script>x</script>", description: "<b>d</b>", priceKurus: 100, isAvailable: true },
        ],
      },
    ];
    const html = renderToStaticMarkup(<MenuView menu={menu} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("says the menu is empty when there are no categories", () => {
    expect(renderToStaticMarkup(<MenuView menu={[]} />)).toContain("Menü şu anda boş.");
  });
});
