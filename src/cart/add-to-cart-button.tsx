"use client";

import { useState } from "react";
import { MAX_QUANTITY } from "./cart.ts";
import { addToCart, type CartChangeResult } from "./cart-store.ts";

const MESSAGES: Record<CartChangeResult, string> = {
  changed: "Sepete eklendi.",
  rejected: `Bu üründen en fazla ${MAX_QUANTITY} adet eklenebilir.`,
  "storage-error": "Sepet bu tarayıcıda kaydedilemiyor.",
};

export function AddToCartButton({ productId, isAvailable }: { productId: string; isAvailable: boolean }) {
  const [result, setResult] = useState<CartChangeResult | null>(null);
  return (
    <div className="add-to-cart">
      <button
        type="button"
        className="button"
        disabled={!isAvailable}
        onClick={() => setResult(addToCart({ id: productId, isAvailable }))}
      >
        Sepete ekle
      </button>
      <p className="add-to-cart-status" role="status">
        {result === null ? "" : MESSAGES[result]}
      </p>
    </div>
  );
}
