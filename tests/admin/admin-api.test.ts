import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as itemRoute from "../../app/api/admin/products/[id]/route.ts";
import * as listRoute from "../../app/api/admin/products/route.ts";
import { POST as loginRoute } from "../../app/api/admin/login/route.ts";
import { POST as logoutRoute } from "../../app/api/admin/logout/route.ts";
import {
  ADMIN_CLIENT_MESSAGES,
  submitLogin,
  submitLogout,
  submitNewProduct,
  submitProductPatch,
} from "../../src/admin/admin-api.ts";
import { ADMIN_ERRORS } from "../../src/admin/http.ts";
import { loginLimiter } from "../../src/admin/login-limiter.ts";
import { hashAdminPassword } from "../../src/admin/password.ts";
import { PRODUCT_INPUT_ERRORS } from "../../src/admin/product-input.ts";
import { ADMIN_SESSION_COOKIE } from "../../src/admin/session.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { readProductById } from "../../src/db/admin-products.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const USERNAME = "barista";
const PASSWORD = "Gizli-Kahve-Parolasi-42";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashAdminPassword(PASSWORD);
});

const NEW_PRODUCT = {
  categoryId: "sicak-kahveler",
  name: "Flat White",
  description: "",
  priceKurus: 14050,
  isAvailable: true,
  containsMilk: true,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(response: Response | (() => Promise<Response>)) {
  return vi.fn<typeof fetch>(async () => (typeof response === "function" ? response() : response));
}

describe("admin requests", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends same-origin relative JSON requests with integer priceKurus and the target availability only", async () => {
    const fetchImpl = fakeFetch(jsonResponse(201, { product: { id: "x", ...NEW_PRODUCT } }));
    await submitNewProduct(NEW_PRODUCT, fetchImpl);
    await submitProductPatch("cold brew/1", { isAvailable: true }, fetchImpl);
    await submitLogin("barista", "parola", fetchImpl);
    await submitLogout(fetchImpl);

    const calls = fetchImpl.mock.calls.map(([path, init]) => ({ path, ...(init as RequestInit) }));
    expect(calls.map(({ path, method }) => `${method} ${path}`)).toEqual([
      "POST /api/admin/products",
      "PATCH /api/admin/products/cold%20brew%2F1",
      "POST /api/admin/login",
      "POST /api/admin/logout",
    ]);
    for (const call of calls) {
      expect(call.headers).toEqual({ "Content-Type": "application/json" });
      expect(call.credentials).toBe("same-origin");
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.parse(calls[0]?.body as string)).toEqual(NEW_PRODUCT);
    expect(JSON.parse(calls[1]?.body as string)).toEqual({ isAvailable: true });
    expect(JSON.parse(calls[2]?.body as string)).toEqual({ username: "barista", password: "parola" });
    expect(calls[3]?.body).toBeUndefined();
  });

  it.each([
    [400, "invalid_product", PRODUCT_INPUT_ERRORS.invalid_price],
    [403, "forbidden_origin", ADMIN_ERRORS.forbidden_origin],
    [404, "not_found", ADMIN_ERRORS.not_found],
    [429, "too_many_attempts", ADMIN_ERRORS.too_many_attempts],
    [503, "admin_disabled", ADMIN_ERRORS.admin_disabled],
    [500, "server_error", ADMIN_ERRORS.server_error],
  ])("reports a %i answer as failed with the server's message", async (status, code, error) => {
    const outcome = await submitProductPatch("espresso", { priceKurus: 1 }, fakeFetch(jsonResponse(status, { error, code })));
    expect(outcome).toEqual({ kind: "failed", message: error });
  });

  it("falls back to a generic Turkish message when an error body is unreadable", async () => {
    const outcome = await submitProductPatch("espresso", { name: "A" }, fakeFetch(new Response("<html>", { status: 502 })));
    expect(outcome).toEqual({ kind: "failed", message: ADMIN_CLIENT_MESSAGES.failed });
  });

  it("reports a 401 on a protected request as unauthorized", async () => {
    const body = { error: ADMIN_ERRORS.unauthorized, code: "unauthorized" };
    expect(await submitProductPatch("espresso", { isAvailable: false }, fakeFetch(jsonResponse(401, body)))).toEqual({
      kind: "unauthorized",
      message: ADMIN_ERRORS.unauthorized,
    });
  });

  it("reports a 401 login with the generic credentials message even without a body", async () => {
    expect(await submitLogin("a", "b", fakeFetch(new Response(null, { status: 401 })))).toEqual({
      kind: "unauthorized",
      message: ADMIN_CLIENT_MESSAGES.invalidCredentials,
    });
  });

  it("reports a network error as unknown, and a lost create with a check-the-list message", async () => {
    const failing = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await submitProductPatch("espresso", { isAvailable: false }, failing)).toEqual({
      kind: "unknown",
      message: ADMIN_CLIENT_MESSAGES.unreachable,
    });
    expect(await submitNewProduct(NEW_PRODUCT, failing)).toEqual({
      kind: "unknown",
      message: ADMIN_CLIENT_MESSAGES.createUnknown,
    });
    // Nothing is resent on its own.
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("treats a success status with a body that breaks the contract as unknown", async () => {
    const outcome = await submitProductPatch(
      "espresso",
      { isAvailable: false },
      fakeFetch(jsonResponse(200, { product: { id: "espresso", priceKurus: "90" } })),
    );
    expect(outcome.kind).toBe("unknown");
  });

  it("treats a product answer without a boolean containsMilk as unknown", async () => {
    const { containsMilk: _omitted, ...withoutMilk } = NEW_PRODUCT;
    for (const product of [{ id: "x", ...withoutMilk }, { id: "x", ...withoutMilk, containsMilk: 1 }]) {
      expect((await submitNewProduct(NEW_PRODUCT, fakeFetch(jsonResponse(201, { product })))).kind).toBe("unknown");
    }
  });

  it("returns only the contract's product fields", async () => {
    const product = { id: "espresso", ...NEW_PRODUCT, internal: "x" };
    const outcome = await submitProductPatch("espresso", { name: "A" }, fakeFetch(jsonResponse(200, { product })));
    expect(outcome).toEqual({ kind: "ok", value: { id: "espresso", ...NEW_PRODUCT } });
  });
});

// The browser side against the real route handlers: what the client sends is
// what the backend accepts, and what the backend answers is what the client
// reads. The adapter adds what a browser adds to a same-origin fetch: the
// Host, the Origin and the cookie jar.
describe("admin requests against the real /api/admin handlers", () => {
  let temp: TempDatabase;
  let cookieJar: string | undefined;

  const routes: Record<string, (request: Request, path: string) => Promise<Response> | Response> = {
    "POST /api/admin/login": (request) => loginRoute(request),
    "POST /api/admin/logout": (request) => logoutRoute(request),
    "POST /api/admin/products": (request) => listRoute.POST(request),
  };

  const browserFetch = vi.fn<typeof fetch>(async (input, init = {}) => {
    const path = String(input);
    const headers = new Headers(init.headers);
    headers.set("host", "localhost");
    headers.set("origin", "http://localhost");
    if (cookieJar !== undefined) {
      headers.set("cookie", cookieJar);
    }
    const request = new Request(`http://localhost${path}`, { ...init, headers });
    const key = `${init.method} ${path}`;
    const response = key.startsWith("PATCH /api/admin/products/")
      ? await itemRoute.PATCH(request, { params: Promise.resolve({ id: decodeURIComponent(path.split("/").pop() ?? "") }) })
      : await (routes[key] as (request: Request, path: string) => Promise<Response>)(request, path);
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

  it("logs in, creates, edits and toggles a product, logs out, and is unauthorized afterwards", async () => {
    expect(await submitLogin(USERNAME, "yanlis", browserFetch)).toEqual({
      kind: "unauthorized",
      message: ADMIN_ERRORS.invalid_credentials,
    });
    expect(await submitLogin(USERNAME, PASSWORD, browserFetch)).toEqual({ kind: "ok", value: true });
    expect(cookieJar).toBeDefined();

    const created = await submitNewProduct(NEW_PRODUCT, browserFetch);
    expect(created.kind).toBe("ok");
    const id = created.kind === "ok" ? created.value.id : "";
    expect(readProductById(id)).toMatchObject({ name: "Flat White", priceKurus: 14050, isAvailable: true, containsMilk: true });

    expect(await submitProductPatch(id, { name: "Flat White Büyük", priceKurus: 15000 }, browserFetch)).toMatchObject({
      kind: "ok",
      value: { id, name: "Flat White Büyük", priceKurus: 15000, isAvailable: true },
    });
    expect(await submitProductPatch("cold-brew", { isAvailable: true }, browserFetch)).toMatchObject({
      kind: "ok",
      value: { id: "cold-brew", isAvailable: true },
    });

    expect(await submitProductPatch("cold-brew", { priceKurus: 0 }, browserFetch)).toEqual({
      kind: "failed",
      message: PRODUCT_INPUT_ERRORS.invalid_price,
    });
    expect(await submitProductPatch("yok-boyle-urun", { isAvailable: true }, browserFetch)).toEqual({
      kind: "failed",
      message: ADMIN_ERRORS.not_found,
    });

    expect(await submitLogout(browserFetch)).toEqual({ kind: "ok", value: true });
    expect(cookieJar).toBeUndefined();
    expect(await submitProductPatch("cold-brew", { isAvailable: false }, browserFetch)).toEqual({
      kind: "unauthorized",
      message: ADMIN_ERRORS.unauthorized,
    });
    expect(readProductById("cold-brew")?.isAvailable).toBe(true);
  });

  it("is unauthorized with a session captured before a logout in another tab", async () => {
    await submitLogin(USERNAME, PASSWORD, browserFetch);
    const otherTab = cookieJar;
    await submitLogout(browserFetch);
    cookieJar = otherTab;
    expect((await submitNewProduct(NEW_PRODUCT, browserFetch)).kind).toBe("unauthorized");
  });
});
