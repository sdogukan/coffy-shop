import type { MenuProduct } from "../db/menu.ts";
import type { AdminOrderDetails } from "../db/admin-orders.ts";
import type { ProductFields, ProductPatch } from "../db/admin-products.ts";
import type { MilkOption, MilkOptionFields, MilkOptionPatch } from "../db/milk-options.ts";
import type { OrderItemDetails } from "../db/orders.ts";
import { isOrderStatus, type OrderStatus } from "../orders/order-status.ts";
import {
  ADMIN_LOGIN_ENDPOINT,
  ADMIN_LOGOUT_ENDPOINT,
  ADMIN_MILK_OPTIONS_ENDPOINT,
  ADMIN_PRODUCTS_ENDPOINT,
  adminMilkOptionEndpoint,
  adminOrderStatusEndpoint,
  adminProductEndpoint,
} from "./paths.ts";

// Browser side of /api/admin/*. Every request is a relative, same-origin
// fetch, so the browser sends its own Origin (the backend's CSRF check) and
// the session cookie never goes to another origin. Nothing is retried
// automatically: POST /api/admin/products and POST /api/admin/milk-options
// have no idempotency key, so a resend could create a second product or option.

export const ADMIN_REQUEST_TIMEOUT_MS = 20_000;

export const ADMIN_CLIENT_MESSAGES = {
  unreachable: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.",
  failed: "İşlem şu anda yapılamadı. Lütfen tekrar deneyin.",
  invalidCredentials: "Kullanıcı adı veya şifre hatalı.",
  unauthorized: "Oturumunuz yok veya süresi doldu. Lütfen tekrar giriş yapın.",
  createUnknown:
    "Ürünün kaydedilip kaydedilmediği doğrulanamadı. Tekrar göndermeden önce ürün listesini kontrol edin.",
  milkOptionCreateUnknown:
    "Süt seçeneğinin kaydedilip kaydedilmediği doğrulanamadı. Tekrar göndermeden önce süt seçenekleri listesini yenileyip kontrol edin.",
} as const;

// ok: the expected success answer. unauthorized: 401, no valid session (or,
// for login, wrong credentials). failed: any other answer from the server;
// nothing was changed. unknown: no readable answer (network error, timeout,
// unexpected success body); the change may or may not have happened.
export type AdminOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "unauthorized"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "unknown"; message: string };

interface AdminRequest<T> {
  path: string;
  method: "POST" | "PATCH";
  body?: unknown;
  successStatus: number;
  // null when the success body is not what the contract promises.
  readValue: (body: unknown) => T | null;
  unauthorizedMessage?: string;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function serverMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { error } = body as Record<string, unknown>;
  return typeof error === "string" && error.length > 0 ? error : null;
}

async function sendAdminRequest<T>(request: AdminRequest<T>, fetchImpl: typeof fetch): Promise<AdminOutcome<T>> {
  let response: Response;
  try {
    response = await fetchImpl(request.path, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: "same-origin",
      signal: AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`Admin request ${request.method} ${request.path} failed before a response arrived`, error);
    return { kind: "unknown", message: ADMIN_CLIENT_MESSAGES.unreachable };
  }
  const payload = response.status === 204 ? null : await readJson(response);
  if (response.status === request.successStatus) {
    const value = request.readValue(payload);
    if (value !== null) {
      return { kind: "ok", value };
    }
    console.error(`Admin request ${request.method} ${request.path} answered ${response.status} with an unexpected body`);
    return { kind: "unknown", message: ADMIN_CLIENT_MESSAGES.failed };
  }
  if (response.status === 401) {
    return {
      kind: "unauthorized",
      message: serverMessage(payload) ?? request.unauthorizedMessage ?? ADMIN_CLIENT_MESSAGES.unauthorized,
    };
  }
  if (response.status >= 500) {
    console.error(`Admin request ${request.method} ${request.path} answered with status ${response.status}`);
  }
  return { kind: "failed", message: serverMessage(payload) ?? ADMIN_CLIENT_MESSAGES.failed };
}

function isMenuProduct(value: unknown): value is MenuProduct {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { id, categoryId, name, description, priceKurus, isAvailable, containsMilk } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    typeof categoryId === "string" &&
    typeof name === "string" &&
    typeof description === "string" &&
    Number.isSafeInteger(priceKurus) &&
    typeof isAvailable === "boolean" &&
    typeof containsMilk === "boolean"
  );
}

function readProduct(body: unknown): MenuProduct | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { product } = body as Record<string, unknown>;
  return isMenuProduct(product)
    ? {
        id: product.id,
        categoryId: product.categoryId,
        name: product.name,
        description: product.description,
        priceKurus: product.priceKurus,
        isAvailable: product.isAvailable,
        containsMilk: product.containsMilk,
      }
    : null;
}

function isMilkOption(value: unknown): value is MilkOption {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { id, name, surchargeKurus, isDefault, isAvailable } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    typeof name === "string" &&
    Number.isSafeInteger(surchargeKurus) &&
    typeof isDefault === "boolean" &&
    typeof isAvailable === "boolean"
  );
}

function readMilkOption(body: unknown): MilkOption | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { milkOption } = body as Record<string, unknown>;
  return isMilkOption(milkOption)
    ? {
        id: milkOption.id,
        name: milkOption.name,
        surchargeKurus: milkOption.surchargeKurus,
        isDefault: milkOption.isDefault,
        isAvailable: milkOption.isAvailable,
      }
    : null;
}

function isOrderItem(value: unknown): value is OrderItemDetails {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { productId, name, unitPriceKurus, quantity, lineTotalKurus } = value as Record<string, unknown>;
  return (
    typeof productId === "string" &&
    typeof name === "string" &&
    Number.isSafeInteger(unitPriceKurus) &&
    Number.isSafeInteger(quantity) &&
    Number.isSafeInteger(lineTotalKurus)
  );
}

function readOrder(body: unknown): AdminOrderDetails | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { order } = body as Record<string, unknown>;
  if (typeof order !== "object" || order === null) {
    return null;
  }
  const { id, reference, status, customerName, note, totalKurus, createdAt, updatedAt, items } = order as Record<
    string,
    unknown
  >;
  if (
    !Number.isSafeInteger(id) ||
    typeof reference !== "string" ||
    !isOrderStatus(status) ||
    typeof customerName !== "string" ||
    (note !== null && typeof note !== "string") ||
    !Number.isSafeInteger(totalKurus) ||
    typeof createdAt !== "string" ||
    (updatedAt !== null && typeof updatedAt !== "string") ||
    !Array.isArray(items) ||
    !items.every(isOrderItem)
  ) {
    return null;
  }
  return {
    id: id as number,
    reference,
    status,
    customerName,
    note,
    totalKurus: totalKurus as number,
    createdAt,
    updatedAt,
    items: items.map((item) => ({
      productId: item.productId,
      name: item.name,
      unitPriceKurus: item.unitPriceKurus,
      quantity: item.quantity,
      lineTotalKurus: item.lineTotalKurus,
    })),
  };
}

function readLoginOk(body: unknown): true | null {
  return typeof body === "object" && body !== null && (body as Record<string, unknown>).status === "ok" ? true : null;
}

export function submitLogin(username: string, password: string, fetchImpl: typeof fetch = fetch) {
  return sendAdminRequest(
    {
      path: ADMIN_LOGIN_ENDPOINT,
      method: "POST",
      body: { username, password },
      successStatus: 200,
      readValue: readLoginOk,
      unauthorizedMessage: ADMIN_CLIENT_MESSAGES.invalidCredentials,
    },
    fetchImpl,
  );
}

// The logout endpoint reads no body; the JSON Content-Type is sent anyway,
// like on every admin request.
export function submitLogout(fetchImpl: typeof fetch = fetch) {
  return sendAdminRequest(
    { path: ADMIN_LOGOUT_ENDPOINT, method: "POST", successStatus: 204, readValue: () => true as const },
    fetchImpl,
  );
}

export async function submitNewProduct(fields: ProductFields, fetchImpl: typeof fetch = fetch) {
  const outcome = await sendAdminRequest(
    { path: ADMIN_PRODUCTS_ENDPOINT, method: "POST", body: fields, successStatus: 201, readValue: readProduct },
    fetchImpl,
  );
  // A lost answer to a create must not invite a blind resend.
  return outcome.kind === "unknown" ? { kind: "unknown" as const, message: ADMIN_CLIENT_MESSAGES.createUnknown } : outcome;
}

export function submitProductPatch(id: string, patch: ProductPatch, fetchImpl: typeof fetch = fetch) {
  return sendAdminRequest(
    { path: adminProductEndpoint(id), method: "PATCH", body: patch, successStatus: 200, readValue: readProduct },
    fetchImpl,
  );
}

// Asks for exactly one step forward. The answer carries the status the server
// stored; a 409 means the order was not in the status right before `to` (for
// example another tab already moved it) and nothing was changed.
export function submitOrderStatus(id: number, to: OrderStatus, fetchImpl: typeof fetch = fetch) {
  return sendAdminRequest(
    { path: adminOrderStatusEndpoint(id), method: "PATCH", body: { to }, successStatus: 200, readValue: readOrder },
    fetchImpl,
  );
}

export async function submitNewMilkOption(fields: MilkOptionFields, fetchImpl: typeof fetch = fetch) {
  const outcome = await sendAdminRequest(
    { path: ADMIN_MILK_OPTIONS_ENDPOINT, method: "POST", body: fields, successStatus: 201, readValue: readMilkOption },
    fetchImpl,
  );
  // A lost answer to a create must not invite a blind resend.
  return outcome.kind === "unknown"
    ? { kind: "unknown" as const, message: ADMIN_CLIENT_MESSAGES.milkOptionCreateUnknown }
    : outcome;
}

// Sends absolute values (a surcharge, a target availability); the answer
// carries the option as the server stored it.
export function submitMilkOptionPatch(id: string, patch: MilkOptionPatch, fetchImpl: typeof fetch = fetch) {
  return sendAdminRequest(
    { path: adminMilkOptionEndpoint(id), method: "PATCH", body: patch, successStatus: 200, readValue: readMilkOption },
    fetchImpl,
  );
}
