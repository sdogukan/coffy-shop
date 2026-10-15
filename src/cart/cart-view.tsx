"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { MenuCategory } from "../db/menu.ts";
import { formatPriceKurus } from "../menu/format-price.ts";
import { cartTotalKurus, MAX_QUANTITY, MIN_QUANTITY, type ResolvedCartLine, resolveCart } from "./cart.ts";
import { getCartSnapshot, getServerCartSnapshot, removeFromCart, setCartQuantity, subscribeCart } from "./cart-store.ts";

export interface CartContentsProps {
  lines: readonly ResolvedCartLine[];
  onSetQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
}

// Presentational cart: takes resolved lines and callbacks, owns no state.
export function CartContents({ lines, onSetQuantity, onRemove }: CartContentsProps) {
  if (lines.length === 0) {
    return (
      <div className="cart-empty">
        <p>Sepetiniz boş.</p>
        <Link href="/">Menüye dön</Link>
      </div>
    );
  }
  return (
    <>
      <ul className="cart-lines">
        {lines.map((line) => (
          <li key={line.productId} className={line.status === "ok" ? "cart-line" : "cart-line cart-line-flagged"}>
            {line.status === "missing" ? (
              <>
                <h2>Ürün bulunamadı</h2>
                <p className="cart-line-flag">
                  Bu ürün artık menüde yok (kod: {line.productId}). Toplama dahil edilmedi.
                </p>
              </>
            ) : (
              <>
                <h2>{line.product.name}</h2>
                <p>Birim fiyat: {formatPriceKurus(line.product.priceKurus)}</p>
              </>
            )}
            {line.status === "unavailable" && (
              <p className="cart-line-flag">Satışta değil. Toplama dahil edilmedi.</p>
            )}
            <p>Adet: {line.quantity}</p>
            {line.status === "ok" && (
              <>
                <p>Ara toplam: {formatPriceKurus(line.lineTotalKurus)}</p>
                <div className="quantity-controls">
                  <button
                    type="button"
                    className="button"
                    aria-label={`${line.product.name} adedini azalt`}
                    disabled={line.quantity <= MIN_QUANTITY}
                    onClick={() => onSetQuantity(line.productId, line.quantity - 1)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={`${line.product.name} adedini artır`}
                    disabled={line.quantity >= MAX_QUANTITY}
                    onClick={() => onSetQuantity(line.productId, line.quantity + 1)}
                  >
                    +
                  </button>
                </div>
              </>
            )}
            <button type="button" className="button button-secondary" onClick={() => onRemove(line.productId)}>
              Sepetten çıkar
            </button>
          </li>
        ))}
      </ul>
      <p className="cart-total">Toplam: {formatPriceKurus(cartTotalKurus(lines))}</p>
      <p className="cart-note">Fiyatlar bilgi amaçlıdır; sipariş sırasında güncel fiyatlar esas alınır.</p>
    </>
  );
}

// Reads the browser cart and matches it to the menu the server just read.
export function CartView({ menu }: { menu: readonly MenuCategory[] }) {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot);
  if (cart === null) {
    return <p aria-busy="true">Sepet yükleniyor…</p>;
  }
  return <CartContents lines={resolveCart(cart, menu)} onSetQuantity={setCartQuantity} onRemove={removeFromCart} />;
}
