import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type OrderRequest, orderFingerprint } from "../orders/order-request.ts";
import { type Env, openDatabase } from "./connection.ts";

export const ORDER_STATUSES = ["new", "preparing", "ready", "completed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// 32 random bytes = 256 bits, which base64url-encodes to 43 characters.
const TRACKING_TOKEN_BYTES = 32;
const TRACKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// References are readable and sequential (C-1001, C-1002, ...). They identify
// an order to staff but never grant access to it; only the token does.
const REFERENCE_OFFSET = 1000;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

// What the customer gets back, built only from the stored row so a replay of
// the same request returns exactly the same values.
export interface PlacedOrder {
  reference: string;
  trackingToken: string;
  totalKurus: number;
}

export type CreateOrderResult =
  | { status: "created"; order: PlacedOrder }
  | { status: "replayed"; order: PlacedOrder }
  | { status: "conflict" }
  | { status: "unknown_product"; productId: string }
  | { status: "product_unavailable"; productId: string; productName: string };

export interface OrderItemDetails {
  productId: string;
  name: string;
  unitPriceKurus: number;
  quantity: number;
  lineTotalKurus: number;
}

export interface OrderDetails {
  reference: string;
  status: OrderStatus;
  customerName: string;
  note: string | null;
  totalKurus: number;
  createdAt: string;
  items: OrderItemDetails[];
}

interface PlacedOrderRow {
  reference: string;
  tracking_token: string;
  total_kurus: number;
  payload_fingerprint: string;
}

interface ProductRow {
  id: string;
  name: string;
  price_kurus: number;
  is_available: number;
}

const SELECT_PLACED_ORDER = "SELECT reference, tracking_token, total_kurus, payload_fingerprint FROM orders";

function toPlacedOrder(row: PlacedOrderRow): PlacedOrder {
  return { reference: row.reference, trackingToken: row.tracking_token, totalKurus: Number(row.total_kurus) };
}

function resolveExisting(row: PlacedOrderRow, fingerprint: string): CreateOrderResult {
  return row.payload_fingerprint === fingerprint ? { status: "replayed", order: toPlacedOrder(row) } : { status: "conflict" };
}

function insertNewOrder(db: DatabaseSync, request: OrderRequest, fingerprint: string): CreateOrderResult {
  const placeholders = request.items.map(() => "?").join(", ");
  const products = db
    .prepare(`SELECT id, name, price_kurus, is_available FROM products WHERE id IN (${placeholders})`)
    .all(...request.items.map((item) => item.productId)) as unknown as ProductRow[];
  const byId = new Map(products.map((product) => [product.id, product]));

  const lines: OrderItemDetails[] = [];
  for (const item of request.items) {
    const product = byId.get(item.productId);
    if (product === undefined) {
      return { status: "unknown_product", productId: item.productId };
    }
    if (product.is_available !== 1) {
      return { status: "product_unavailable", productId: item.productId, productName: product.name };
    }
    const unitPriceKurus = Number(product.price_kurus);
    lines.push({
      productId: item.productId,
      name: product.name,
      unitPriceKurus,
      quantity: item.quantity,
      lineTotalKurus: unitPriceKurus * item.quantity,
    });
  }
  const totalKurus = lines.reduce((sum, line) => sum + line.lineTotalKurus, 0);

  // Runs under the BEGIN IMMEDIATE write lock, so no other writer can take
  // the same id between this read and the insert.
  const { next } = db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM orders").get() as { next: number };
  const id = Number(next);
  db.prepare(
    `INSERT INTO orders (id, reference, tracking_token, status, customer_name, note, total_kurus, idempotency_key, payload_fingerprint, created_at)
     VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `C-${REFERENCE_OFFSET + id}`,
    randomBytes(TRACKING_TOKEN_BYTES).toString("base64url"),
    request.customerName,
    request.note,
    totalKurus,
    request.idempotencyKey,
    fingerprint,
    new Date().toISOString(),
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, unit_price_kurus_snapshot, quantity, line_total_kurus)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const line of lines) {
    insertItem.run(id, line.productId, line.name, line.unitPriceKurus, line.quantity, line.lineTotalKurus);
  }
  const stored = db.prepare(`${SELECT_PLACED_ORDER} WHERE id = ?`).get(id) as unknown as PlacedOrderRow;
  return { status: "created", order: toPlacedOrder(stored) };
}

function isIdempotencyKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { errcode?: number }).errcode === SQLITE_CONSTRAINT_UNIQUE &&
    error.message.includes("orders.idempotency_key")
  );
}

// Creates the order in one BEGIN IMMEDIATE transaction. The idempotency key is
// looked up first, before any product is read: a same-key request that waited
// for the write lock finds the committed order and replays it, even if a
// product changed or went unavailable since. Only a new key reads products,
// prices every line from SQLite and stores name/price snapshots.
export function createOrder(db: DatabaseSync, request: OrderRequest): CreateOrderResult {
  const fingerprint = orderFingerprint(request);
  const selectByKey = db.prepare(`${SELECT_PLACED_ORDER} WHERE idempotency_key = ?`);
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = selectByKey.get(request.idempotencyKey) as PlacedOrderRow | undefined;
    const result =
      existing === undefined ? insertNewOrder(db, request, fingerprint) : resolveExisting(existing, fingerprint);
    if (result.status === "created") {
      db.exec("COMMIT");
    } else {
      db.exec("ROLLBACK");
    }
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    // Backstop: the write lock makes this unreachable between two callers of
    // this function, but a writer that skipped the lock could still commit
    // the same key first. Answer from the committed row instead of failing.
    if (isIdempotencyKeyViolation(error)) {
      const committed = selectByKey.get(request.idempotencyKey) as PlacedOrderRow | undefined;
      if (committed !== undefined) {
        return resolveExisting(committed, fingerprint);
      }
    }
    throw error;
  }
}

export function isTrackingToken(value: unknown): value is string {
  return typeof value === "string" && TRACKING_TOKEN_PATTERN.test(value);
}

// The token is the only way to look an order up; there is deliberately no
// lookup by reference and no listing. Malformed tokens never reach SQLite.
export function findOrderByTrackingToken(db: DatabaseSync, token: unknown): OrderDetails | null {
  if (!isTrackingToken(token)) {
    return null;
  }
  const order = db
    .prepare("SELECT id, reference, status, customer_name, note, total_kurus, created_at FROM orders WHERE tracking_token = ?")
    .get(token) as
    | {
        id: number;
        reference: string;
        status: OrderStatus;
        customer_name: string;
        note: string | null;
        total_kurus: number;
        created_at: string;
      }
    | undefined;
  if (order === undefined) {
    return null;
  }
  const items = db
    .prepare(
      `SELECT product_id, product_name_snapshot, unit_price_kurus_snapshot, quantity, line_total_kurus
       FROM order_items WHERE order_id = ? ORDER BY product_id`,
    )
    .all(order.id) as unknown as {
    product_id: string;
    product_name_snapshot: string;
    unit_price_kurus_snapshot: number;
    quantity: number;
    line_total_kurus: number;
  }[];
  return {
    reference: order.reference,
    status: order.status,
    customerName: order.customer_name,
    note: order.note,
    totalKurus: Number(order.total_kurus),
    createdAt: order.created_at,
    items: items.map((item) => ({
      productId: item.product_id,
      name: item.product_name_snapshot,
      unitPriceKurus: Number(item.unit_price_kurus_snapshot),
      quantity: Number(item.quantity),
      lineTotalKurus: Number(item.line_total_kurus),
    })),
  };
}

// Opens the existing database (never creates it), places the order and always
// closes the connection. Errors propagate to the caller.
export function placeOrder(request: OrderRequest, env: Env = process.env): CreateOrderResult {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return createOrder(db, request);
  } finally {
    db?.close();
  }
}

// Same lifecycle for the tracking page. A malformed token returns null without
// opening the database.
export function readOrderByTrackingToken(token: unknown, env: Env = process.env): OrderDetails | null {
  if (!isTrackingToken(token)) {
    return null;
  }
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return findOrderByTrackingToken(db, token);
  } finally {
    db?.close();
  }
}
