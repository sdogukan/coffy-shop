"use client";

import { useSyncExternalStore } from "react";
import { cartItemCount } from "./cart.ts";
import { getCartSnapshot, getServerCartSnapshot, subscribeCart } from "./cart-store.ts";

// Renders nothing until the browser's cart has been read, so a full cart
// never shows a count of 0 on the server render.
export function CartBadge() {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot);
  if (cart === null) {
    return null;
  }
  const count = cartItemCount(cart);
  return (
    <span className="cart-badge" aria-label={`${count} ürün`}>
      {count}
    </span>
  );
}
