// Order status codes in their only allowed order. Staff move an order one
// step forward at a time and never back; completed is final.
//
// No server-only import here: the admin client components check statuses
// with this module too. src/db/orders.ts re-exports ORDER_STATUSES.

export const ORDER_STATUSES = ["new", "preparing", "ready", "completed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Statuses are stored as codes; these Turkish labels are UI only.
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  new: "Yeni",
  preparing: "Hazırlanıyor",
  ready: "Hazır",
  completed: "Tamamlandı",
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

// The single status an order in `status` may move to, or null once completed.
export function nextOrderStatus(status: OrderStatus): OrderStatus | null {
  return ORDER_STATUSES[ORDER_STATUSES.indexOf(status) + 1] ?? null;
}

// The single status an order must be in to move to `status`, or null for new
// (nothing moves back to new).
export function previousOrderStatus(status: OrderStatus): OrderStatus | null {
  const index = ORDER_STATUSES.indexOf(status);
  return index > 0 ? (ORDER_STATUSES[index - 1] ?? null) : null;
}
