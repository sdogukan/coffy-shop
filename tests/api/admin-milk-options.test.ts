import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as itemRoute from "../../app/api/admin/milk-options/[id]/route.ts";
import * as listRoute from "../../app/api/admin/milk-options/route.ts";
import { GET as listProducts } from "../../app/api/admin/products/route.ts";
import { POST as login } from "../../app/api/admin/login/route.ts";
import { POST as placeOrder } from "../../app/api/orders/route.ts";
import { ADMIN_ERRORS } from "../../src/admin/http.ts";
import { loginLimiter } from "../../src/admin/login-limiter.ts";
import { MILK_OPTION_INPUT_ERRORS } from "../../src/admin/milk-option-input.ts";
import { hashAdminPassword } from "../../src/admin/password.ts";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "../../src/admin/session.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { openDatabase } from "../../src/db/connection.ts";
import { findOrderByTrackingToken } from "../../src/db/orders.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const USERNAME = "barista";
const PASSWORD = "Gizli-Kahve-Parolasi-42";
const ORIGIN = "http://localhost";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashAdminPassword(PASSWORD);
});

const OAT = { name: "Yulaf sütü", surchargeKurus: 1500 };
const NORMAL_MILK = { id: "normal-sut", name: "Normal süt", surchargeKurus: 0, isDefault: true, isAvailable: true };

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

function create(body: unknown, options: RequestOptions = {}) {
  return listRoute.POST(request("POST", "/api/admin/milk-options", { body, ...options }));
}

function patch(id: string, body: unknown, options: RequestOptions = {}) {
  return itemRoute.PATCH(request("PATCH", `/api/admin/milk-options/${encodeURIComponent(id)}`, { body, ...options }), {
    params: Promise.resolve({ id }),
  });
}

function list(cookie?: string) {
  return listProducts(request("GET", "/api/admin/products", { cookie, origin: null }));
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

function milkOptionsTable() {
  return withDatabase((db) => db.prepare("SELECT * FROM milk_options ORDER BY id").all());
}

describe("/api/admin/milk-options", () => {
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
    const response = await login(request("POST", "/api/admin/login", { body: { username: USERNAME, password: PASSWORD } }));
    cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] as string;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    temp.cleanup();
  });

  async function createOat(): Promise<string> {
    const { body } = await read(await create(OAT, { cookie }));
    return body.milkOption.id as string;
  }

  it("route modules are rendered per request and export no DELETE", () => {
    expect(listRoute.dynamic).toBe("force-dynamic");
    expect(itemRoute.dynamic).toBe("force-dynamic");
    expect(Object.keys(listRoute).sort()).toEqual(["POST", "dynamic"]);
    expect(Object.keys(itemRoute).sort()).toEqual(["PATCH", "dynamic"]);
  });

  it("POST creates an available option and returns it with 201", async () => {
    const { status, cacheControl, body } = await read(await create(OAT, { cookie }));
    expect(status).toBe(201);
    expect(cacheControl).toBe("no-store");
    expect(body).toEqual({
      milkOption: { id: expect.stringMatching(/^[a-z0-9-]{1,64}$/), ...OAT, isDefault: false, isAvailable: true },
    });
  });

  it("GET /api/admin/products lists only available options, Normal süt first", async () => {
    const oatId = await createOat();
    const { body: almond } = await read(await create({ name: "Badem sütü", surchargeKurus: 2000 }, { cookie }));
    await patch(oatId, { isAvailable: false }, { cookie });

    const { status, body } = await read(await list(cookie));
    expect(status).toBe(200);
    expect(body.milkOptions).toEqual([NORMAL_MILK, almond.milkOption]);
  });

  it.each([
    ["a zero surcharge", { surchargeKurus: 0 }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_surcharge],
    ["a surcharge above 1,000,000", { surchargeKurus: 1_000_001 }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_surcharge],
    ["a fractional surcharge", { surchargeKurus: 10.5 }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_surcharge],
    ["an empty name", { name: "" }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_name],
    ["a 61-character name", { name: "a".repeat(61) }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_name],
    ["a string surcharge", { surchargeKurus: "1500" }, "invalid_request", MILK_OPTION_INPUT_ERRORS.invalid_request],
    ["an unknown field", { isDefault: true }, "invalid_request", MILK_OPTION_INPUT_ERRORS.invalid_request],
  ])("POST with %s answers 400 %s with a Turkish message and stores nothing", async (_label, override, code, error) => {
    const before = milkOptionsTable();
    expect(await read(await create({ ...OAT, ...override }, { cookie }))).toEqual({
      status: 400,
      cacheControl: "no-store",
      body: { error, code },
    });
    expect(milkOptionsTable()).toEqual(before);
  });

  it.each([
    ["malformed JSON", "{\"name\":", "application/json"],
    ["a non-JSON content type", JSON.stringify(OAT), "text/plain"],
    ["an oversized body", JSON.stringify({ ...OAT, name: "a".repeat(2000) }), "application/json"],
  ])("POST with %s answers 400 invalid_request", async (_label, body, contentType) => {
    const before = milkOptionsTable();
    expect(await read(await create(body, { cookie, contentType }))).toMatchObject({ status: 400, body: { code: "invalid_request" } });
    expect(milkOptionsTable()).toEqual(before);
  });

  it("PATCH updates the surcharge and availability separately and returns 200", async () => {
    const id = await createOat();
    expect(await read(await patch(id, { surchargeKurus: 1750 }, { cookie }))).toEqual({
      status: 200,
      cacheControl: "no-store",
      body: { milkOption: { id, ...OAT, surchargeKurus: 1750, isDefault: false, isAvailable: true } },
    });
    expect(await read(await patch(id, { isAvailable: false }, { cookie }))).toMatchObject({
      status: 200,
      body: { milkOption: { surchargeKurus: 1750, isAvailable: false } },
    });
    expect(await read(await patch(id, { surchargeKurus: 1800, isAvailable: true }, { cookie }))).toMatchObject({
      status: 200,
      body: { milkOption: { surchargeKurus: 1800, isAvailable: true } },
    });
  });

  it.each([
    ["a surcharge", { surchargeKurus: 500 }],
    ["a removal", { isAvailable: false }],
  ])("PATCH on Normal süt with %s is refused with 400 default_milk_option and changes nothing", async (_label, body) => {
    const before = milkOptionsTable();
    expect(await read(await patch("normal-sut", body, { cookie }))).toEqual({
      status: 400,
      cacheControl: "no-store",
      body: { error: ADMIN_ERRORS.default_milk_option, code: "default_milk_option" },
    });
    expect(milkOptionsTable()).toEqual(before);
    expect((await read(await list(cookie))).body.milkOptions).toEqual([NORMAL_MILK]);
  });

  it.each([
    ["an unknown id", "yok"],
    ["a 65-character id", "a".repeat(65)],
    ["an empty id", ""],
  ])("PATCH with %s answers 404 not_found with the milk option message", async (_label, id) => {
    expect(await read(await patch(id, { isAvailable: false }, { cookie }))).toEqual({
      status: 404,
      cacheControl: "no-store",
      body: { error: ADMIN_ERRORS.milk_option_not_found, code: "not_found" },
    });
  });

  it.each([
    ["an empty body", {}, "invalid_request"],
    ["a name", { name: "Yeni ad" }, "invalid_request"],
    ["an unknown field", { isDefault: true }, "invalid_request"],
    ["a non-boolean isAvailable", { isAvailable: 0 }, "invalid_request"],
    ["a zero surcharge", { surchargeKurus: 0 }, "invalid_milk_option"],
    ["an oversized surcharge", { surchargeKurus: 1_000_001 }, "invalid_milk_option"],
  ])("PATCH with %s answers 400 %s and writes nothing", async (_label, body, code) => {
    const id = await createOat();
    const before = milkOptionsTable();
    expect(await read(await patch(id, body, { cookie }))).toMatchObject({ status: 400, body: { code } });
    expect(milkOptionsTable()).toEqual(before);
  });

  it.each([
    ["no cookie", () => undefined],
    ["an unknown cookie", () => `${ADMIN_SESSION_COOKIE}=${createSessionToken()}`],
  ])("POST and PATCH with %s answer 401 and nothing is written", async (_label, makeCookie) => {
    const id = await createOat();
    const before = milkOptionsTable();
    for (const response of [
      await create(OAT, { cookie: makeCookie() }),
      await patch(id, { isAvailable: false }, { cookie: makeCookie() }),
    ]) {
      expect(await read(response)).toEqual({
        status: 401,
        cacheControl: "no-store",
        body: { error: ADMIN_ERRORS.unauthorized, code: "unauthorized" },
      });
    }
    expect(milkOptionsTable()).toEqual(before);
  });

  it.each([
    ["a missing Origin", null],
    ["another site's Origin", "http://evil.test"],
  ])("POST and PATCH with %s answer 403 forbidden_origin and nothing is written", async (_label, origin) => {
    const id = await createOat();
    const before = milkOptionsTable();
    for (const response of [await create(OAT, { cookie, origin }), await patch(id, { isAvailable: false }, { cookie, origin })]) {
      expect(await read(response)).toEqual({
        status: 403,
        cacheControl: "no-store",
        body: { error: ADMIN_ERRORS.forbidden_origin, code: "forbidden_origin" },
      });
    }
    expect(milkOptionsTable()).toEqual(before);
  });

  it("changing a surcharge and removing an option leave an earlier order's total and items unchanged", async () => {
    const id = await createOat();
    const placed = await read(
      await placeOrder(
        new Request("http://localhost/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: "Ayşe",
            items: [{ productId: "cappuccino", quantity: 2 }],
            idempotencyKey: "milk_api_snapshot_01",
          }),
        }),
      ),
    );
    expect(placed.status).toBe(201);
    const token = placed.body.trackingPath.slice("/siparis/".length);
    const before = withDatabase((db) => findOrderByTrackingToken(db, token));
    const rowsBefore = withDatabase((db) => [db.prepare("SELECT * FROM orders").all(), db.prepare("SELECT * FROM order_items").all()]);

    expect((await patch(id, { surchargeKurus: 9000 }, { cookie })).status).toBe(200);
    expect((await patch(id, { isAvailable: false }, { cookie })).status).toBe(200);

    expect(withDatabase((db) => findOrderByTrackingToken(db, token))).toEqual(before);
    expect(withDatabase((db) => [db.prepare("SELECT * FROM orders").all(), db.prepare("SELECT * FROM order_items").all()])).toEqual(
      rowsBefore,
    );
  });

  it("answers 500 without details and logs the cause when the write fails", async () => {
    const id = await createOat();
    withDatabase((db) => db.exec("DROP TABLE milk_options"));
    for (const response of [await create(OAT, { cookie }), await patch(id, { isAvailable: false }, { cookie }), await list(cookie)]) {
      expect(await read(response)).toEqual({
        status: 500,
        cacheControl: "no-store",
        body: { error: ADMIN_ERRORS.server_error, code: "server_error" },
      });
    }
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("no such table: milk_options"));
  });
});
