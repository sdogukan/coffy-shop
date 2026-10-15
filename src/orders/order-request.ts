import { createHash } from "node:crypto";
import { isValidQuantity } from "../cart/cart.ts";

// Parses the POST /api/orders body. Only the shape is checked here: nothing
// reads products, so a retry of an accepted order is never rejected because
// the menu changed in between. Price or total fields a client sends are not
// read at all; prices always come from the database.

export const MIN_CUSTOMER_NAME_LENGTH = 1;
export const MAX_CUSTOMER_NAME_LENGTH = 60;
export const MAX_NOTE_LENGTH = 200;
// Raw lines before merging, so a huge items array cannot cause unbounded work.
export const MAX_REQUEST_LINES = 50;
// Same bound as the products.id column.
const MAX_PRODUCT_ID_LENGTH = 64;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface OrderRequestItem {
  readonly productId: string;
  readonly quantity: number;
}

export interface OrderRequest {
  readonly customerName: string;
  readonly note: string | null;
  // Merged per productId and sorted by productId.
  readonly items: readonly OrderRequestItem[];
  readonly idempotencyKey: string;
}

export type OrderRequestErrorCode =
  | "invalid_request"
  | "empty_cart"
  | "invalid_quantity"
  | "invalid_customer_name"
  | "invalid_note";

export type ParseOrderRequestResult =
  | { ok: true; request: OrderRequest }
  | { ok: false; code: OrderRequestErrorCode; error: string };

export const ORDER_REQUEST_ERRORS: Readonly<Record<OrderRequestErrorCode, string>> = {
  invalid_request: "Sipariş isteği geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.",
  empty_cart: "Sepetiniz boş. Sipariş vermek için menüden ürün ekleyin.",
  invalid_quantity: "Her üründen en az 1, en fazla 20 adet sipariş verebilirsiniz.",
  invalid_customer_name: "Adınız 1 ile 60 karakter arasında olmalıdır.",
  invalid_note: "Sipariş notu en fazla 200 karakter olabilir.",
};

function fail(code: OrderRequestErrorCode): ParseOrderRequestResult {
  return { ok: false, code, error: ORDER_REQUEST_ERRORS[code] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Counts characters the way SQLite's length() does (code points), so the
// limits here and the CHECK constraints in the orders table agree. A string
// longer than twice the limit in UTF-16 units is over it in code points too,
// which skips the spread for oversized input.
function characterCount(value: string, max: number): number {
  return value.length > max * 2 ? value.length : [...value].length;
}

export function parseOrderRequest(body: unknown): ParseOrderRequestResult {
  if (!isPlainObject(body)) {
    return fail("invalid_request");
  }
  const { customerName, note, items, idempotencyKey } = body;

  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return fail("invalid_request");
  }
  if (typeof customerName !== "string" || (note !== undefined && note !== null && typeof note !== "string")) {
    return fail("invalid_request");
  }
  if (!Array.isArray(items) || items.length > MAX_REQUEST_LINES) {
    return fail("invalid_request");
  }

  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!isPlainObject(item)) {
      return fail("invalid_request");
    }
    const { productId, quantity } = item;
    if (typeof productId !== "string" || productId.length < 1 || productId.length > MAX_PRODUCT_ID_LENGTH) {
      return fail("invalid_request");
    }
    if (typeof quantity !== "number") {
      return fail("invalid_request");
    }
    if (!isValidQuantity(quantity)) {
      return fail("invalid_quantity");
    }
    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }
  if (quantities.size === 0) {
    return fail("empty_cart");
  }
  for (const quantity of quantities.values()) {
    if (!isValidQuantity(quantity)) {
      return fail("invalid_quantity");
    }
  }

  const trimmedName = customerName.trim();
  const nameLength = characterCount(trimmedName, MAX_CUSTOMER_NAME_LENGTH);
  if (nameLength < MIN_CUSTOMER_NAME_LENGTH || nameLength > MAX_CUSTOMER_NAME_LENGTH) {
    return fail("invalid_customer_name");
  }

  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (characterCount(trimmedNote, MAX_NOTE_LENGTH) > MAX_NOTE_LENGTH) {
    return fail("invalid_note");
  }

  const merged = [...quantities]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([productId, quantity]) => Object.freeze({ productId, quantity }));

  return {
    ok: true,
    request: Object.freeze({
      customerName: trimmedName,
      note: trimmedNote === "" ? null : trimmedNote,
      items: Object.freeze(merged),
      idempotencyKey,
    }),
  };
}

// SHA-256 (hex) of the normalized payload. The idempotency key is not part of
// it: the same key with a different fingerprint is a conflict.
export function orderFingerprint(request: OrderRequest): string {
  const canonical = JSON.stringify({
    customerName: request.customerName,
    note: request.note,
    items: request.items.map((item) => [item.productId, item.quantity]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
