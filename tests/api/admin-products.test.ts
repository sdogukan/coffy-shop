import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as itemRoute from "../../app/api/admin/products/[id]/route.ts";
import * as listRoute from "../../app/api/admin/products/route.ts";
import { POST as login } from "../../app/api/admin/login/route.ts";
import { POST as logout } from "../../app/api/admin/logout/route.ts";
import { POST as placeOrder } from "../../app/api/orders/route.ts";
import { loginLimiter } from "../../src/admin/login-limiter.ts";
import { hashAdminPassword } from "../../src/admin/password.ts";
import { ADMIN_SESSION_COOKIE, createSessionToken, hashSessionToken } from "../../src/admin/session.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { openDatabase } from "../../src/db/connection.ts";
import { readMenu } from "../../src/db/menu.ts";
import { findOrderByTrackingToken } from "../../src/db/orders.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const USERNAME = "barista";
const PASSWORD = "Gizli-Kahve-Parolasi-42";
const ORIGIN = "http://localhost";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashAdminPassword(PASSWORD);
});

const NEW_PRODUCT = {
  categoryId: "sicak-kahveler",
  name: "Flat White",
  description: "Çift shot espresso ve ince süt.",
  priceKurus: 14000,
  isAvailable: true,
};

interface RequestOptions {
  body?: unknown;
  cookie?: string;
  origin?: string | null;
  contentType?: string | null;
}

function request(method: string, path: string, { body, cookie, origin = ORIGIN, contentType = "application/json" }: RequestOptions = {}) {
  const headers: Record<string, string> = { host: "localhost" };
  if (origin !== null) {
    headers.origin = origin;
  }
  if (contentType !== null && body !== undefined) {
    headers["content-type"] = contentType;
  }
  if (cookie !== undefined) {
    headers.cookie = cookie;
  }
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function list(cookie?: string) {
  return listRoute.GET(request("GET", "/api/admin/products", { cookie, origin: null }));
}

function create(body: unknown, options: RequestOptions = {}) {
  return listRoute.POST(request("POST", "/api/admin/products", { body, ...options }));
}

function patch(id: string, body: unknown, options: RequestOptions = {}) {
  return itemRoute.PATCH(request("PATCH", `/api/admin/products/${encodeURIComponent(id)}`, { body, ...options }), {
    params: Promise.resolve({ id }),
  });
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

function productsTable() {
  return withDatabase((db) => db.prepare("SELECT * FROM products ORDER BY id").all());
}

function orderPayload(productId: string, idempotencyKey: string) {
  return new Request("http://localhost/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerName: "Ayşe", items: [{ productId, quantity: 2 }], idempotencyKey }),
  });
}

describe("/api/admin/products", () => {
  let temp: TempDatabase;
  let cookie: string;

  beforeEach(async () => {
    temp = createTempDatabase();
    const db = openMigratedDatabase();
    seedCatalog(db);
    db.close();
    vi.stubEnv("COFFY_ADMIN_USERNAME", USERNAME);
    vi.stubEnv("COFFY_ADMIN_PASSWORD_HASH", passwordHash);
    loginLimiter.reset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await login(
      request("POST", "/api/admin/login", { body: { username: USERNAME, password: PASSWORD } }),
    );
    cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] as string;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    temp.cleanup();
  });

  it("route modules are rendered per request and export no DELETE", () => {
    expect(listRoute.dynamic).toBe("force-dynamic");
    expect(itemRoute.dynamic).toBe("force-dynamic");
    expect(Object.keys(listRoute).sort()).toEqual(["GET", "POST", "dynamic"]);
    expect(Object.keys(itemRoute).sort()).toEqual(["PATCH", "dynamic"]);
  });

  it("GET lists every category with every product, the unavailable ones included", async () => {
    const { status, cacheControl, body } = await read(await list(cookie));
    expect(status).toBe(200);
    expect(cacheControl).toBe("no-store");
    expect(body).toEqual({ categories: readMenu() });
    const coldBrew = body.categories[1].products.find((product: { id: string }) => product.id === "cold-brew");
    expect(coldBrew).toMatchObject({ isAvailable: false, priceKurus: 15000 });
  });

  describe("refuses without a valid session", () => {
    const expiredToken = createSessionToken();
    const revokedToken = createSessionToken();

    beforeEach(() => {
      withDatabase((db) => {
        const insert = db.prepare(
          "INSERT INTO admin_sessions (token_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?)",
        );
        insert.run(hashSessionToken(expiredToken), "2000-01-01T00:00:00.000Z", "2000-01-01T08:00:00.000Z", null);
        insert.run(hashSessionToken(revokedToken), new Date().toISOString(), "2999-01-01T00:00:00.000Z", new Date().toISOString());
      });
    });

    it.each([
      ["no cookie", () => undefined],
      ["an unknown cookie", () => `${ADMIN_SESSION_COOKIE}=${createSessionToken()}`],
      ["a malformed cookie", () => `${ADMIN_SESSION_COOKIE}=../../etc`],
      ["an expired session", () => `${ADMIN_SESSION_COOKIE}=${expiredToken}`],
      ["a revoked session", () => `${ADMIN_SESSION_COOKIE}=${revokedToken}`],
    ])("%s: GET, POST and PATCH answer 401 and nothing is written", async (_label, makeCookie) => {
      const before = productsTable();
      for (const response of [
        await list(makeCookie()),
        await create(NEW_PRODUCT, { cookie: makeCookie() }),
        await patch("espresso", { isAvailable: false }, { cookie: makeCookie() }),
      ]) {
        expect(await read(response)).toEqual({
          status: 401,
          cacheControl: "no-store",
          body: { error: expect.any(String), code: "unauthorized" },
        });
      }
      expect(productsTable()).toEqual(before);
    });
  });

  it("a cookie captured before logout is refused afterwards", async () => {
    await logout(request("POST", "/api/admin/logout", { cookie }));
    expect((await list(cookie)).status).toBe(401);
    expect((await patch("espresso", { isAvailable: false }, { cookie })).status).toBe(401);
  });

  it("answers 401 for every route while the admin config is invalid, even with a live session", async () => {
    vi.stubEnv("COFFY_ADMIN_USERNAME", "");
    expect((await list(cookie)).status).toBe(401);
    expect((await create(NEW_PRODUCT, { cookie })).status).toBe(401);
    expect((await patch("espresso", { name: "X" }, { cookie })).status).toBe(401);
  });

  it.each([
    ["a missing Origin", null],
    ["another site's Origin", "http://evil.test"],
    ["an https Origin outside production", "https://localhost"],
  ])("POST and PATCH with %s answer 403 and the products table is unchanged", async (_label, origin) => {
    const before = productsTable();
    expect(await read(await create(NEW_PRODUCT, { cookie, origin }))).toMatchObject({
      status: 403,
      body: { code: "forbidden_origin" },
    });
    expect(await read(await patch("espresso", { isAvailable: false }, { cookie, origin }))).toMatchObject({
      status: 403,
      body: { code: "forbidden_origin" },
    });
    expect(productsTable()).toEqual(before);
  });

  it("POST creates a product in an existing category and returns it with 201", async () => {
    const { status, cacheControl, body } = await read(await create(NEW_PRODUCT, { cookie }));
    expect(status).toBe(201);
    expect(cacheControl).toBe("no-store");
    expect(body).toEqual({ product: { id: expect.stringMatching(/^[a-z0-9-]{1,64}$/), ...NEW_PRODUCT } });
    expect(readMenu()[0]?.products.at(-1)).toEqual(body.product);
  });

  it("POST creates a closed product that cannot be ordered", async () => {
    const { body } = await read(await create({ ...NEW_PRODUCT, isAvailable: false }, { cookie }));
    const order = await read(await placeOrder(orderPayload(body.product.id, "closed_new_product_01")));
    expect(order).toMatchObject({ status: 400, body: { code: "product_unavailable" } });
  });

  it.each([
    ["an unknown category", { categoryId: "tatlilar" }, "invalid_product"],
    ["an empty name", { name: "" }, "invalid_product"],
    ["a 61-character name", { name: "a".repeat(61) }, "invalid_product"],
    ["a 201-character description", { description: "a".repeat(201) }, "invalid_product"],
    ["a fractional price", { priceKurus: 135.5 }, "invalid_product"],
    ["a negative price", { priceKurus: -1 }, "invalid_product"],
    ["an oversized price", { priceKurus: 1_000_001 }, "invalid_product"],
    ["a string price", { priceKurus: "14000" }, "invalid_request"],
    ["a non-boolean isAvailable", { isAvailable: "true" }, "invalid_request"],
    ["a numeric name", { name: 7 }, "invalid_request"],
    ["an array category", { categoryId: ["sicak-kahveler"] }, "invalid_request"],
    ["an unknown field", { sortOrder: 1 }, "invalid_request"],
  ])("POST with %s answers 400 %s and writes nothing", async (_label, override, code) => {
    const before = productsTable();
    const { status, cacheControl, body } = await read(await create({ ...NEW_PRODUCT, ...override }, { cookie }));
    expect(status).toBe(400);
    expect(cacheControl).toBe("no-store");
    expect(body).toEqual({ error: expect.any(String), code });
    expect(productsTable()).toEqual(before);
  });

  it.each([
    ["malformed JSON", "{\"name\":", "application/json"],
    ["a non-JSON content type", JSON.stringify(NEW_PRODUCT), "text/plain"],
    ["an oversized body", JSON.stringify({ ...NEW_PRODUCT, description: "a".repeat(9000) }), "application/json"],
  ])("POST with %s answers 400 invalid_request", async (_label, body, contentType) => {
    const before = productsTable();
    expect(await read(await create(body, { cookie, contentType }))).toMatchObject({ status: 400, body: { code: "invalid_request" } });
    expect(productsTable()).toEqual(before);
  });

  it("PATCH edits only the fields sent and returns the product", async () => {
    const { status, body } = await read(await patch("espresso", { name: "Doppio", priceKurus: 9500 }, { cookie }));
    expect(status).toBe(200);
    expect(body).toEqual({
      product: {
        id: "espresso",
        categoryId: "sicak-kahveler",
        name: "Doppio",
        description: "Yoğun ve aromalı tek shot espresso.",
        priceKurus: 9500,
        isAvailable: true,
      },
    });
  });

  it("PATCH toggles availability, which the menu and ordering follow", async () => {
    expect(await read(await patch("espresso", { isAvailable: false }, { cookie }))).toMatchObject({
      status: 200,
      body: { product: { isAvailable: false, name: "Espresso" } },
    });
    expect(readMenu()[0]?.products.find((product) => product.id === "espresso")?.isAvailable).toBe(false);
    expect(await read(await placeOrder(orderPayload("espresso", "toggle_closed_order_01")))).toMatchObject({
      status: 400,
      body: { code: "product_unavailable" },
    });

    expect((await patch("espresso", { isAvailable: true }, { cookie })).status).toBe(200);
    expect(readMenu()[0]?.products.find((product) => product.id === "espresso")?.isAvailable).toBe(true);
    expect((await placeOrder(orderPayload("espresso", "toggle_reopened_order1"))).status).toBe(201);
  });

  it("renaming, repricing and closing a product leaves an earlier order unchanged", async () => {
    const placed = await read(await placeOrder(orderPayload("espresso", "snapshot_order_key_01")));
    const token = placed.body.trackingPath.slice("/siparis/".length);
    const before = withDatabase((db) => findOrderByTrackingToken(db, token));
    expect(before).toMatchObject({ totalKurus: 18000, items: [{ name: "Espresso", unitPriceKurus: 9000, lineTotalKurus: 18000 }] });

    await patch("espresso", { name: "Doppio" }, { cookie });
    await patch("espresso", { priceKurus: 25000 }, { cookie });
    await patch("espresso", { isAvailable: false }, { cookie });

    expect(withDatabase((db) => findOrderByTrackingToken(db, token))).toEqual(before);
  });

  it.each([
    ["an unknown id", "yok"],
    ["a 65-character id", "a".repeat(65)],
    ["an empty id", ""],
  ])("PATCH with %s answers 404 not_found", async (_label, id) => {
    expect(await read(await patch(id, { name: "X" }, { cookie }))).toEqual({
      status: 404,
      cacheControl: "no-store",
      body: { error: expect.any(String), code: "not_found" },
    });
  });

  it.each([
    ["an empty body", {}, "invalid_request"],
    ["a non-boolean isAvailable", { isAvailable: 0 }, "invalid_request"],
    ["an unknown category", { categoryId: "tatlilar" }, "invalid_product"],
    ["a zero price", { priceKurus: 0 }, "invalid_product"],
  ])("PATCH with %s answers 400 %s and writes nothing", async (_label, body, code) => {
    const before = productsTable();
    expect(await read(await patch("espresso", body, { cookie }))).toMatchObject({ status: 400, body: { code } });
    expect(productsTable()).toEqual(before);
  });

  it("answers 500 without details when the database is unavailable", async () => {
    temp.cleanup();
    expect(await read(await list(cookie))).toMatchObject({ status: 500, body: { code: "server_error" } });
  });
});
