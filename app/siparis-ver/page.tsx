import type { Metadata } from "next";
import { readMenu } from "../../src/db/menu.ts";
import { CheckoutForm } from "../../src/orders/checkout-form.tsx";

export const metadata: Metadata = {
  title: "Sipariş ver | Coffy Shop",
};

// The cart summary is matched to the current menu, read per request.
export const dynamic = "force-dynamic";

export default function CheckoutPage() {
  const menu = readMenu();
  return (
    <main>
      <h1>Sipariş ver</h1>
      <CheckoutForm menu={menu} />
    </main>
  );
}
