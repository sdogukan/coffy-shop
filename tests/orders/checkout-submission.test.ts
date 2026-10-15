import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CheckoutDraft,
  createCheckoutSubmitter,
  createIdempotencyKey,
  ORDERS_ENDPOINT,
  sendOrderRequest,
  serializeOrderRequest,
  trackingUrl,
} from "../../src/orders/checkout-submission.ts";
import { parseOrderRequest } from "../../src/orders/order-request.ts";

const DRAFT: CheckoutDraft = {
  customerName: "Ayşe",
  note: "Az şekerli",
  cart: [
    { productId: "espresso", quantity: 2 },
    { productId: "latte", quantity: 1 },
  ],
};

const TRACKING_PATH = `/siparis/${"a".repeat(43)}`;
const PLACED = { reference: "C-1001", trackingPath: TRACKING_PATH, totalKurus: 31550 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Records every request body and answers from the given list in order.
function scriptedFetch(...answers: (Response | Error)[]) {
  const bodies: string[] = [];
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(init?.body as string);
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error("unexpected request");
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl.mock.calls, bodies };
}

function keys(...values: string[]) {
  return vi.fn(() => {
    const value = values.shift();
    if (value === undefined) {
      throw new Error("no key left");
    }
    return value;
  });
}

describe("serializeOrderRequest", () => {
  it("sends exactly customerName, note, items[{productId, quantity}] and idempotencyKey, without prices", () => {
    const cart = [{ productId: "espresso", quantity: 2, priceKurus: 1, lineTotalKurus: 2 } as never];
    const body = JSON.parse(serializeOrderRequest({ ...DRAFT, cart }, "key-0123456789abcdef"));
    expect(body).toEqual({
      customerName: "Ayşe",
      note: "Az şekerli",
      items: [{ productId: "espresso", quantity: 2 }],
      idempotencyKey: "key-0123456789abcdef",
    });
  });

  it("produces a body the order API accepts", () => {
    const parsed = parseOrderRequest(JSON.parse(serializeOrderRequest(DRAFT, createIdempotencyKey())));
    expect(parsed.ok).toBe(true);
  });
});

describe("createIdempotencyKey", () => {
  it("uses crypto.randomUUID when the context offers it", () => {
    const key = createIdempotencyKey({ randomUUID: () => "uuid-from-crypto", getRandomValues: vi.fn() });
    expect(key).toBe("uuid-from-crypto");
  });

  it("falls back to 128 random bits from getRandomValues outside a secure context", () => {
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      (array as unknown as Uint8Array).set(Array.from({ length: 16 }, (_, index) => index * 17));
      return array;
    };
    const key = createIdempotencyKey({ getRandomValues } as Pick<Crypto, "getRandomValues">);
    expect(key).toBe("00112233445566778899aabbccddeeff");
    expect(parseOrderRequest(JSON.parse(serializeOrderRequest(DRAFT, key))).ok).toBe(true);
  });

  it("gives a different key each time", () => {
    expect(createIdempotencyKey()).not.toBe(createIdempotencyKey());
  });
});

describe("sendOrderRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the body as JSON to the orders endpoint", async () => {
    const { fetchImpl, calls } = scriptedFetch(jsonResponse(201, PLACED));
    await sendOrderRequest('{"a":1}', fetchImpl);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(ORDERS_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(init?.body).toBe('{"a":1}');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the placed order on 201", async () => {
    const { fetchImpl } = scriptedFetch(jsonResponse(201, PLACED));
    expect(await sendOrderRequest("{}", fetchImpl)).toEqual({ kind: "placed", order: PLACED });
  });

  it.each([
    [400, { error: "Adınız 1 ile 60 karakter arasında olmalıdır.", code: "invalid_customer_name" }],
    [409, { error: "Bu sipariş isteği daha önce farklı bir içerikle gönderildi.", code: "idempotency_conflict" }],
  ])("returns the server's error message on %i", async (status, body) => {
    const { fetchImpl } = scriptedFetch(jsonResponse(status, body));
    expect(await sendOrderRequest("{}", fetchImpl)).toEqual({ kind: "rejected", message: body.error });
  });

  it("falls back to a Turkish message on a 4xx without an error field", async () => {
    const { fetchImpl } = scriptedFetch(new Response("Payload Too Large", { status: 413 }));
    const outcome = await sendOrderRequest("{}", fetchImpl);
    expect(outcome.kind).toBe("rejected");
    expect(outcome.kind === "rejected" && outcome.message).toContain("Siparişiniz alınamadı");
  });

  it.each([
    ["a network error", new TypeError("Failed to fetch")],
    ["a timeout", new DOMException("signal timed out", "TimeoutError")],
    ["a 502 from the proxy", new Response("Bad Gateway", { status: 502 })],
    ["a 201 with an unreadable body", new Response("<html>", { status: 201 })],
    ["a 201 without a tracking path", jsonResponse(201, { reference: "C-1001", totalKurus: 100 })],
  ])("reports an unknown result on %s", async (_name, answer) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchImpl } = scriptedFetch(answer);
    const outcome = await sendOrderRequest("{}", fetchImpl);
    expect(outcome.kind).toBe("unknown");
    expect(outcome.kind === "unknown" && outcome.message).toContain("Tekrar dene");
  });

  it("shows the server's message on a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchImpl } = scriptedFetch(jsonResponse(500, { error: "Siparişiniz şu anda alınamadı. Lütfen tekrar deneyin." }));
    expect(await sendOrderRequest("{}", fetchImpl)).toEqual({
      kind: "unknown",
      message: "Siparişiniz şu anda alınamadı. Lütfen tekrar deneyin.",
    });
  });
});

describe("checkout submitter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends one request for a double click", async () => {
    const { fetchImpl, calls } = scriptedFetch(jsonResponse(201, PLACED));
    const submitter = createCheckoutSubmitter(fetchImpl, keys("key-aaaaaaaaaaaaaaaa"));
    const first = submitter.submit(DRAFT);
    const second = submitter.submit(DRAFT);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect((await first?.outcome)?.kind).toBe("placed");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["a network error", () => new TypeError("Failed to fetch")],
    ["a 500", () => jsonResponse(500, { error: "Siparişiniz şu anda alınamadı. Lütfen tekrar deneyin." })],
    ["a timeout", () => new DOMException("signal timed out", "TimeoutError")],
  ])("retries after %s with the byte-identical captured body and the same key", async (_name, failure) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchImpl, bodies } = scriptedFetch(failure(), failure(), jsonResponse(201, PLACED));
    const createKey = keys("key-aaaaaaaaaaaaaaaa", "key-bbbbbbbbbbbbbbbb");
    const submitter = createCheckoutSubmitter(fetchImpl, createKey);

    expect((await submitter.submit(DRAFT)?.outcome)?.kind).toBe("unknown");
    // The form and the stored cart changed in the meantime (another tab).
    const changed: CheckoutDraft = { customerName: "Mehmet", note: "", cart: [{ productId: "latte", quantity: 5 }] };
    const retry = submitter.submit(changed);
    expect(retry?.draft).toBe(DRAFT);
    expect((await retry?.outcome)?.kind).toBe("unknown");
    expect((await submitter.submit(changed)?.outcome)?.kind).toBe("placed");

    expect(bodies).toHaveLength(3);
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[2]).toBe(bodies[0]);
    expect(bodies[0]).toBe(serializeOrderRequest(DRAFT, "key-aaaaaaaaaaaaaaaa"));
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  it("does not send a second request while the first one has no answer yet", async () => {
    let answer: (response: Response) => void = () => {};
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    const submitter = createCheckoutSubmitter(fetchImpl as unknown as typeof fetch, keys("key-aaaaaaaaaaaaaaaa"));
    const first = submitter.submit(DRAFT);
    expect(submitter.submit(DRAFT)).toBeNull();
    answer(jsonResponse(201, PLACED));
    await first?.outcome;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([400, 409])("releases the captured request after a %i so the next submit is a new request", async (status) => {
    const { fetchImpl, bodies } = scriptedFetch(
      jsonResponse(status, { error: "Sunucu mesajı", code: "x" }),
      jsonResponse(201, PLACED),
    );
    const submitter = createCheckoutSubmitter(fetchImpl, keys("key-aaaaaaaaaaaaaaaa", "key-bbbbbbbbbbbbbbbb"));
    expect(await submitter.submit(DRAFT)?.outcome).toEqual({ kind: "rejected", message: "Sunucu mesajı" });

    const corrected: CheckoutDraft = { ...DRAFT, cart: [{ productId: "espresso", quantity: 2 }] };
    const next = submitter.submit(corrected);
    expect(next?.draft).toBe(corrected);
    await next?.outcome;
    expect(bodies[1]).toBe(serializeOrderRequest(corrected, "key-bbbbbbbbbbbbbbbb"));
  });

  it("starts a new request with a new key after an order was placed", async () => {
    const { fetchImpl, bodies } = scriptedFetch(jsonResponse(201, PLACED), jsonResponse(201, PLACED));
    const submitter = createCheckoutSubmitter(fetchImpl, keys("key-aaaaaaaaaaaaaaaa", "key-bbbbbbbbbbbbbbbb"));
    await submitter.submit(DRAFT)?.outcome;
    await submitter.submit(DRAFT)?.outcome;
    expect(JSON.parse(bodies[0]).idempotencyKey).toBe("key-aaaaaaaaaaaaaaaa");
    expect(JSON.parse(bodies[1]).idempotencyKey).toBe("key-bbbbbbbbbbbbbbbb");
  });
});

describe("trackingUrl", () => {
  it("joins the page origin and the tracking path", () => {
    expect(trackingUrl("https://coffy.example", TRACKING_PATH)).toBe(`https://coffy.example${TRACKING_PATH}`);
  });
});
