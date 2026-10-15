import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "../../app/api/orders/route.ts";
import { dynamic, POST } from "../../app/api/orders/route.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { openDatabase } from "../../src/db/connection.ts";
import { findOrderByTrackingToken } from "../../src/db/orders.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const KEY = "0b7f0e7a-3c1d-4f7e-9a51-2a4c1b2f3e4d";

function orderBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerName: "Ayşe",
    note: "Az şekerli",
    items: [
      { productId: "espresso", quantity: 2 },
      { productId: "americano", quantity: 1 },
    ],
    idempotencyKey: KEY,
    ...overrides,
  };
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function read(response: Response) {
  return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() };
}

function withDatabase<T>(work: (db: DatabaseSync) => T): T {
  const db = openDatabase();
  try {
    return work(db);
  } finally {
    db.close();
  }
}

function orderCount(): number {
  return withDatabase((db) => (db.prepare("SELECT COUNT(*) AS total FROM orders").get() as { total: number }).total);
}

describe("POST /api/orders", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
    const db = openMigratedDatabase();
    seedCatalog(db);
    db.close();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    temp.cleanup();
  });

  it("is rendered per request and exports no GET", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(Object.keys(route).sort()).toEqual(["POST", "dynamic"]);
  });

  it("returns 201 with the reference, tracking path and server-side total", async () => {
    const { status, cacheControl, body } = await read(await post(orderBody()));
    expect(status).toBe(201);
    expect(cacheControl).toBe("no-store");
    expect(body).toEqual({ reference: "C-1001", trackingPath: expect.stringMatching(/^\/siparis\/[A-Za-z0-9_-]{43}$/), totalKurus: 29000 });
    expect(Object.keys(body)).toEqual(["reference", "trackingPath", "totalKurus"]);
  });

  it("ignores client-sent price and total fields", async () => {
    const { body } = await read(
      await post(
        orderBody({
          totalKurus: 1,
          items: [
            { productId: "espresso", quantity: 2, priceKurus: 1, unitPriceKurus: 1, lineTotalKurus: 2 },
            { productId: "americano", quantity: 1, priceKurus: 1 },
          ],
        }),
      ),
    );
    expect(body.totalKurus).toBe(29000);
    const details = withDatabase((db) => findOrderByTrackingToken(db, body.trackingPath.slice("/siparis/".length)));
    expect(details?.items.map((item) => item.unitPriceKurus)).toEqual([11000, 9000]);
    expect(details?.totalKurus).toBe(29000);
  });

  it("replays the identical status and body for a resend of the same key and payload", async () => {
    const first = await read(await post(orderBody()));
    const second = await read(await post(orderBody()));
    expect(second).toEqual(first);
    expect(orderCount()).toBe(1);
  });

  it("replays the identical response after the product changed or went unavailable", async () => {
    const first = await read(await post(orderBody()));
    withDatabase((db) => db.exec("UPDATE products SET price_kurus = 1, is_available = 0 WHERE id = 'espresso'"));
    expect(await read(await post(orderBody()))).toEqual(first);
    expect(orderCount()).toBe(1);
  });

  it("returns 409 for the same key with a different payload and writes no order", async () => {
    await post(orderBody());
    const { status, cacheControl, body } = await read(await post(orderBody({ items: [{ productId: "espresso", quantity: 3 }] })));
    expect(status).toBe(409);
    expect(cacheControl).toBe("no-store");
    expect(body).toEqual({ error: expect.any(String), code: "idempotency_conflict" });
    expect(orderCount()).toBe(1);
  });

  it.each([
    ["empty items", orderBody({ items: [] }), "empty_cart"],
    ["quantity 0", orderBody({ items: [{ productId: "espresso", quantity: 0 }] }), "invalid_quantity"],
    ["quantity 21", orderBody({ items: [{ productId: "espresso", quantity: 21 }] }), "invalid_quantity"],
    [
      "duplicate lines summing to 21",
      orderBody({ items: [{ productId: "espresso", quantity: 11 }, { productId: "espresso", quantity: 10 }] }),
      "invalid_quantity",
    ],
    ["an unknown product", orderBody({ items: [{ productId: "unknown-product", quantity: 1 }] }), "unknown_product"],
    ["an unavailable product", orderBody({ items: [{ productId: "cold-brew", quantity: 1 }] }), "product_unavailable"],
    ["an empty name", orderBody({ customerName: "  " }), "invalid_customer_name"],
    ["a 61-character name", orderBody({ customerName: "a".repeat(61) }), "invalid_customer_name"],
    ["a 201-character note", orderBody({ note: "a".repeat(201) }), "invalid_note"],
    ["a missing idempotency key", orderBody({ idempotencyKey: undefined }), "invalid_request"],
    ["a malformed idempotency key", orderBody({ idempotencyKey: "short" }), "invalid_request"],
    ["a string quantity", orderBody({ items: [{ productId: "espresso", quantity: "2" }] }), "invalid_request"],
    ["malformed JSON", "{\"customerName\":", "invalid_request"],
    ["a JSON array", "[]", "invalid_request"],
    ["an empty body", "", "invalid_request"],
  ])("rejects %s with 400 and writes no order", async (_label, input, code) => {
    const { status, cacheControl, body } = await read(await post(input));
    expect(status).toBe(400);
    expect(cacheControl).toBe("no-store");
    expect(body).toEqual({ error: expect.any(String), code });
    expect(body.error.length).toBeGreaterThan(0);
    expect(orderCount()).toBe(0);
  });

  it("names the unavailable product by its menu name in Turkish", async () => {
    const { body } = await read(await post(orderBody({ items: [{ productId: "cold-brew", quantity: 1 }] })));
    expect(body.error).toBe("Cold Brew şu anda satışta değil. Lütfen sepetinizden çıkarın.");
  });

  it("rejects an oversized body before parsing it", async () => {
    const { status, body } = await read(await post(orderBody({ note: "a".repeat(70_000) })));
    expect(status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(orderCount()).toBe(0);
  });

  it("returns a generic 500 without the database path when the database is missing", async () => {
    const path = join(temp.dir, "missing.sqlite");
    process.env.COFFY_DATABASE_PATH = path;
    const response = await post(orderBody());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "Siparişiniz şu anda alınamadı. Lütfen tekrar deneyin." });
    expect(text).not.toContain(temp.dir);
    expect(console.error).toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
  });
});
