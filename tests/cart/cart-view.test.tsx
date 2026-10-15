import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToCartButton } from "../../src/cart/add-to-cart-button.tsx";
import { type Cart, EMPTY_CART, resolveCart } from "../../src/cart/cart.ts";
import { CartBadge } from "../../src/cart/cart-badge.tsx";
import { CartContents, CartView } from "../../src/cart/cart-view.tsx";
import type { MenuCategory } from "../../src/db/menu.ts";

const MENU: MenuCategory[] = [
  {
    id: "sicak-kahveler",
    name: "Sıcak Kahveler",
    products: [
      { id: "espresso", categoryId: "sicak-kahveler", name: "Espresso", description: "", priceKurus: 9000, isAvailable: true },
      { id: "latte", categoryId: "sicak-kahveler", name: "Latte", description: "", priceKurus: 13550, isAvailable: true },
    ],
  },
  {
    id: "soguk-icecekler",
    name: "Soğuk İçecekler",
    products: [
      { id: "cold-brew", categoryId: "soguk-icecekler", name: "Cold Brew", description: "", priceKurus: 12000, isAvailable: false },
    ],
  },
];

const noop = () => {};

interface ButtonProps {
  children?: unknown;
  onClick?: () => void;
}

function findButtons(node: unknown, found: ReactElement<ButtonProps>[] = []): ReactElement<ButtonProps>[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      findButtons(child, found);
    }
  } else if (isValidElement<ButtonProps>(node)) {
    if (node.type === "button") {
      found.push(node);
    }
    findButtons(node.props.children, found);
  }
  return found;
}

function renderCart(cart: Cart): string {
  return renderToStaticMarkup(<CartContents lines={resolveCart(cart, MENU)} onSetQuantity={noop} onRemove={noop} />);
}

function lineItem(html: string, heading: string): string {
  const start = html.indexOf(`<h2>${heading}</h2>`);
  return html.slice(start, html.indexOf("</li>", start));
}

describe("CartContents", () => {
  it("shows 'Sepetiniz boş' with a link back to the menu for an empty cart", () => {
    const html = renderCart(EMPTY_CART);
    expect(html).toContain("Sepetiniz boş.");
    expect(html).toContain('<a href="/">Menüye dön</a>');
    expect(html).not.toContain("Toplam");
  });

  it("lists stored lines matched to the menu with increase, decrease and remove controls and the total", () => {
    const html = renderCart([
      { productId: "espresso", quantity: 2 },
      { productId: "latte", quantity: 1 },
    ]);
    const espresso = lineItem(html, "Espresso");
    expect(espresso).toContain("Birim fiyat: ₺90,00");
    expect(espresso).toContain("Adet: 2");
    expect(espresso).toContain("Ara toplam: ₺180,00");
    expect(espresso).toContain('aria-label="Espresso adedini azalt"');
    expect(espresso).toContain('aria-label="Espresso adedini artır"');
    expect(espresso).toContain("Sepetten çıkar");
    expect(html).toContain("Toplam: ₺315,50");
  });

  it("disables decrease at quantity 1 and increase at quantity 20", () => {
    const html = renderCart([
      { productId: "espresso", quantity: 1 },
      { productId: "latte", quantity: 20 },
    ]);
    expect(lineItem(html, "Espresso")).toContain('aria-label="Espresso adedini azalt" disabled=""');
    expect(lineItem(html, "Espresso")).toContain('aria-label="Espresso adedini artır">');
    expect(lineItem(html, "Latte")).toContain('aria-label="Latte adedini artır" disabled=""');
  });

  it("flags unavailable and missing products, keeps them removable and leaves them out of the total", () => {
    const html = renderCart([
      { productId: "espresso", quantity: 1 },
      { productId: "cold-brew", quantity: 2 },
      { productId: "<img src=x>", quantity: 3 },
    ]);
    const coldBrew = lineItem(html, "Cold Brew");
    expect(coldBrew).toContain("Satışta değil. Toplama dahil edilmedi.");
    expect(coldBrew).toContain("Sepetten çıkar");
    expect(coldBrew).not.toContain("adedini artır");
    const missing = lineItem(html, "Ürün bulunamadı");
    expect(missing).toContain("Bu ürün artık menüde yok (kod: &lt;img src=x&gt;)");
    expect(missing).toContain("Sepetten çıkar");
    expect(html).not.toContain("<img");
    expect(html).toContain("Toplam: ₺90,00");
  });

  it("calls the handlers with the line's product id and the next quantity", () => {
    const onSetQuantity = vi.fn();
    const onRemove = vi.fn();
    const element = CartContents({
      lines: resolveCart([{ productId: "espresso", quantity: 3 }], MENU),
      onSetQuantity,
      onRemove,
    });
    const buttons = findButtons(element);
    const byLabel = (text: string) => buttons.find((button) => button.props.children === text);
    byLabel("−")?.props.onClick?.();
    byLabel("+")?.props.onClick?.();
    byLabel("Sepetten çıkar")?.props.onClick?.();
    expect(onSetQuantity.mock.calls).toEqual([
      ["espresso", 2],
      ["espresso", 4],
    ]);
    expect(onRemove).toHaveBeenCalledWith("espresso");
  });
});

describe("browser cart before it is read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a loading state on the server instead of an empty cart", () => {
    const html = renderToStaticMarkup(<CartView menu={MENU} />);
    expect(html).toContain("Sepet yükleniyor…");
    expect(html).not.toContain("Sepetiniz boş");
  });

  it("renders no badge count on the server instead of 0", () => {
    expect(renderToStaticMarkup(<CartBadge />)).toBe("");
  });

  it("renders without throwing when localStorage throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => renderToStaticMarkup(<CartView menu={MENU} />)).not.toThrow();
    expect(() => renderToStaticMarkup(<CartBadge />)).not.toThrow();
  });
});

describe("AddToCartButton", () => {
  it("is enabled for an available product and disabled for an unavailable one", () => {
    expect(renderToStaticMarkup(<AddToCartButton productId="espresso" isAvailable />)).toContain(
      '<button type="button" class="button">Sepete ekle</button>',
    );
    expect(renderToStaticMarkup(<AddToCartButton productId="cold-brew" isAvailable={false} />)).toContain(
      '<button type="button" class="button" disabled="">Sepete ekle</button>',
    );
  });
});
