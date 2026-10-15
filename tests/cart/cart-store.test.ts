import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToCart,
  CART_STORAGE_KEY,
  getCartSnapshot,
  getServerCartSnapshot,
  removeFromCart,
  setCartQuantity,
  subscribeCart,
} from "../../src/cart/cart-store.ts";

const ESPRESSO = { id: "espresso", isAvailable: true };

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage {
  getItem(): string | null {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
  setItem(): void {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
}

// Read-only storage: reads work, writes fail as with a full quota.
class FullStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  }
}

function stubWindow<S extends MemoryStorage | ThrowingStorage>(storage: S) {
  const events = new EventTarget();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  return {
    storage,
    dispatchStorage: (key: string | null) => events.dispatchEvent(Object.assign(new Event("storage"), { key })),
  };
}

function stored(storage: MemoryStorage): unknown {
  return JSON.parse(storage.values.get(CART_STORAGE_KEY) ?? "null");
}

describe("cart store", () => {
  let storage: MemoryStorage;
  let dispatchStorage: (key: string | null) => void;

  beforeEach(() => {
    ({ storage, dispatchStorage } = stubWindow(new MemoryStorage()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores only productId and quantity", () => {
    expect(addToCart(ESPRESSO)).toBe("changed");
    expect(addToCart({ id: "latte", isAvailable: true }, 2)).toBe("changed");
    expect(stored(storage)).toEqual([
      { productId: "espresso", quantity: 1 },
      { productId: "latte", quantity: 2 },
    ]);
  });

  it("adds, changes the quantity of and removes a line in storage", () => {
    addToCart(ESPRESSO);
    expect(setCartQuantity("espresso", 4)).toBe("changed");
    expect(stored(storage)).toEqual([{ productId: "espresso", quantity: 4 }]);
    expect(removeFromCart("espresso")).toBe("changed");
    expect(stored(storage)).toEqual([]);
  });

  it("leaves storage untouched when a change is rejected", () => {
    addToCart(ESPRESSO, 20);
    const before = storage.values.get(CART_STORAGE_KEY);
    expect(addToCart(ESPRESSO)).toBe("rejected");
    expect(addToCart({ id: "cold-brew", isAvailable: false })).toBe("rejected");
    expect(setCartQuantity("espresso", 0)).toBe("rejected");
    expect(setCartQuantity("espresso", 21)).toBe("rejected");
    expect(setCartQuantity("espresso", 1.5)).toBe("rejected");
    expect(removeFromCart("latte")).toBe("rejected");
    expect(storage.values.get(CART_STORAGE_KEY)).toBe(before);
  });

  it("re-reads storage before each change so another tab's lines are kept", () => {
    addToCart(ESPRESSO);
    // Another tab writes directly to the shared storage.
    storage.setItem(CART_STORAGE_KEY, JSON.stringify([
      { productId: "espresso", quantity: 3 },
      { productId: "latte", quantity: 1 },
    ]));
    addToCart(ESPRESSO);
    expect(stored(storage)).toEqual([
      { productId: "espresso", quantity: 4 },
      { productId: "latte", quantity: 1 },
    ]);
  });

  it("returns the same snapshot while the stored string is unchanged and a new one after a change", () => {
    storage.setItem(CART_STORAGE_KEY, '[{"productId":"espresso","quantity":1}]');
    const first = getCartSnapshot();
    expect(getCartSnapshot()).toBe(first);
    addToCart(ESPRESSO);
    const second = getCartSnapshot();
    expect(second).not.toBe(first);
    expect(second).toEqual([{ productId: "espresso", quantity: 2 }]);
    expect(getCartSnapshot()).toBe(second);
  });

  it("serves only the valid lines of a corrupt stored cart", () => {
    storage.setItem(CART_STORAGE_KEY, '[{"productId":"espresso","quantity":2},{"productId":"latte","quantity":99}]');
    expect(getCartSnapshot()).toEqual([{ productId: "espresso", quantity: 2 }]);
    storage.setItem(CART_STORAGE_KEY, "{broken");
    expect(getCartSnapshot()).toEqual([]);
    expect(addToCart(ESPRESSO)).toBe("changed");
    expect(stored(storage)).toEqual([{ productId: "espresso", quantity: 1 }]);
  });

  it("reports 'not loaded yet' on the server instead of an empty cart", () => {
    expect(getServerCartSnapshot()).toBeNull();
  });

  it("notifies subscribers on a change in this tab and on another tab's storage event for the cart key", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCart(listener);
    addToCart(ESPRESSO);
    expect(listener).toHaveBeenCalledTimes(1);
    dispatchStorage(CART_STORAGE_KEY);
    expect(listener).toHaveBeenCalledTimes(2);
    dispatchStorage(null);
    expect(listener).toHaveBeenCalledTimes(3);
    dispatchStorage("some-other-key");
    expect(listener).toHaveBeenCalledTimes(3);
    addToCart(ESPRESSO, 25);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    dispatchStorage(CART_STORAGE_KEY);
    addToCart(ESPRESSO);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("cart store with unusable storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("serves an empty cart and refuses changes without throwing when storage throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubWindow(new ThrowingStorage());
    expect(getCartSnapshot()).toEqual([]);
    expect(getCartSnapshot()).toBe(getCartSnapshot());
    expect(addToCart(ESPRESSO)).toBe("storage-error");
    expect(setCartQuantity("espresso", 2)).toBe("storage-error");
    expect(removeFromCart("espresso")).toBe("storage-error");
  });

  it("reports a failed write and leaves the stored cart as it was", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { storage } = stubWindow(new FullStorage());
    storage.values.set(CART_STORAGE_KEY, '[{"productId":"espresso","quantity":1}]');
    expect(addToCart(ESPRESSO)).toBe("storage-error");
    expect(storage.values.get(CART_STORAGE_KEY)).toBe('[{"productId":"espresso","quantity":1}]');
    expect(console.error).toHaveBeenCalledWith("Cart storage could not be written", expect.any(DOMException));
  });

  it("serves an empty cart without throwing when there is no window", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", undefined);
    expect(getCartSnapshot()).toEqual([]);
    expect(addToCart(ESPRESSO)).toBe("storage-error");
  });
});
