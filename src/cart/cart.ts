import type { MenuCategory, MenuProduct } from "../db/menu.ts";

// Pure cart rules, shared by the browser store and the tests. A cart holds
// only product ids and quantities: names, prices and availability always
// come from the current menu, never from what the browser stored.
export interface CartLine {
  readonly productId: string;
  readonly quantity: number;
}

export type Cart = readonly CartLine[];

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 20;
// Same bound as the products.id column.
const MAX_PRODUCT_ID_LENGTH = 64;

export const EMPTY_CART: Cart = Object.freeze([]);

export function isValidQuantity(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_QUANTITY && (value as number) <= MAX_QUANTITY;
}

function isValidProductId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_PRODUCT_ID_LENGTH;
}

function freezeCart(lines: CartLine[]): Cart {
  return Object.freeze(lines.map((line) => Object.freeze({ productId: line.productId, quantity: line.quantity })));
}

// Every rejected change returns the cart it was given, so callers can tell
// "nothing changed" apart by reference.
export function addItem(cart: Cart, product: Pick<MenuProduct, "id" | "isAvailable">, quantity = 1): Cart {
  if (!product.isAvailable || !isValidProductId(product.id) || !isValidQuantity(quantity)) {
    return cart;
  }
  const existing = cart.find((line) => line.productId === product.id);
  if (existing === undefined) {
    return freezeCart([...cart, { productId: product.id, quantity }]);
  }
  const merged = existing.quantity + quantity;
  if (!isValidQuantity(merged)) {
    return cart;
  }
  return freezeCart(cart.map((line) => (line === existing ? { productId: line.productId, quantity: merged } : line)));
}

export function setQuantity(cart: Cart, productId: string, quantity: number): Cart {
  if (!isValidQuantity(quantity)) {
    return cart;
  }
  const existing = cart.find((line) => line.productId === productId);
  if (existing === undefined || existing.quantity === quantity) {
    return cart;
  }
  return freezeCart(cart.map((line) => (line === existing ? { productId: line.productId, quantity } : line)));
}

export function removeItem(cart: Cart, productId: string): Cart {
  if (!cart.some((line) => line.productId === productId)) {
    return cart;
  }
  return freezeCart(cart.filter((line) => line.productId !== productId));
}

// Stored data is whatever the browser holds, so it is parsed defensively and
// never throws: unreadable JSON or a non-array is an empty cart, an invalid
// line is dropped, duplicate lines merge, and a product whose merged quantity
// breaks the 1-20 rule is dropped.
export function parseStoredCart(raw: string | null): Cart {
  if (raw === null) {
    return EMPTY_CART;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_CART;
  }
  if (!Array.isArray(parsed)) {
    return EMPTY_CART;
  }
  const quantities = new Map<string, number>();
  for (const item of parsed) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const { productId, quantity } = item as Record<string, unknown>;
    if (!isValidProductId(productId) || !isValidQuantity(quantity)) {
      continue;
    }
    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }
  const lines: CartLine[] = [];
  for (const [productId, quantity] of quantities) {
    if (isValidQuantity(quantity)) {
      lines.push({ productId, quantity });
    }
  }
  return lines.length === 0 ? EMPTY_CART : freezeCart(lines);
}

// Writes only productId and quantity, whatever else a line object carries.
export function serializeCart(cart: Cart): string {
  return JSON.stringify(cart.map((line) => ({ productId: line.productId, quantity: line.quantity })));
}

export type ResolvedCartLine =
  | { status: "ok"; productId: string; quantity: number; product: MenuProduct; lineTotalKurus: number }
  | { status: "unavailable"; productId: string; quantity: number; product: MenuProduct }
  | { status: "missing"; productId: string; quantity: number };

// Matches every stored line to the current menu. Lines whose product is no
// longer sold or no longer exists are kept and flagged, so they can be shown
// and removed instead of silently staying in storage.
export function resolveCart(cart: Cart, menu: readonly MenuCategory[]): ResolvedCartLine[] {
  const products = new Map<string, MenuProduct>();
  for (const category of menu) {
    for (const product of category.products) {
      products.set(product.id, product);
    }
  }
  return cart.map(({ productId, quantity }): ResolvedCartLine => {
    const product = products.get(productId);
    if (product === undefined) {
      return { status: "missing", productId, quantity };
    }
    if (!product.isAvailable) {
      return { status: "unavailable", productId, quantity, product };
    }
    return { status: "ok", productId, quantity, product, lineTotalKurus: product.priceKurus * quantity };
  });
}

// Informational total over the lines that can still be ordered.
export function cartTotalKurus(lines: readonly ResolvedCartLine[]): number {
  let total = 0;
  for (const line of lines) {
    if (line.status === "ok") {
      total += line.lineTotalKurus;
    }
  }
  return total;
}

export function cartItemCount(cart: Cart): number {
  let count = 0;
  for (const line of cart) {
    count += line.quantity;
  }
  return count;
}
