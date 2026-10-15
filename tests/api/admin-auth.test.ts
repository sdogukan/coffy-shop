import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as loginRoute from "../../app/api/admin/login/route.ts";
import * as logoutRoute from "../../app/api/admin/logout/route.ts";
import { GET as listProducts } from "../../app/api/admin/products/route.ts";
import { POST as placeOrder } from "../../app/api/orders/route.ts";
import HomePage from "../../app/page.tsx";
import { LOGIN_MAX_ATTEMPTS, loginLimiter } from "../../src/admin/login-limiter.ts";
import { hashAdminPassword, verifyAdminPassword } from "../../src/admin/password.ts";
import { ADMIN_SESSION_COOKIE, hashSessionToken, readAdminSession } from "../../src/admin/session.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { openDatabase } from "../../src/db/connection.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

// Wraps the real verifier so a test can tell whether scrypt ran.
vi.mock("../../src/admin/password.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/password.ts")>();
  return { ...actual, verifyAdminPassword: vi.fn(actual.verifyAdminPassword) };
});

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
  method?: string;
}

function adminRequest(path: string, { body, cookie, origin = ORIGIN, contentType = "application/json", method = "POST" }: RequestOptions = {}) {
  const headers: Record<string, string> = { host: "localhost" };
  if (origin !== null) {
    headers.origin = origin;
  }
  if (contentType !== null) {
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

function login(body: unknown = { username: USERNAME, password: PASSWORD }, options: RequestOptions = {}) {
  return loginRoute.POST(adminRequest("/api/admin/login", { body, ...options }));
}

function logout(cookie?: string, options: RequestOptions = {}) {
  return logoutRoute.POST(adminRequest("/api/admin/logout", { cookie, contentType: null, ...options }));
}

function list(cookie?: string) {
  return listProducts(adminRequest("/api/admin/products", { method: "GET", cookie, origin: null, contentType: null }));
}

function sessionToken(response: Response): string {
  const match = /^coffy_admin_session=([A-Za-z0-9_-]{43});/.exec(response.headers.get("set-cookie") ?? "");
  if (match === null) {
    throw new Error("no session cookie");
  }
  return match[1] as string;
}

function withDatabase<T>(work: (db: DatabaseSync) => T): T {
  const db = openDatabase();
  try {
    return work(db);
  } finally {
    db.close();
  }
}

function sessionRows() {
  return withDatabase((db) => db.prepare("SELECT token_hash, revoked_at FROM admin_sessions").all()) as {
    token_hash: string;
    revoked_at: string | null;
  }[];
}

async function read(response: Response) {
  return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() };
}

describe("admin login and logout", () => {
  let temp: TempDatabase;
  const logged: string[] = [];

  beforeEach(() => {
    temp = createTempDatabase();
    const db = openMigratedDatabase();
    seedCatalog(db);
    db.close();
    vi.stubEnv("COFFY_ADMIN_USERNAME", USERNAME);
    vi.stubEnv("COFFY_ADMIN_PASSWORD_HASH", passwordHash);
    loginLimiter.reset();
    vi.mocked(verifyAdminPassword).mockClear();
    logged.length = 0;
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    temp.cleanup();
  });

  it("route modules are rendered per request and export only POST", () => {
    for (const route of [loginRoute, logoutRoute]) {
      expect(route.dynamic).toBe("force-dynamic");
      expect(Object.keys(route).sort()).toEqual(["POST", "dynamic"]);
    }
  });

  it("logs in with the configured credentials: 200, session cookie and exactly one row holding only the token hash", async () => {
    const response = await login();
    expect(await read(response)).toEqual({ status: 200, cacheControl: "no-store", body: { status: "ok" } });
    const token = sessionToken(response);
    expect(response.headers.get("set-cookie")).toBe(
      `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=28800; HttpOnly; SameSite=Lax`,
    );
    const rows = withDatabase((db) => db.prepare("SELECT * FROM admin_sessions").all()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(hashSessionToken(token));
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.values(rows[0] ?? {})).not.toContain(token);
    expect(readAdminSession(token)).not.toBeNull();
    expect((await list(`${ADMIN_SESSION_COOKIE}=${token}`)).status).toBe(200);
  });

  it("marks the cookie Secure under NODE_ENV=production and then expects an https Origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await login(undefined, { origin: ORIGIN })).status).toBe(403);
    const response = await login(undefined, { origin: "https://localhost" });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/; HttpOnly; SameSite=Lax; Secure$/);
    expect(response.headers.get("set-cookie")).not.toContain("Domain");
  });

  it.each([
    ["a wrong password", { username: USERNAME, password: "yanlis-parola" }],
    ["a wrong username", { username: "admin", password: PASSWORD }],
    ["a username in another case", { username: "Barista", password: PASSWORD }],
  ])("answers %s with the same generic 401 and writes no row", async (_label, body) => {
    const { status, cacheControl, body: payload } = await read(await login(body));
    expect(status).toBe(401);
    expect(cacheControl).toBe("no-store");
    expect(payload).toEqual({ error: "Kullanıcı adı veya şifre hatalı.", code: "invalid_credentials" });
    expect(sessionRows()).toEqual([]);
  });

  it("still runs scrypt when the username is wrong", async () => {
    await login({ username: "admin", password: PASSWORD });
    expect(verifyAdminPassword).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["malformed JSON", "{\"username\":"],
    ["a JSON array", "[]"],
    ["a missing password", { username: USERNAME }],
    ["a numeric password", { username: USERNAME, password: 42 }],
    ["an empty username", { username: "", password: PASSWORD }],
    ["an oversized password", { username: USERNAME, password: "a".repeat(1025) }],
    ["an oversized body", { username: USERNAME, password: PASSWORD, pad: "a".repeat(20_000) }],
  ])("rejects %s with 400 invalid_request and no row", async (_label, body) => {
    expect(await read(await login(body))).toMatchObject({ status: 400, body: { code: "invalid_request" } });
    expect(sessionRows()).toEqual([]);
  });

  it("rejects a body that is not sent as application/json", async () => {
    expect((await login(undefined, { contentType: "text/plain" })).status).toBe(400);
    expect((await login(undefined, { contentType: null })).status).toBe(400);
    expect((await login(undefined, { contentType: "application/json; charset=utf-8" })).status).toBe(200);
  });

  it.each([
    ["a missing Origin", null],
    ["another site's Origin", "http://evil.test"],
  ])("refuses login with %s: 403, no scrypt, no row", async (_label, origin) => {
    expect(await read(await login(undefined, { origin }))).toMatchObject({ status: 403, body: { code: "forbidden_origin" } });
    expect(verifyAdminPassword).not.toHaveBeenCalled();
    expect(sessionRows()).toEqual([]);
  });

  it(`answers 429 after ${LOGIN_MAX_ATTEMPTS} failed logins without running scrypt, also for the right password`, async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS; attempt += 1) {
      expect((await login({ username: USERNAME, password: `yanlis-${attempt}` })).status).toBe(401);
    }
    expect(verifyAdminPassword).toHaveBeenCalledTimes(LOGIN_MAX_ATTEMPTS);

    const refused = await login();
    expect(await read(refused)).toMatchObject({ status: 429, cacheControl: "no-store", body: { code: "too_many_attempts" } });
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(verifyAdminPassword).toHaveBeenCalledTimes(LOGIN_MAX_ATTEMPTS);
    expect(sessionRows()).toEqual([]);
  });

  it("counts parallel attempts before any of them awaits scrypt", async () => {
    const responses = await Promise.all(
      Array.from({ length: LOGIN_MAX_ATTEMPTS + 3 }, (_, attempt) => login({ username: USERNAME, password: `yanlis-${attempt}` })),
    );
    expect(responses.filter((response) => response.status === 429)).toHaveLength(3);
    expect(verifyAdminPassword).toHaveBeenCalledTimes(LOGIN_MAX_ATTEMPTS);
  });

  it("a successful login clears the failed-attempt count", async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS - 1; attempt += 1) {
      await login({ username: USERNAME, password: "yanlis" });
    }
    expect((await login()).status).toBe(200);
    for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS - 1; attempt += 1) {
      expect((await login({ username: USERNAME, password: "yanlis" })).status).toBe(401);
    }
  });

  it("logout revokes the session: the captured cookie gets 401 afterwards and the cookie is cleared", async () => {
    const token = sessionToken(await login());
    const cookie = `${ADMIN_SESSION_COOKIE}=${token}`;
    expect((await list(cookie)).status).toBe(200);

    const response = await logout(cookie);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBe(`${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    expect(sessionRows()).toEqual([{ token_hash: hashSessionToken(token), revoked_at: expect.any(String) }]);

    expect(await read(await list(cookie))).toMatchObject({ status: 401, body: { code: "unauthorized" } });
  });

  it.each([
    ["no cookie", undefined],
    ["an unknown cookie", `${ADMIN_SESSION_COOKIE}=${"x".repeat(43)}`],
    ["a malformed cookie", `${ADMIN_SESSION_COOKIE}=abc`],
  ])("logout with %s still answers 204 and clears the cookie", async (_label, cookie) => {
    const response = await logout(cookie);
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("logout with an expired session still clears the cookie", async () => {
    const token = sessionToken(await login());
    withDatabase((db) => db.prepare("UPDATE admin_sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run());
    const response = await logout(`${ADMIN_SESSION_COOKIE}=${token}`);
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each([
    ["a missing Origin", null],
    ["another site's Origin", "http://evil.test"],
  ])("refuses logout with %s: 403 and the session stays valid", async (_label, origin) => {
    const token = sessionToken(await login());
    const cookie = `${ADMIN_SESSION_COOKIE}=${token}`;
    expect(await read(await logout(cookie, { origin }))).toMatchObject({ status: 403, body: { code: "forbidden_origin" } });
    expect((await list(cookie)).status).toBe(200);
  });

  describe("with invalid admin config", () => {
    it.each([
      ["the username is missing", { COFFY_ADMIN_USERNAME: undefined }],
      ["the username is empty", { COFFY_ADMIN_USERNAME: "" }],
      ["the hash is missing", { COFFY_ADMIN_PASSWORD_HASH: undefined }],
      ["the hash is empty", { COFFY_ADMIN_PASSWORD_HASH: "" }],
      ["the hash is malformed", { COFFY_ADMIN_PASSWORD_HASH: "scrypt.1.1.1.a.b" }],
    ])("login answers 503 without a row and without scrypt when %s", async (_label, overrides) => {
      for (const [name, value] of Object.entries(overrides)) {
        vi.stubEnv(name, value);
      }
      expect(await read(await login())).toMatchObject({
        status: 503,
        cacheControl: "no-store",
        body: { error: expect.any(String), code: "admin_disabled" },
      });
      expect(verifyAdminPassword).not.toHaveBeenCalled();
      expect(sessionRows()).toEqual([]);
    });

    it("an existing session is rejected once the config breaks, while the menu and ordering keep working", async () => {
      const cookie = `${ADMIN_SESSION_COOKIE}=${sessionToken(await login())}`;
      vi.stubEnv("COFFY_ADMIN_PASSWORD_HASH", "");

      expect(await read(await list(cookie))).toMatchObject({ status: 401, body: { code: "unauthorized" } });

      expect(renderToStaticMarkup(createElement(HomePage))).toContain("<h3>Espresso</h3>");
      const order = await placeOrder(
        new Request("http://localhost/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: "Ayşe",
            items: [{ productId: "espresso", quantity: 1 }],
            idempotencyKey: "admin_disabled_order_01",
          }),
        }),
      );
      expect(order.status).toBe(201);
    });
  });

  it("never logs the password, the configured hash, the session token or its hash", async () => {
    const token = sessionToken(await login());
    await login({ username: USERNAME, password: `${PASSWORD}-yanlis` });
    await login({ username: `${USERNAME}-yanlis`, password: PASSWORD });
    await list(`${ADMIN_SESSION_COOKIE}=${token}`);
    await logout(`${ADMIN_SESSION_COOKIE}=${token}`);
    temp.cleanup();
    // The database is gone, so the next steps hit and log their error paths.
    await login();
    await list(`${ADMIN_SESSION_COOKIE}=${token}`);
    await logout(`${ADMIN_SESSION_COOKIE}=${token}`);

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      for (const secret of [PASSWORD, passwordHash, passwordHash.split(".").at(-1) as string, token, hashSessionToken(token)]) {
        expect(line).not.toContain(secret);
      }
    }
  });
});
