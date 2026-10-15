import Link from "next/link";
import type { AdminOrderSummary } from "../db/admin-orders.ts";
import { formatPriceKurus } from "../menu/format-price.ts";
import { ORDER_STATUS_LABELS } from "../orders/order-status.ts";
import { adminOrderPath } from "./paths.ts";

// The shop's own time zone, named explicitly, so the rendered time does not
// depend on the server's TZ.
const ORDER_TIME_FORMAT = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  dateStyle: "short",
  timeStyle: "short",
});

// createdAt is the ISO timestamp stored when the order was placed.
export function formatOrderTime(createdAt: string): string {
  return ORDER_TIME_FORMAT.format(new Date(createdAt));
}

// Every order in the order given (newest first from the data layer), each
// linking to its detail page.
export function AdminOrderList({ orders }: { orders: readonly AdminOrderSummary[] }) {
  if (orders.length === 0) {
    return <p>Henüz sipariş yok.</p>;
  }
  return (
    <ul className="admin-order-list">
      {orders.map((order) => (
        <li key={order.id} className="admin-order">
          <div className="admin-order-info">
            <h2>
              <Link href={adminOrderPath(order.id)}>{order.reference}</Link>
            </h2>
            <p>{order.customerName}</p>
            <p>
              <time dateTime={order.createdAt}>{formatOrderTime(order.createdAt)}</time>
            </p>
          </div>
          <div className="admin-order-meta">
            <p className="admin-status">{ORDER_STATUS_LABELS[order.status]}</p>
            <p className="product-price">{formatPriceKurus(order.totalKurus)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
