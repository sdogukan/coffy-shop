import type { Cart } from "../cart/cart.ts";

// Browser side of POST /api/orders. The first submit captures the whole
// request body, idempotency key included. Until the server answers
// definitively, every retry resends exactly that string, whatever the form
// or the stored cart says by then, so a lost response can never turn into a
// second order. Prices are never sent: the server prices every line.

export const ORDERS_ENDPOINT = "/api/orders";
export const ORDER_REQUEST_TIMEOUT_MS = 20_000;

const TRACKING_PATH_PREFIX = "/siparis/";
const UNKNOWN_RESULT_MESSAGE =
  "Siparişinizin alınıp alınmadığı doğrulanamadı. Aynı siparişi yeniden göndermek için Tekrar dene düğmesine basın.";
const GENERIC_REJECTION_MESSAGE = "Siparişiniz alınamadı. Lütfen bilgilerinizi kontrol edip tekrar deneyin.";

export interface CheckoutDraft {
  readonly customerName: string;
  readonly note: string;
  readonly cart: Cart;
}

export interface PlacedOrderResponse {
  readonly reference: string;
  readonly trackingPath: string;
  readonly totalKurus: number;
}

// placed: 201. rejected: a 4xx, the order was not created and the captured
// request is released. unknown: network error, timeout, 5xx or an unreadable
// 201; the captured request is kept for the retry.
export type CheckoutOutcome =
  | { kind: "placed"; order: PlacedOrderResponse }
  | { kind: "rejected"; message: string }
  | { kind: "unknown"; message: string };

interface CapturedRequest {
  readonly draft: CheckoutDraft;
  readonly body: string;
}

export interface CheckoutAttempt {
  // The draft this attempt sends: the captured one on a retry.
  readonly draft: CheckoutDraft;
  readonly outcome: Promise<CheckoutOutcome>;
}

type CryptoSource = Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string };

// crypto.randomUUID exists only in secure contexts (HTTPS or localhost);
// getRandomValues is available everywhere. Both give 122+ random bits.
export function createIdempotencyKey(source: CryptoSource = globalThis.crypto): string {
  if (typeof source.randomUUID === "function") {
    return source.randomUUID();
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Only the fields the API reads, in a fixed order.
export function serializeOrderRequest(draft: CheckoutDraft, idempotencyKey: string): string {
  return JSON.stringify({
    customerName: draft.customerName,
    note: draft.note,
    items: draft.cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    idempotencyKey,
  });
}

function isPlacedOrderResponse(value: unknown): value is PlacedOrderResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { reference, trackingPath, totalKurus } = value as Record<string, unknown>;
  return (
    typeof reference === "string" &&
    reference.length > 0 &&
    typeof trackingPath === "string" &&
    trackingPath.startsWith(TRACKING_PATH_PREFIX) &&
    trackingPath.length > TRACKING_PATH_PREFIX.length &&
    Number.isSafeInteger(totalKurus)
  );
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

export async function sendOrderRequest(body: string, fetchImpl: typeof fetch = fetch): Promise<CheckoutOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(ORDERS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(ORDER_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Order request failed before a response arrived", error);
    return { kind: "unknown", message: UNKNOWN_RESULT_MESSAGE };
  }
  const payload = await readJson(response);
  if (response.status === 201) {
    if (isPlacedOrderResponse(payload)) {
      return {
        kind: "placed",
        order: { reference: payload.reference, trackingPath: payload.trackingPath, totalKurus: payload.totalKurus },
      };
    }
    // The order exists but its details are unreadable; a retry with the same
    // key replays them.
    console.error("Order response 201 had an unexpected body");
    return { kind: "unknown", message: UNKNOWN_RESULT_MESSAGE };
  }
  if (response.status >= 400 && response.status < 500) {
    return { kind: "rejected", message: serverMessage(payload) ?? GENERIC_REJECTION_MESSAGE };
  }
  console.error(`Order request answered with status ${response.status}`);
  return { kind: "unknown", message: serverMessage(payload) ?? UNKNOWN_RESULT_MESSAGE };
}

export interface CheckoutSubmitter {
  // null while a request is in flight: a second click sends nothing.
  submit(draft: CheckoutDraft): CheckoutAttempt | null;
}

export function createCheckoutSubmitter(
  fetchImpl: typeof fetch = fetch,
  createKey: () => string = createIdempotencyKey,
): CheckoutSubmitter {
  let captured: CapturedRequest | null = null;
  let inFlight = false;
  return {
    submit(draft) {
      if (inFlight) {
        return null;
      }
      const request = captured ?? { draft, body: serializeOrderRequest(draft, createKey()) };
      captured = request;
      inFlight = true;
      const outcome = sendOrderRequest(request.body, fetchImpl).then((result) => {
        inFlight = false;
        if (result.kind !== "unknown") {
          captured = null;
        }
        return result;
      });
      return { draft: request.draft, outcome };
    },
  };
}

export function trackingUrl(origin: string, trackingPath: string): string {
  return `${origin}${trackingPath}`;
}
