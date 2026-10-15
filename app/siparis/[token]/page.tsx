import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readOrderByTrackingToken } from "../../../src/db/orders.ts";
import { OrderTrackingView } from "../../../src/orders/order-tracking-view.tsx";

// The token in the URL is the only key to the order: keep the page out of
// search engines and out of Referer headers.
export const metadata: Metadata = {
  title: "Sipariş takibi | Coffy Shop",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// The status is read from the database on every request, never cached.
export const dynamic = "force-dynamic";

export default async function OrderTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // A malformed token returns null without touching the database.
  const order = readOrderByTrackingToken(token);
  if (order === null) {
    notFound();
  }
  return (
    <main>
      <h1>Sipariş takibi</h1>
      <OrderTrackingView order={order} refreshHref={`/siparis/${token}`} />
    </main>
  );
}
