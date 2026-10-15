import { describe, expect, it } from "vitest";
import {
  MAX_REQUEST_LINES,
  type OrderRequest,
  orderFingerprint,
  parseOrderRequest,
} from "../../src/orders/order-request.ts";

const KEY = "key_0123456789abcdef";

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerName: "Ayşe",
    note: "Az şekerli",
    items: [{ productId: "espresso", quantity: 2 }],
    idempotencyKey: KEY,
    ...overrides,
  };
}

function parsed(input: unknown): OrderRequest {
  const result = parseOrderRequest(input);
  if (!result.ok) {
    throw new Error(`expected a valid request, got ${result.code}`);
  }
  return result.request;
}

function codeOf(input: unknown): string | undefined {
  const result = parseOrderRequest(input);
  return result.ok ? undefined : result.code;
}

describe("parseOrderRequest", () => {
  it("trims the name and note, merges lines per product and sorts them", () => {
    const request = parsed(
      body({
        customerName: "  Ayşe Yılmaz  ",
        note: "  Az şekerli  ",
        items: [
          { productId: "latte", quantity: 1 },
          { productId: "espresso", quantity: 2 },
          { productId: "latte", quantity: 3 },
        ],
      }),
    );
    expect(request).toEqual({
      customerName: "Ayşe Yılmaz",
      note: "Az şekerli",
      items: [
        { productId: "espresso", quantity: 2 },
        { productId: "latte", quantity: 4 },
      ],
      idempotencyKey: KEY,
    });
  });

  it("drops client price and total fields instead of carrying them", () => {
    const request = parsed(
      body({
        totalKurus: 1,
        items: [{ productId: "espresso", quantity: 2, priceKurus: 1, unitPriceKurus: 1, lineTotalKurus: 2 }],
      }),
    );
    expect(Object.keys(request).sort()).toEqual(["customerName", "idempotencyKey", "items", "note"]);
    expect(request.items).toEqual([{ productId: "espresso", quantity: 2 }]);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("stores a %s note as null", (_label, note) => {
    expect(parsed(body({ note })).note).toBeNull();
  });

  it("accepts a merged quantity of exactly 20 and rejects 21 from duplicate lines", () => {
    expect(
      parsed(body({ items: [{ productId: "espresso", quantity: 12 }, { productId: "espresso", quantity: 8 }] })).items,
    ).toEqual([{ productId: "espresso", quantity: 20 }]);
    const result = parseOrderRequest(
      body({ items: [{ productId: "espresso", quantity: 12 }, { productId: "espresso", quantity: 9 }] }),
    );
    expect(result).toEqual({ ok: false, code: "invalid_quantity", error: expect.stringContaining("20") });
  });

  it.each([0, -1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    "rejects quantity %s as invalid_quantity",
    (quantity) => {
      expect(codeOf(body({ items: [{ productId: "espresso", quantity }] }))).toBe("invalid_quantity");
    },
  );

  it("rejects an empty items array as empty_cart", () => {
    expect(parseOrderRequest(body({ items: [] }))).toEqual({
      ok: false,
      code: "empty_cart",
      error: expect.stringContaining("Sepetiniz boş"),
    });
  });

  it("accepts the maximum number of raw lines and rejects one more", () => {
    const lines = (count: number) => Array.from({ length: count }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
    expect(parsed(body({ items: lines(MAX_REQUEST_LINES) })).items).toHaveLength(MAX_REQUEST_LINES);
    expect(codeOf(body({ items: lines(MAX_REQUEST_LINES + 1) }))).toBe("invalid_request");
  });

  it("accepts a 60-character name counted in characters and rejects 61 or an empty one", () => {
    expect(parsed(body({ customerName: "ğ".repeat(60) })).customerName).toBe("ğ".repeat(60));
    expect(parsed(body({ customerName: "😀".repeat(60) })).customerName).toBe("😀".repeat(60));
    expect(codeOf(body({ customerName: "ğ".repeat(61) }))).toBe("invalid_customer_name");
    expect(codeOf(body({ customerName: "😀".repeat(61) }))).toBe("invalid_customer_name");
    expect(codeOf(body({ customerName: "" }))).toBe("invalid_customer_name");
    expect(codeOf(body({ customerName: "   " }))).toBe("invalid_customer_name");
    expect(codeOf(body({ customerName: "a".repeat(100_000) }))).toBe("invalid_customer_name");
  });

  it("accepts a 200-character note and rejects 201", () => {
    expect(parsed(body({ note: "ş".repeat(200) })).note).toBe("ş".repeat(200));
    expect(parseOrderRequest(body({ note: "ş".repeat(201) }))).toEqual({
      ok: false,
      code: "invalid_note",
      error: expect.stringContaining("200"),
    });
  });

  it.each([
    ["missing", undefined],
    ["too short", "a".repeat(15)],
    ["too long", "a".repeat(129)],
    ["with spaces", "key with spaces 0123"],
    ["with symbols", "key/0123456789abcdef"],
    ["a number", 1234567890123456],
  ])("rejects a %s idempotency key as invalid_request", (_label, idempotencyKey) => {
    expect(codeOf(body({ idempotencyKey }))).toBe("invalid_request");
  });

  it("accepts a UUID and a 128-character key", () => {
    expect(parsed(body({ idempotencyKey: "0b7f0e7a-3c1d-4f7e-9a51-2a4c1b2f3e4d" })).idempotencyKey).toBe(
      "0b7f0e7a-3c1d-4f7e-9a51-2a4c1b2f3e4d",
    );
    expect(parsed(body({ idempotencyKey: "a".repeat(128) })).idempotencyKey).toHaveLength(128);
  });

  it.each([
    ["a null body", null],
    ["an array body", [body()]],
    ["a string body", "order"],
    ["a numeric name", body({ customerName: 5 })],
    ["a missing name", body({ customerName: undefined })],
    ["a numeric note", body({ note: 5 })],
    ["items as an object", body({ items: { productId: "espresso", quantity: 1 } })],
    ["missing items", body({ items: undefined })],
    ["a null line", body({ items: [null] })],
    ["an array line", body({ items: [["espresso", 1]] })],
    ["a numeric product id", body({ items: [{ productId: 1, quantity: 1 }] })],
    ["an empty product id", body({ items: [{ productId: "", quantity: 1 }] })],
    ["a 65-character product id", body({ items: [{ productId: "p".repeat(65), quantity: 1 }] })],
    ["a string quantity", body({ items: [{ productId: "espresso", quantity: "2" }] })],
    ["a missing quantity", body({ items: [{ productId: "espresso" }] })],
  ])("rejects %s as invalid_request", (_label, input) => {
    expect(codeOf(input)).toBe("invalid_request");
  });
});

describe("orderFingerprint", () => {
  const base = parsed(body());

  it("is a SHA-256 hex digest", () => {
    expect(orderFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is equal for payloads that normalize to the same order", () => {
    const variant = parsed(
      body({
        customerName: " Ayşe ",
        note: "Az şekerli   ",
        items: [{ productId: "espresso", quantity: 1, priceKurus: 5 }, { productId: "espresso", quantity: 1 }],
      }),
    );
    expect(orderFingerprint(variant)).toBe(orderFingerprint(base));
  });

  it("is equal regardless of line order", () => {
    const a = parsed(body({ items: [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 2 }] }));
    const b = parsed(body({ items: [{ productId: "b", quantity: 2 }, { productId: "a", quantity: 1 }] }));
    expect(orderFingerprint(a)).toBe(orderFingerprint(b));
  });

  it("does not include the idempotency key", () => {
    expect(orderFingerprint(parsed(body({ idempotencyKey: "another_key_0123456789" })))).toBe(orderFingerprint(base));
  });

  it.each([
    ["name", body({ customerName: "Mehmet" })],
    ["note", body({ note: "Şekersiz" })],
    ["missing note", body({ note: null })],
    ["quantity", body({ items: [{ productId: "espresso", quantity: 3 }] })],
    ["product", body({ items: [{ productId: "americano", quantity: 2 }] })],
  ])("changes when the %s changes", (_label, input) => {
    expect(orderFingerprint(parsed(input))).not.toBe(orderFingerprint(base));
  });
});
