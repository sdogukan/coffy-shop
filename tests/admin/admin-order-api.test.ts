import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as statusRoute from "../../app/api/admin/orders/[id]/status/route.ts";
import { POST as loginRoute } from "../../app/api/admin/login/route.ts";
import { POST as logoutRoute } from "../../app/api/admin/logout/route.ts";
import { ADMIN_CLIENT_MESSAGES, submitLogin, submitLogout, submitOrderStatus } from "../../src/admin/admin-api.ts";
import { ADMIN_ERRORS } from "../../src/admin/http.ts";
import { loginLimiter } from "../../src/admin/login-limiter.ts";
import { hashAdminPassword } from "../../src/admin/password.ts";
import {
  ADMIN_ORDERS_ENDPOINT,
  ADMIN_ORDERS_PATH,
  adminOrderEndpoint,
  adminOrderPath,
  adminOrderStatusEndpoint,
} from "../../src/admin/paths.ts";
import { ADMIN_SESSION_COOKIE } from "../../src/admin/session.ts";
import { readOrderById } from "../../src/db/admin-orders.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { createOrder } from "../../src/db/orders.ts";
import { parseOrderRequest } from "../../src/orders/order-request.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const USERNAME = "barista";
const PASSWORD = "Gizli-Kahve-Parolasi-42";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashAdminPassword(PASSWORD);
});

const ORDER = {
  id: 7,
  reference: "C-1007",
  status: "preparing",
  customerName: "Ayşe",
  note: null,
  totalKurus: 18000,
  createdAt: "2026-10-15T09:00:00.000Z",
  updatedAt: "2026-10-15T09:05:00.000Z",
  items: [{ productId: "espresso", name: "Espresso", unitPriceKurus: 9000, quantity: 2, lineTotalKurus: 18000 }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(response: Response) {
  return vi.fn<typeof fetch>(async () => response);
}

describe("admin order paths", () => {
  it("address orders by their integer id", () => {
    expect(ADMIN_ORDERS_PATH).toBe("/yonetim/siparisler");
    expect(ADMIN_ORDERS_ENDPOINT).toBe("/api/admin/orders");
    expect(adminOrderPath(7)).toBe("/yonetim/siparisler/7");
    expect(adminOrderEndpoint(7)).toBe("/api/admin/orders/7");
    expect(adminOrderStatusEndpoint(7)).toBe("/api/admin/orders/7/status");
  });
});

describe("submitOrderStatus", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a same-origin relative PATCH with exactly {to} and reads the stored order", async () => {
    const fetchImpl = fakeFetch(jsonResponse(200, { order: { ...ORDER, extra: "x" } }));
    expect(await submitOrderStatus(7, "preparing", fetchImpl)).toEqual({ kind: "ok", value: ORDER });
    const [path, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/admin/orders/7/status");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body as string)).toEqual({ to: "preparing" });
  });

  it.each([
    [409, "invalid_transition", ADMIN_ERRORS.invalid_transition],
    [400, "invalid_status", ADMIN_ERRORS.invalid_status],
    [404, "not_found", ADMIN_ERRORS.order_not_found],
    [403, "forbidden_origin", ADMIN_ERRORS.forbidden_origin],
    [500, "server_error", ADMIN_ERRORS.server_error],
  ])("reports a %i answer as failed with the server's Turkish message", async (status, code, error) => {
    expect(await submitOrderStatus(7, "ready", fakeFetch(jsonResponse(status, { error, code })))).toEqual({
      kind: "failed",
      message: error,
    });
  });

  it("reports a 401 as unauthorized", async () => {
    const body = { error: ADMIN_ERRORS.unauthorized, code: "unauthorized" };
    expect(await submitOrderStatus(7, "ready", fakeFetch(jsonResponse(401, body)))).toEqual({
      kind: "unauthorized",
      message: ADMIN_ERRORS.unauthorized,
    });
  });

  it.each([
    ["no order", {}],
    ["an unknown status", { order: { ...ORDER, status: "cancelled" } }],
    ["a Turkish label as status", { order: { ...ORDER, status: "Hazır" } }],
    ["a string id", { order: { ...ORDER, id: "7" } }],
    ["a fractional total", { order: { ...ORDER, totalKurus: 1.5 } }],
    ["a numeric note", { order: { ...ORDER, note: 1 } }],
    ["a missing updatedAt", { order: { ...ORDER, updatedAt: undefined } }],
    ["items that are not a list", { order: { ...ORDER, items: {} } }],
    ["an item without a price", { order: { ...ORDER, items: [{ ...ORDER.items[0], unitPriceKurus: undefined }] } }],
  ])("treats a 200 with %s as unknown, never as the new status", async (_label, body) => {
    expect(await submitOrderStatus(7, "preparing", fakeFetch(jsonResponse(200, body)))).toEqual({
      kind: "unknown",
      message: ADMIN_CLIENT_MESSAGES.failed,
    });
  });

  it("reports a network error as unknown and does not resend", async () => {
    const failing = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await submitOrderStatus(7, "preparing", failing)).toEqual({
      kind: "unknown",
      message: ADMIN_CLIENT_MESSAGES.unreachable,
    });
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

// The browser side against the real status handler: what the client sends is
// what the backend accepts, and what the backend answers is what the client
// reads.
describe("submitOrderStatus against the real /api/admin handlers", () => {
  let temp: TempDatabase;
  let cookieJar: string | undefined;

  const browserFetch = vi.fn<typeof fetch>(async (input, init = {}) => {
    const path = String(input);
    const headers = new Headers(init.headers);
    headers.set("host", "localhost");
    headers.set("origin", "http://localhost");
    if (cookieJar !== undefined) {
      headers.set("cookie", cookieJar);
    }
    const request = new Request(`http://localhost${path}`, { ...init, headers });
    const statusPath = /^\/api\/admin\/orders\/([^/]+)\/status$/.exec(path);
    let response: Response;
    if (init.method === "PATCH" && statusPath !== null) {
      response = await statusRoute.PATCH(request, { params: Promise.resolve({ id: statusPath[1] as string }) });
    } else if (path === "/api/admin/login") {
      response = await loginRoute(request);
    } else {
      response = await logoutRoute(request);
    }
    const setCookie = response.headers.get("set-cookie");
    if (setCookie !== null) {
      const value = setCookie.split(";")[0]?.split("=")[1] ?? "";
      cookieJar = value === "" ? undefined : `${ADMIN_SESSION_COOKIE}=${value}`;
    }
    return response;
  });

  beforeEach(() => {
    temp = createTempDatabase();
    const db = openMigratedDatabase();
    seedCatalog(db);
    const parsed = parseOrderRequest({
      customerName: "Ayşe",
      items: [{ productId: "espresso", quantity: 2 }],
      idempotencyKey: "client_order_key_0001",
    });
    if (!parsed.ok) {
      throw new Error(parsed.code);
    }
    createOrder(db, parsed.request);
    db.close();
    cookieJar = undefined;
    vi.stubEnv("COFFY_ADMIN_USERNAME", USERNAME);
    vi.stubEnv("COFFY_ADMIN_PASSWORD_HASH", passwordHash);
    loginLimiter.reset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    temp.cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    loginLimiter.reset();
  });

  it("advances an order step by step, gets 409 for a stale step and 401 after logout", async () => {
    expect(await submitOrderStatus(1, "preparing", browserFetch)).toMatchObject({ kind: "unauthorized" });
    expect(readOrderById(1)?.status).toBe("new");

    expect(await submitLogin(USERNAME, PASSWORD, browserFetch)).toEqual({ kind: "ok", value: true });
    const advanced = await submitOrderStatus(1, "preparing", browserFetch);
    expect(advanced).toEqual({ kind: "ok", value: readOrderById(1) });
    expect(advanced).toMatchObject({ value: { status: "preparing", updatedAt: expect.any(String) } });

    // A second tab still showing "new" asks for the same step again.
    expect(await submitOrderStatus(1, "preparing", browserFetch)).toEqual({
      kind: "failed",
      message: ADMIN_ERRORS.invalid_transition,
    });
    expect(await submitOrderStatus(1, "completed", browserFetch)).toEqual({
      kind: "failed",
      message: ADMIN_ERRORS.invalid_transition,
    });
    expect(await submitOrderStatus(99, "ready", browserFetch)).toEqual({
      kind: "failed",
      message: ADMIN_ERRORS.order_not_found,
    });
    expect(readOrderById(1)?.status).toBe("preparing");

    expect(await submitLogout(browserFetch)).toEqual({ kind: "ok", value: true });
    expect(await submitOrderStatus(1, "ready", browserFetch)).toMatchObject({ kind: "unauthorized" });
    expect(readOrderById(1)?.status).toBe("preparing");
  });
});
