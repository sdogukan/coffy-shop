import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as itemRoute from "../../app/api/admin/orders/[id]/route.ts";
import * as statusRoute from "../../app/api/admin/orders/[id]/status/route.ts";
import * as listRoute from "../../app/api/admin/orders/route.ts";
import { POST as login } from "../../app/api/admin/login/route.ts";
import { POST as logout } from "../../app/api/admin/logout/route.ts";
import { POST as placeOrder } from "../../app/api/orders/route.ts";
import OrderTrackingPage from "../../app/siparis/[token]/page.tsx";
import { ADMIN_ERRORS } from "../../src/admin/http.ts";
import { loginLimiter } from "../../src/admin/login-limiter.ts";
import { hashAdminPassword } from "../../src/admin/password.ts";
import { ADMIN_SESSION_COOKIE, createSessionToken, hashSessionToken } from "../../src/admin/session.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { openDatabase } from "../../src/db/connection.ts";
import { type OrderStatus, readOrderByTrackingToken } from "../../src/db/orders.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const USERNAME = "barista";
const PASSWORD = "Gizli-Kahve-Parolasi-42";
const ORIGIN = "http://localhost";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashAdminPassword(PASSWORD);
});

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
  return listRoute.GET(request("GET", "/api/admin/orders", { cookie, origin: null }));
}

function detail(id: string, cookie?: string) {
  return itemRoute.GET(request("GET", `/api/admin/orders/${encodeURIComponent(id)}`, { cookie, origin: null }), {
    params: Promise.resolve({ id }),
  });
}

function changeStatus(id: string, body: unknown, options: RequestOptions = {}) {
  return statusRoute.PATCH(request("PATCH", `/api/admin/orders/${encodeURIComponent(id)}/status`, { body, ...options }), {
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

function ordersTable() {
  return withDatabase((db) => db.prepare("SELECT * FROM orders ORDER BY id").all());
}

function setStatus(id: number, status: OrderStatus) {
  withDatabase((db) => db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id));
}

async function placeTestOrder(customerName: string, idempotencyKey: string, note?: string) {
  const response = await placeOrder(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName,
        ...(note === undefined ? {} : { note }),
        items: [
          { productId: "espresso", quantity: 2 },
          { productId: "americano", quantity: 1 },
        ],
        idempotencyKey,
      }),
    }),
  );
  const body = await response.json();
  return { reference: body.reference as string, token: (body.trackingPath as string).slice("/siparis/".length) };
}

async function renderTracking(token: string): Promise<string> {
  const element = await OrderTrackingPage({ params: Promise.resolve({ token }) });
  return renderToStaticMarkup(element as ReactElement);
}

describe("/api/admin/orders", () => {
  let temp: TempDatabase;
  let cookie: string;
  let first: { reference: string; token: string };

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
    first = await placeTestOrder("Ayşe", "admin_order_key_00001", "Az şekerli");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    temp.cleanup();
  });

  it("route modules are rendered per request and export only their own method", () => {
    expect(listRoute.dynamic).toBe("force-dynamic");
    expect(itemRoute.dynamic).toBe("force-dynamic");
    expect(statusRoute.dynamic).toBe("force-dynamic");
    expect(Object.keys(listRoute).sort()).toEqual(["GET", "dynamic"]);
    expect(Object.keys(itemRoute).sort()).toEqual(["GET", "dynamic"]);
    expect(Object.keys(statusRoute).sort()).toEqual(["PATCH", "dynamic"]);
  });

  it("GET lists every order newest first with the summary fields only", async () => {
    await placeTestOrder("Mehmet", "admin_order_key_00002");
    const { status, cacheControl, body } = await read(await list(cookie));
    expect(status).toBe(200);
    expect(cacheControl).toBe("no-store");
    expect(body).toEqual({
      orders: [
        { id: 2, reference: "C-1002", customerName: "Mehmet", status: "new", totalKurus: 29000, createdAt: expect.any(String) },
        { id: 1, reference: first.reference, customerName: "Ayşe", status: "new", totalKurus: 29000, createdAt: expect.any(String) },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(first.token);
  });

  it("GET /{id} returns the order with item snapshots and the note", async () => {
    const { status, cacheControl, body } = await read(await detail("1", cookie));
    expect(status).toBe(200);
    expect(cacheControl).toBe("no-store");
    expect(body).toEqual({
      order: {
        id: 1,
        reference: first.reference,
        status: "new",
        customerName: "Ayşe",
        note: "Az şekerli",
        totalKurus: 29000,
        createdAt: expect.any(String),
        updatedAt: null,
        items: [
          { productId: "americano", name: "Americano", unitPriceKurus: 11000, quantity: 1, lineTotalKurus: 11000 },
          { productId: "espresso", name: "Espresso", unitPriceKurus: 9000, quantity: 2, lineTotalKurus: 18000 },
        ],
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(first.token);
    expect(serialized).not.toContain("admin_order_key_00001");
    expect(serialized).not.toMatch(/tracking|idempotency|fingerprint/i);
  });

  it.each([
    ["an unknown id", "99"],
    ["zero", "0"],
    ["a leading zero", "01"],
    ["a negative id", "-1"],
    ["a decimal", "1.0"],
    ["a reference", "C-1001"],
    ["an id above the safe integer range", "9007199254740993"],
  ])("GET /{id} and PATCH with %s answer 404 with the order message", async (_label, id) => {
    const expected = {
      status: 404,
      cacheControl: "no-store",
      body: { error: ADMIN_ERRORS.order_not_found, code: "not_found" },
    };
    expect(await read(await detail(id, cookie))).toEqual(expected);
    expect(await read(await changeStatus(id, { to: "preparing" }, { cookie }))).toEqual(expected);
    expect(ADMIN_ERRORS.order_not_found).not.toBe(ADMIN_ERRORS.not_found);
  });

  it("GET /{id} answers 404 for a tracking token instead of looking it up", async () => {
    expect((await detail(first.token, cookie)).status).toBe(404);
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
    ])("%s: both GETs and PATCH answer 401 and nothing is written", async (_label, makeCookie) => {
      const before = ordersTable();
      for (const response of [
        await list(makeCookie()),
        await detail("1", makeCookie()),
        await changeStatus("1", { to: "preparing" }, { cookie: makeCookie() }),
      ]) {
        expect(await read(response)).toEqual({
          status: 401,
          cacheControl: "no-store",
          body: { error: ADMIN_ERRORS.unauthorized, code: "unauthorized" },
        });
      }
      expect(ordersTable()).toEqual(before);
    });
  });

  it("a cookie captured before logout is refused afterwards", async () => {
    await logout(request("POST", "/api/admin/logout", { cookie }));
    expect((await list(cookie)).status).toBe(401);
    expect((await detail("1", cookie)).status).toBe(401);
    expect((await changeStatus("1", { to: "preparing" }, { cookie })).status).toBe(401);
  });

  it("answers 401 for every route while the admin config is invalid, even with a live session", async () => {
    vi.stubEnv("COFFY_ADMIN_USERNAME", "");
    expect((await list(cookie)).status).toBe(401);
    expect((await detail("1", cookie)).status).toBe(401);
    expect((await changeStatus("1", { to: "preparing" }, { cookie })).status).toBe(401);
  });

  it.each([
    ["a missing Origin", null],
    ["another site's Origin", "http://evil.test"],
    ["an https Origin outside production", "https://localhost"],
  ])("PATCH with %s answers 403 before the session check and the order is unchanged", async (_label, origin) => {
    const before = ordersTable();
    for (const sessionCookie of [cookie, undefined]) {
      expect(await read(await changeStatus("1", { to: "preparing" }, { cookie: sessionCookie, origin }))).toEqual({
        status: 403,
        cacheControl: "no-store",
        body: { error: ADMIN_ERRORS.forbidden_origin, code: "forbidden_origin" },
      });
    }
    expect(ordersTable()).toEqual(before);
  });

  it("PATCH moves the order one step at a time and answers with the stored order", async () => {
    for (const to of ["preparing", "ready", "completed"] as const) {
      const { status, cacheControl, body } = await read(await changeStatus("1", { to }, { cookie }));
      expect(status).toBe(200);
      expect(cacheControl).toBe("no-store");
      expect(body).toEqual((await read(await detail("1", cookie))).body);
      expect(body.order).toMatchObject({ id: 1, status: to, updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
      expect(JSON.stringify(body)).not.toContain(first.token);
    }
  });

  it.each([
    ["skips a step", "new", "ready"],
    ["skips to completed", "new", "completed"],
    ["repeats the current status", "preparing", "preparing"],
    ["goes back", "ready", "preparing"],
    ["goes back to new", "ready", "new"],
    ["moves new to new", "new", "new"],
    ["changes a completed order", "completed", "ready"],
    ["reopens a completed order", "completed", "new"],
  ] as const)("PATCH that %s answers 409 invalid_transition and the order is unchanged", async (_label, from, to) => {
    setStatus(1, from);
    const before = ordersTable();
    expect(await read(await changeStatus("1", { to }, { cookie }))).toEqual({
      status: 409,
      cacheControl: "no-store",
      body: { error: ADMIN_ERRORS.invalid_transition, code: "invalid_transition" },
    });
    expect(ordersTable()).toEqual(before);
  });

  it("the second of two PATCHes for the same step loses with 409 and the first one's write stays", async () => {
    expect((await changeStatus("1", { to: "preparing" }, { cookie })).status).toBe(200);
    const after = ordersTable();
    expect(await read(await changeStatus("1", { to: "preparing" }, { cookie }))).toMatchObject({
      status: 409,
      body: { code: "invalid_transition" },
    });
    expect(ordersTable()).toEqual(after);
  });

  it.each([
    ["cancel", "cancel"],
    ["cancelled", "cancelled"],
    ["a Turkish label", "Hazırlanıyor"],
    ["an upper-case code", "PREPARING"],
    ["an empty string", ""],
    ["an inherited property name", "constructor"],
  ])("PATCH to %s answers 400 invalid_status and the order is unchanged", async (_label, to) => {
    const before = ordersTable();
    expect(await read(await changeStatus("1", { to }, { cookie }))).toEqual({
      status: 400,
      cacheControl: "no-store",
      body: { error: ADMIN_ERRORS.invalid_status, code: "invalid_status" },
    });
    expect(ordersTable()).toEqual(before);
  });

  it.each([
    ["an empty object", {}],
    ["a numeric to", { to: 1 }],
    ["a null to", { to: null }],
    ["an array to", { to: ["preparing"] }],
    ["an extra field", { to: "preparing", status: "completed" }],
    ["a status field instead of to", { status: "preparing" }],
    ["an array body", ["preparing"]],
    ["a string body", "preparing"],
    ["a null body", null],
  ])("PATCH with %s answers 400 invalid_request", async (_label, body) => {
    const before = ordersTable();
    expect(await read(await changeStatus("1", JSON.stringify(body), { cookie }))).toEqual({
      status: 400,
      cacheControl: "no-store",
      body: { error: ADMIN_ERRORS.invalid_request, code: "invalid_request" },
    });
    expect(ordersTable()).toEqual(before);
  });

  it.each([
    ["malformed JSON", "{\"to\":", "application/json"],
    ["a non-JSON content type", JSON.stringify({ to: "preparing" }), "text/plain"],
    ["no content type", JSON.stringify({ to: "preparing" }), null],
    ["an oversized body", JSON.stringify({ to: "preparing", pad: "a".repeat(300) }), "application/json"],
  ])("PATCH with %s answers 400 invalid_request", async (_label, body, contentType) => {
    const before = ordersTable();
    expect(await read(await changeStatus("1", body, { cookie, contentType }))).toMatchObject({
      status: 400,
      body: { code: "invalid_request" },
    });
    expect(ordersTable()).toEqual(before);
  });

  it("after a PATCH the customer's tracking page shows the new status", async () => {
    expect(await renderTracking(first.token)).toContain("Durum: Yeni");
    const listed = (await read(await list(cookie))).body.orders.find(
      (order: { reference: string }) => order.reference === first.reference,
    );

    expect((await changeStatus(String(listed.id), { to: "preparing" }, { cookie })).status).toBe(200);
    expect(readOrderByTrackingToken(first.token)?.status).toBe("preparing");
    expect(await renderTracking(first.token)).toContain("Durum: Hazırlanıyor");

    expect((await changeStatus(String(listed.id), { to: "ready" }, { cookie })).status).toBe(200);
    expect(await renderTracking(first.token)).toContain('<p class="order-status">Durum: Hazır</p>');
  });

  it("answers 500 without details when the order tables cannot be read", async () => {
    // The session check still passes; only the order queries fail.
    withDatabase((db) => db.exec("DROP TABLE order_items; DROP TABLE orders"));
    for (const response of [await list(cookie), await detail("1", cookie), await changeStatus("1", { to: "preparing" }, { cookie })]) {
      expect(await read(response)).toEqual({
        status: 500,
        cacheControl: "no-store",
        body: { error: ADMIN_ERRORS.server_error, code: "server_error" },
      });
    }
  });
});
