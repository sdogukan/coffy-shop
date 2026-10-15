import type { Metadata } from "next";
import { CartView } from "../../src/cart/cart-view.tsx";
import { readMenu } from "../../src/db/menu.ts";

export const metadata: Metadata = {
  title: "Sepet | Coffy Shop",
};

// The cart is matched to the current menu, read per request.
export const dynamic = "force-dynamic";

export default function CartPage() {
  const menu = readMenu();
  return (
    <main>
      <h1>Sepet</h1>
      <CartView menu={menu} />
    </main>
  );
}
