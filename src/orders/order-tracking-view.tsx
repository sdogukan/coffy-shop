import { ORDER_STATUSES, type OrderDetails } from "../db/orders.ts";
import { formatPriceKurus } from "../menu/format-price.ts";
import { ORDER_STATUS_LABELS } from "./order-status.ts";

// Defined next to the status codes so the admin client components can use
// them without importing the database module.
export { ORDER_STATUS_LABELS } from "./order-status.ts";

function stepClassName(index: number, current: number): string {
  if (index < current) {
    return "order-step order-step-done";
  }
  return index === current ? "order-step order-step-current" : "order-step";
}

// Server-rendered status of one order, with the item names and prices as
// they were stored when the order was placed. refreshHref reloads the page
// itself, so the status is always read again from the database.
export function OrderTrackingView({ order, refreshHref }: { order: OrderDetails; refreshHref: string }) {
  const current = ORDER_STATUSES.indexOf(order.status);
  return (
    <>
      <p>
        Sipariş numarası: <strong>{order.reference}</strong>
      </p>
      <p>Teslim alacak: {order.customerName}</p>
      <p className="order-status">Durum: {ORDER_STATUS_LABELS[order.status]}</p>
      <ol className="order-steps" aria-label="Sipariş durumu">
        {ORDER_STATUSES.map((status, index) => (
          <li
            key={status}
            className={stepClassName(index, current)}
            aria-current={index === current ? "step" : undefined}
          >
            {ORDER_STATUS_LABELS[status]}
          </li>
        ))}
      </ol>
      <a href={refreshHref} className="button">
        Durumu yenile
      </a>
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
      <p>Mağazadan teslim alınacaktır.</p>
    </>
  );
}
