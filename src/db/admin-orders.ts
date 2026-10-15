import type { DatabaseSync } from "node:sqlite";
import { type OrderStatus, previousOrderStatus } from "../orders/order-status.ts";
import { type Env, openDatabase } from "./connection.ts";
import type { OrderDetails } from "./orders.ts";

// Staff side of orders: the list, one order by its id and the status change.
// The customer side (src/db/orders.ts) stays token-only. Every query names its
// columns: tracking_token, idempotency_key and payload_fingerprint never leave
// this module, because the tracking token is the customer's only access key.

// Canonical decimal form of a positive integer, at most 16 digits; the safe
// integer check below rejects the 16-digit values above 2^53 - 1.
const ORDER_ID_PATTERN = /^[1-9][0-9]{0,15}$/;

export interface AdminOrderSummary {
  id: number;
  reference: string;
  customerName: string;
  status: OrderStatus;
  totalKurus: number;
  createdAt: string;
}

export interface AdminOrderDetails extends OrderDetails {
  id: number;
  // null until the first status change.
  updatedAt: string | null;
}

export type AdvanceOrderStatusResult =
  | { status: "updated"; order: AdminOrderDetails }
  | { status: "not_found" }
  | { status: "invalid_transition" };

interface OrderRow {
  id: number;
  reference: string;
  status: OrderStatus;
  customer_name: string;
  note: string | null;
  total_kurus: number;
  created_at: string;
  updated_at: string | null;
}

interface OrderItemRow {
  product_id: string;
  product_name_snapshot: string;
  unit_price_kurus_snapshot: number;
  quantity: number;
  line_total_kurus: number;
}

function isOrderId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

// The {id} path segment as an order id, or null for anything that is not a
// positive safe integer in canonical decimal form ("01", "1.0", "1e3", " 1").
export function parseOrderId(value: string): number | null {
  if (!ORDER_ID_PATTERN.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

// Every order, newest first. Ids are assigned sequentially, so id order is
// creation order without depending on timestamps.
export function listOrders(db: DatabaseSync): AdminOrderSummary[] {
  const rows = db
    .prepare("SELECT id, reference, customer_name, status, total_kurus, created_at FROM orders ORDER BY id DESC")
    .all() as unknown as Pick<OrderRow, "id" | "reference" | "customer_name" | "status" | "total_kurus" | "created_at">[];
  return rows.map((row) => ({
    id: Number(row.id),
    reference: row.reference,
    customerName: row.customer_name,
    status: row.status,
    totalKurus: Number(row.total_kurus),
    createdAt: row.created_at,
  }));
}

// An id outside the column's range never reaches SQLite.
export function findOrderById(db: DatabaseSync, id: number): AdminOrderDetails | null {
  if (!isOrderId(id)) {
    return null;
  }
  const order = db
    .prepare(
      "SELECT id, reference, status, customer_name, note, total_kurus, created_at, updated_at FROM orders WHERE id = ?",
    )
    .get(id) as OrderRow | undefined;
  if (order === undefined) {
    return null;
  }
  const items = db
    .prepare(
      `SELECT product_id, product_name_snapshot, unit_price_kurus_snapshot, quantity, line_total_kurus
       FROM order_items WHERE order_id = ? ORDER BY product_id`,
    )
    .all(id) as unknown as OrderItemRow[];
  return {
    id: Number(order.id),
    reference: order.reference,
    status: order.status,
    customerName: order.customer_name,
    note: order.note,
    totalKurus: Number(order.total_kurus),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: items.map((item) => ({
      productId: item.product_id,
      name: item.product_name_snapshot,
      unitPriceKurus: Number(item.unit_price_kurus_snapshot),
      quantity: Number(item.quantity),
      lineTotalKurus: Number(item.line_total_kurus),
    })),
  };
}

// Moves the order one step forward to `to`. The UPDATE itself decides: it
// only matches while the stored status is the one right before `to`, so of
// two requests racing for the same step exactly one changes the row and the
// other gets invalid_transition. When nothing changed, the existence check
// only chooses between not_found and invalid_transition; the write is never
// retried. The UPDATE and the read-back share one write lock, so the order
// returned is the one this call wrote.
export function advanceOrderStatus(
  db: DatabaseSync,
  id: number,
  to: OrderStatus,
  now: Date = new Date(),
): AdvanceOrderStatusResult {
  if (!isOrderId(id)) {
    return { status: "not_found" };
  }
  const from = previousOrderStatus(to);
  db.exec("BEGIN IMMEDIATE");
  try {
    let result: AdvanceOrderStatusResult;
    const changes =
      from === null
        ? 0
        : Number(
            db
              .prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
              .run(to, now.toISOString(), id, from).changes,
          );
    if (changes === 1) {
      result = { status: "updated", order: findOrderById(db, id) as AdminOrderDetails };
    } else if (db.prepare("SELECT 1 FROM orders WHERE id = ?").get(id) === undefined) {
      result = { status: "not_found" };
    } else {
      result = { status: "invalid_transition" };
    }
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}

// The functions below open the existing database (never create it), do one
// operation and always close the connection. Errors propagate to the caller.

export function readOrders(env: Env = process.env): AdminOrderSummary[] {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return listOrders(db);
  } finally {
    db?.close();
  }
}

export function readOrderById(id: number, env: Env = process.env): AdminOrderDetails | null {
  if (!isOrderId(id)) {
    return null;
  }
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return findOrderById(db, id);
  } finally {
    db?.close();
  }
}

export function changeOrderStatus(id: number, to: OrderStatus, env: Env = process.env): AdvanceOrderStatusResult {
  if (!isOrderId(id)) {
    return { status: "not_found" };
  }
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return advanceOrderStatus(db, id, to);
  } finally {
    db?.close();
  }
}
