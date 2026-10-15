import type { MenuProduct } from "../db/menu.ts";
import { addItem, type Cart, EMPTY_CART, parseStoredCart, removeItem, serializeCart, setQuantity } from "./cart.ts";

// Browser cart store for useSyncExternalStore. localStorage is the only
// source of truth: every read goes to storage and every change re-reads it
// first, so a write never drops lines another tab added in the meantime.
export const CART_STORAGE_KEY = "coffy-shop.cart";

type Listener = () => void;

const listeners = new Set<Listener>();
// Snapshots are read on every render; a broken storage is logged once.
let readFailureLogged = false;

// null: storage could not be read (disabled, private mode, no window).
function readStoredValue(): { raw: string | null } | null {
  try {
    return { raw: window.localStorage.getItem(CART_STORAGE_KEY) };
  } catch (error) {
    if (!readFailureLogged) {
      readFailureLogged = true;
      console.error("Cart storage could not be read", error);
    }
    return null;
  }
}

let cachedRaw: string | null = null;
let cachedCart: Cart = EMPTY_CART;

// Returns the same Cart reference while the stored string is unchanged;
// useSyncExternalStore re-renders forever otherwise.
export function getCartSnapshot(): Cart {
  const stored = readStoredValue();
  if (stored === null) {
    return EMPTY_CART;
  }
  if (stored.raw !== cachedRaw) {
    cachedRaw = stored.raw;
    cachedCart = parseStoredCart(stored.raw);
  }
  return cachedCart;
}

// The server has no localStorage: null means "not loaded yet", never an
// empty cart, so a full cart does not flash as empty during hydration.
export function getServerCartSnapshot(): Cart | null {
  return null;
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function onStorage(event: StorageEvent): void {
  // key is null when another tab cleared the whole storage.
  if (event.key === null || event.key === CART_STORAGE_KEY) {
    notify();
  }
}

export function subscribeCart(listener: Listener): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export type CartChangeResult = "changed" | "rejected" | "storage-error";

function updateCart(change: (cart: Cart) => Cart): CartChangeResult {
  const stored = readStoredValue();
  // Writing without a successful read could overwrite lines we never saw.
  if (stored === null) {
    return "storage-error";
  }
  const current = parseStoredCart(stored.raw);
  const next = change(current);
  if (next === current) {
    return "rejected";
  }
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(next));
  } catch (error) {
    console.error("Cart storage could not be written", error);
    return "storage-error";
  }
  notify();
  return "changed";
}

export function addToCart(product: Pick<MenuProduct, "id" | "isAvailable">, quantity = 1): CartChangeResult {
  return updateCart((cart) => addItem(cart, product, quantity));
}

export function setCartQuantity(productId: string, quantity: number): CartChangeResult {
  return updateCart((cart) => setQuantity(cart, productId, quantity));
}

export function removeFromCart(productId: string): CartChangeResult {
  return updateCart((cart) => removeItem(cart, productId));
}

// Called once an order is accepted. An already empty cart is "rejected".
export function clearCart(): CartChangeResult {
  return updateCart(() => EMPTY_CART);
}
