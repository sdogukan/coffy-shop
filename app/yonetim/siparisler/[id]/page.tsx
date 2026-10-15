import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminBar } from "../../../../src/admin/admin-bar.tsx";
import { OrderStatusControl } from "../../../../src/admin/order-status-control.tsx";
import { requireAdminPage } from "../../../../src/admin/page-guard.ts";
import { parseOrderId, readOrderById } from "../../../../src/db/admin-orders.ts";
import { formatPriceKurus } from "../../../../src/menu/format-price.ts";

export const metadata: Metadata = {
  title: "Sipariş | Yönetim | Coffy Shop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// One order with the item names and prices stored when it was placed.
export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  // A malformed id is not found without a query.
  const id = parseOrderId((await params).id);
  const order = id === null ? null : readOrderById(id);
  if (order === null) {
    notFound();
  }
  return (
    <>
      <AdminBar />
      <main>
        <h1>Sipariş {order.reference}</h1>
        <p>Teslim alacak: {order.customerName}</p>
        <OrderStatusControl orderId={order.id} initialStatus={order.status} />
        <ul className="cart-lines">
          {order.items.map((item) => (
            <li key={item.productId} className="cart-line">
              <h2>{item.name}</h2>
              <p>Birim fiyat: {formatPriceKurus(item.unitPriceKurus)}</p>
              <p>Adet: {item.quantity}</p>
              <p>Ara toplam: {formatPriceKurus(item.lineTotalKurus)}</p>
            </li>
          ))}
        </ul>
        <p className="cart-total">Toplam: {formatPriceKurus(order.totalKurus)}</p>
        {order.note !== null && <p>Sipariş notu: {order.note}</p>}
      </main>
    </>
  );
}
