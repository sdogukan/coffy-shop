import { describe, expect, it } from "vitest";
import {
  addItem,
  type Cart,
  cartItemCount,
  cartTotalKurus,
  EMPTY_CART,
  parseStoredCart,
  removeItem,
  resolveCart,
  serializeCart,
  setQuantity,
} from "../../src/cart/cart.ts";
import type { MenuCategory } from "../../src/db/menu.ts";

const MENU: MenuCategory[] = [
  {
    id: "sicak-kahveler",
    name: "Sıcak Kahveler",
    products: [
      { id: "espresso", categoryId: "sicak-kahveler", name: "Espresso", description: "Tek shot.", priceKurus: 9000, isAvailable: true, containsMilk: false },
      { id: "latte", categoryId: "sicak-kahveler", name: "Latte", description: "Sütlü.", priceKurus: 13550, isAvailable: true, containsMilk: true },
    ],
  },
  {
    id: "soguk-icecekler",
    name: "Soğuk İçecekler",
    products: [
      { id: "cold-brew", categoryId: "soguk-icecekler", name: "Cold Brew", description: "Soğuk demleme.", priceKurus: 12000, isAvailable: false, containsMilk: false },
    ],
  },
];

const ESPRESSO = { id: "espresso", isAvailable: true };
const COLD_BREW = { id: "cold-brew", isAvailable: false };

function cart(...lines: [string, number][]): Cart {
  return lines.map(([productId, quantity]) => ({ productId, quantity }));
}

describe("addItem", () => {
  it("adds a new line with quantity 1 by default", () => {
    expect(addItem(EMPTY_CART, ESPRESSO)).toEqual([{ productId: "espresso", quantity: 1 }]);
  });

  it("merges into the existing line instead of adding a second one", () => {
    const next = addItem(cart(["espresso", 2], ["latte", 1]), ESPRESSO, 3);
    expect(next).toEqual(cart(["espresso", 5], ["latte", 1]));
  });

  it("rejects an unavailable product and returns the cart unchanged", () => {
    const current = cart(["espresso", 1]);
    expect(addItem(current, COLD_BREW)).toBe(current);
  });

  it.each([0, -1, 1.5, 21, Number.NaN, Number.POSITIVE_INFINITY])("rejects quantity %s", (quantity) => {
    const current = cart(["espresso", 1]);
    expect(addItem(current, ESPRESSO, quantity)).toBe(current);
  });

  it("accepts a merge up to exactly 20 and rejects one above 20", () => {
    expect(addItem(cart(["espresso", 19]), ESPRESSO)).toEqual(cart(["espresso", 20]));
    const full = cart(["espresso", 20]);
    expect(addItem(full, ESPRESSO)).toBe(full);
  });

  it("does not mutate the cart it was given", () => {
    const current = cart(["espresso", 1]);
    addItem(current, ESPRESSO);
    expect(current).toEqual(cart(["espresso", 1]));
  });
});

describe("setQuantity", () => {
  it("changes the quantity of an existing line", () => {
    expect(setQuantity(cart(["espresso", 1], ["latte", 2]), "latte", 20)).toEqual(cart(["espresso", 1], ["latte", 20]));
  });

  it.each([0, -1, 2.5, 21, Number.NaN])("rejects quantity %s and returns the cart unchanged", (quantity) => {
    const current = cart(["espresso", 3]);
    expect(setQuantity(current, "espresso", quantity)).toBe(current);
  });

  it("returns the cart unchanged for a product that is not in it", () => {
    const current = cart(["espresso", 3]);
    expect(setQuantity(current, "latte", 2)).toBe(current);
  });
});

describe("removeItem", () => {
  it("removes only the given line", () => {
    expect(removeItem(cart(["espresso", 1], ["latte", 2]), "espresso")).toEqual(cart(["latte", 2]));
  });

  it("returns the cart unchanged for a product that is not in it", () => {
    const current = cart(["espresso", 1]);
    expect(removeItem(current, "latte")).toBe(current);
  });
});

describe("parseStoredCart", () => {
  it("reads a valid stored cart", () => {
    expect(parseStoredCart('[{"productId":"espresso","quantity":2},{"productId":"latte","quantity":20}]')).toEqual(
      cart(["espresso", 2], ["latte", 20]),
    );
  });

  it.each([
    ["nothing stored", null],
    ["invalid JSON", "{not json"],
    ["an empty string", ""],
    ["an object", '{"productId":"espresso","quantity":1}'],
    ["a string", '"espresso"'],
    ["a number", "42"],
    ["JSON null", "null"],
  ])("returns an empty cart for %s", (_label, raw) => {
    expect(parseStoredCart(raw)).toEqual([]);
  });

  it("keeps only the valid lines of a partly corrupt array", () => {
    const raw = JSON.stringify([
      { productId: "espresso", quantity: 2 },
      null,
      "latte",
      [1, 2],
      { productId: 7, quantity: 1 },
      { productId: "", quantity: 1 },
      { productId: "x".repeat(65), quantity: 1 },
      { productId: "latte" },
      { productId: "latte", quantity: "2" },
      { productId: "latte", quantity: 0 },
      { productId: "latte", quantity: -3 },
      { productId: "latte", quantity: 1.5 },
      { productId: "latte", quantity: 21 },
      { productId: "mocha", quantity: 1, priceKurus: 1, name: "<b>x</b>" },
    ]);
    expect(parseStoredCart(raw)).toEqual(cart(["espresso", 2], ["mocha", 1]));
  });

  it("merges duplicate lines and drops a product whose merged quantity exceeds 20", () => {
    const raw = JSON.stringify([
      { productId: "espresso", quantity: 2 },
      { productId: "latte", quantity: 15 },
      { productId: "espresso", quantity: 3 },
      { productId: "latte", quantity: 6 },
    ]);
    expect(parseStoredCart(raw)).toEqual(cart(["espresso", 5]));
  });
});

describe("serializeCart", () => {
  it("stores only productId and quantity", () => {
    const withExtras = [{ productId: "espresso", quantity: 2, priceKurus: 1, name: "Espresso" }];
    expect(JSON.parse(serializeCart(withExtras))).toEqual([{ productId: "espresso", quantity: 2 }]);
  });

  it("round-trips through parseStoredCart", () => {
    const current = cart(["espresso", 2], ["latte", 1]);
    expect(parseStoredCart(serializeCart(current))).toEqual(current);
  });
});

describe("resolveCart and cartTotalKurus", () => {
  it("matches lines to the menu, flags unavailable and missing products and totals only orderable lines", () => {
    const lines = resolveCart(cart(["espresso", 2], ["cold-brew", 1], ["deleted", 3], ["latte", 1]), MENU);
    expect(lines.map((line) => [line.productId, line.status])).toEqual([
      ["espresso", "ok"],
      ["cold-brew", "unavailable"],
      ["deleted", "missing"],
      ["latte", "ok"],
    ]);
    expect(lines[0]).toMatchObject({ lineTotalKurus: 18000 });
    expect(cartTotalKurus(lines)).toBe(18000 + 13550);
  });

  it("uses the current menu price, never anything stored with the line", () => {
    const stored = [{ productId: "espresso", quantity: 1, priceKurus: 1 }];
    expect(cartTotalKurus(resolveCart(stored, MENU))).toBe(9000);
  });

  it("changes the total after add, quantity change and remove", () => {
    let current = addItem(EMPTY_CART, ESPRESSO);
    expect(cartTotalKurus(resolveCart(current, MENU))).toBe(9000);
    current = addItem(current, { id: "latte", isAvailable: true });
    expect(cartTotalKurus(resolveCart(current, MENU))).toBe(22550);
    current = setQuantity(current, "espresso", 3);
    expect(cartTotalKurus(resolveCart(current, MENU))).toBe(27000 + 13550);
    current = setQuantity(current, "espresso", 2);
    expect(cartTotalKurus(resolveCart(current, MENU))).toBe(18000 + 13550);
    current = removeItem(current, "latte");
    expect(cartTotalKurus(resolveCart(current, MENU))).toBe(18000);
  });

  it("totals an empty cart as 0", () => {
    expect(cartTotalKurus(resolveCart(EMPTY_CART, MENU))).toBe(0);
  });
});

describe("cartItemCount", () => {
  it("sums quantities over every stored line", () => {
    expect(cartItemCount(cart(["espresso", 2], ["cold-brew", 1], ["deleted", 3]))).toBe(6);
    expect(cartItemCount(EMPTY_CART)).toBe(0);
  });
});
