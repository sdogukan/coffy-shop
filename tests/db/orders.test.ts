import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetCatalog, seedCatalog } from "../../src/db/catalog.ts";
import { DATABASE_PATH_ENV } from "../../src/db/connection.ts";
import * as orders from "../../src/db/orders.ts";
import {
  type CreateOrderResult,
  createOrder,
  findOrderByTrackingToken,
  placeOrder,
  readOrderByTrackingToken,
} from "../../src/db/orders.ts";
import { type OrderRequest, parseOrderRequest } from "../../src/orders/order-request.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const WORKER = fileURLToPath(new URL("../helpers/create-order-worker.ts", import.meta.url));

function requestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerName: "Ayşe",
    note: "Az şekerli",
    items: [
      { productId: "espresso", quantity: 2 },
      { productId: "americano", quantity: 1 },
    ],
    idempotencyKey: "order_key_0123456789",
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}): OrderRequest {
  const parsed = parseOrderRequest(requestBody(overrides));
  if (!parsed.ok) {
    throw new Error(`invalid test request: ${parsed.code}`);
  }
  return parsed.request;
}

function placed(result: CreateOrderResult) {
  if (result.status !== "created" && result.status !== "replayed") {
    throw new Error(`expected an order, got ${result.status}`);
  }
  return result.order;
}

function count(db: DatabaseSync, table: "orders" | "order_items"): number {
  return (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
}

function storedItems(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT product_id, product_name_snapshot, unit_price_kurus_snapshot, quantity, line_total_kurus FROM order_items ORDER BY product_id",
    )
    .all();
}

// Wraps a connection so the first idempotency-key lookup misses, as if another
// writer committed the same key after it was read.
function withStaleFirstKeyLookup(db: DatabaseSync): DatabaseSync {
  let stale = true;
  const bind = (target: object, prop: string | symbol) => {
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== "prepare") {
        return bind(target, prop);
      }
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes("WHERE idempotency_key = ?")) {
          return statement;
        }
        return new Proxy(statement, {
          get(inner, innerProp) {
            if (innerProp === "get" && stale) {
              return () => {
                stale = false;
                return undefined;
              };
            }
            return bind(inner, innerProp);
          },
        });
      };
    },
  });
}

describe("createOrder", () => {
  let temp: TempDatabase;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempDatabase();
    db = openMigratedDatabase();
    seedCatalog(db);
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it("prices every line from products and stores name and price snapshots", () => {
    const result = createOrder(db, request());
    expect(result.status).toBe("created");
    const order = placed(result);
    expect(order.reference).toBe("C-1001");
    expect(order.totalKurus).toBe(2 * 9000 + 11000);
    expect(db.prepare("SELECT status, customer_name, note, total_kurus FROM orders").get()).toEqual({
      status: "new",
      customer_name: "Ayşe",
      note: "Az şekerli",
      total_kurus: 29000,
    });
    expect(storedItems(db)).toEqual([
      { product_id: "americano", product_name_snapshot: "Americano", unit_price_kurus_snapshot: 11000, quantity: 1, line_total_kurus: 11000 },
      { product_id: "espresso", product_name_snapshot: "Espresso", unit_price_kurus_snapshot: 9000, quantity: 2, line_total_kurus: 18000 },
    ]);
  });

  it("keeps the snapshots when the product is renamed, repriced or set unavailable later", () => {
    const order = placed(createOrder(db, request()));
    db.exec("UPDATE products SET name = 'Double Espresso', price_kurus = 99999, is_available = 0 WHERE id = 'espresso'");
    const details = findOrderByTrackingToken(db, order.trackingToken);
    expect(details?.totalKurus).toBe(29000);
    expect(details?.items.find((item) => item.productId === "espresso")).toEqual({
      productId: "espresso",
      name: "Espresso",
      unitPriceKurus: 9000,
      quantity: 2,
      lineTotalKurus: 18000,
    });
  });

  it("assigns sequential unique references and distinct 256-bit tracking tokens", () => {
    const tokens = new Set<string>();
    const references: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const order = placed(createOrder(db, request({ idempotencyKey: `order_key_${String(i).padStart(10, "0")}` })));
      references.push(order.reference);
      expect(order.trackingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(order.trackingToken, "base64url")).toHaveLength(32);
      tokens.add(order.trackingToken);
    }
    expect(references).toEqual(["C-1001", "C-1002", "C-1003", "C-1004", "C-1005"]);
    expect(tokens.size).toBe(5);
  });

  it("rejects an unknown product without writing a row", () => {
    expect(createOrder(db, request({ items: [{ productId: "espresso", quantity: 1 }, { productId: "missing", quantity: 1 }] }))).toEqual({
      status: "unknown_product",
      productId: "missing",
    });
    expect(count(db, "orders")).toBe(0);
    expect(count(db, "order_items")).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it("rejects an unavailable product without writing a row", () => {
    expect(createOrder(db, request({ items: [{ productId: "cold-brew", quantity: 1 }] }))).toEqual({
      status: "product_unavailable",
      productId: "cold-brew",
      productName: "Cold Brew",
    });
    expect(count(db, "orders")).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it("replays the stored order for the same key and payload", () => {
    const first = placed(createOrder(db, request()));
    const replay = createOrder(db, request({ customerName: "  Ayşe ", items: [{ productId: "americano", quantity: 1 }, { productId: "espresso", quantity: 1 }, { productId: "espresso", quantity: 1 }] }));
    expect(replay).toEqual({ status: "replayed", order: first });
    expect(count(db, "orders")).toBe(1);
    expect(count(db, "order_items")).toBe(2);
  });

  it("replays the original order after the product changed or went unavailable", () => {
    const first = placed(createOrder(db, request()));
    db.exec("UPDATE products SET price_kurus = 1, is_available = 0 WHERE id = 'espresso'");
    db.exec("DELETE FROM products WHERE id = 'americano'");
    expect(createOrder(db, request())).toEqual({ status: "replayed", order: first });
    expect(count(db, "orders")).toBe(1);
  });

  it("returns a conflict for the same key with a different normalized payload and writes nothing", () => {
    placed(createOrder(db, request()));
    for (const changed of [
      request({ customerName: "Mehmet" }),
      request({ note: null }),
      request({ items: [{ productId: "espresso", quantity: 3 }] }),
    ]) {
      expect(createOrder(db, changed)).toEqual({ status: "conflict" });
    }
    expect(count(db, "orders")).toBe(1);
    expect(count(db, "order_items")).toBe(2);
    expect(db.isTransaction).toBe(false);
  });

  it("answers from the committed row when the insert hits the idempotency key constraint", () => {
    const first = placed(createOrder(db, request()));
    expect(createOrder(withStaleFirstKeyLookup(db), request())).toEqual({ status: "replayed", order: first });
    expect(createOrder(withStaleFirstKeyLookup(db), request({ customerName: "Mehmet" }))).toEqual({ status: "conflict" });
    expect(count(db, "orders")).toBe(1);
    expect(db.isTransaction).toBe(false);
  });

  it("creates one order when two processes send the same key and payload at the same time", async () => {
    const env = { [DATABASE_PATH_ENV]: temp.path, NODE_ENV: "test", PATH: process.env.PATH } as const;
    const body = JSON.stringify(requestBody());
    // Hold the write lock until both workers are about to ask for it, so their
    // transactions really overlap instead of running one after the other.
    db.exec("BEGIN IMMEDIATE");
    const workers = [0, 1].map(() => {
      const child = spawn(process.execPath, [WORKER, body], { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let markReady: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        markReady = resolve;
      });
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.startsWith("ready\n")) {
          markReady();
        }
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
      });
      const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      });
      return { ready, done };
    });
    try {
      await Promise.all(workers.map((worker) => worker.ready));
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      db.exec("COMMIT");
    }
    const outputs = await Promise.all(workers.map((worker) => worker.done));
    for (const output of outputs) {
      expect(output).toMatchObject({ code: 0, stderr: "" });
    }
    const results = outputs.map((output) => JSON.parse(output.stdout.split("\n")[1]) as CreateOrderResult);
    expect(results.map((result) => result.status).sort()).toEqual(["created", "replayed"]);
    expect(placed(results[0])).toEqual(placed(results[1]));
    expect(count(db, "orders")).toBe(1);
    expect(count(db, "order_items")).toBe(2);
  });

  it("leaves products deletable and resetCatalog working once orders exist", () => {
    const order = placed(createOrder(db, request()));
    expect(() => resetCatalog(db, { NODE_ENV: "test" })).not.toThrow();
    db.exec("DELETE FROM products WHERE id = 'espresso'");
    expect(findOrderByTrackingToken(db, order.trackingToken)?.items.map((item) => item.name)).toEqual([
      "Americano",
      "Espresso",
    ]);
  });
});

describe("orders schema", () => {
  let temp: TempDatabase;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempDatabase();
    db = openMigratedDatabase();
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it("references orders from order_items and never products", () => {
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    const keys = db.prepare("SELECT \"table\", \"from\", \"to\" FROM pragma_foreign_key_list('order_items')").all();
    expect(keys).toEqual([{ table: "orders", from: "order_id", to: "id" }]);
  });

  it("stores status codes only and defaults to new", () => {
    const insert = db.prepare(
      `INSERT INTO orders (reference, tracking_token, status, customer_name, total_kurus, idempotency_key, payload_fingerprint, created_at)
       VALUES (?, ?, ?, 'Ayşe', 100, ?, ?, '2026-10-15T00:00:00.000Z')`,
    );
    const token = (char: string) => char.repeat(43);
    const fingerprint = "f".repeat(64);
    for (const status of ["new", "preparing", "ready", "completed"]) {
      expect(() => insert.run(`R-${status}`, token(status[0]), status, `key_${status}_0123456789`, fingerprint)).not.toThrow();
    }
    expect(() => insert.run("R-yeni", token("y"), "Yeni", "key_yeni_0123456789", fingerprint)).toThrow();
    db.exec(
      `INSERT INTO orders (reference, tracking_token, customer_name, total_kurus, idempotency_key, payload_fingerprint, created_at)
       VALUES ('R-default', '${token("d")}', 'Ayşe', 100, 'key_default_0123456', '${fingerprint}', '2026-10-15T00:00:00.000Z')`,
    );
    expect(db.prepare("SELECT status FROM orders WHERE reference = 'R-default'").get()).toEqual({ status: "new" });
  });
});

describe("findOrderByTrackingToken", () => {
  let temp: TempDatabase;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempDatabase();
    db = openMigratedDatabase();
    seedCatalog(db);
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it("returns the order with its status, snapshots and total", () => {
    const order = placed(createOrder(db, request()));
    expect(findOrderByTrackingToken(db, order.trackingToken)).toEqual({
      reference: "C-1001",
      status: "new",
      customerName: "Ayşe",
      note: "Az şekerli",
      totalKurus: 29000,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      items: [
        { productId: "americano", name: "Americano", unitPriceKurus: 11000, quantity: 1, lineTotalKurus: 11000 },
        { productId: "espresso", name: "Espresso", unitPriceKurus: 9000, quantity: 2, lineTotalKurus: 18000 },
      ],
    });
  });

  it("reflects a status change", () => {
    const order = placed(createOrder(db, request()));
    db.exec("UPDATE orders SET status = 'ready'");
    expect(findOrderByTrackingToken(db, order.trackingToken)?.status).toBe("ready");
  });

  it("returns null for an unknown well-formed token", () => {
    placed(createOrder(db, request()));
    expect(findOrderByTrackingToken(db, "A".repeat(43))).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an empty string", ""],
    ["a reference", "C-1001"],
    ["a 42-character token", "A".repeat(42)],
    ["a 44-character token", "A".repeat(44)],
    ["padded base64", `${"A".repeat(42)}=`],
    ["a token with a dot", `${"A".repeat(42)}.`],
    ["SQL text", `' OR 1=1 --${" ".repeat(32)}`],
  ])("returns null for %s", (_label, token) => {
    placed(createOrder(db, request()));
    expect(findOrderByTrackingToken(db, token)).toBeNull();
  });

  it("returns null for a real token with surrounding whitespace", () => {
    const order = placed(createOrder(db, request()));
    expect(findOrderByTrackingToken(db, `${order.trackingToken} `)).toBeNull();
    expect(findOrderByTrackingToken(db, ` ${order.trackingToken}`)).toBeNull();
  });
});

describe("placeOrder and readOrderByTrackingToken", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("open the database from the environment, place and read an order", () => {
    const db = openMigratedDatabase();
    seedCatalog(db);
    db.close();
    const order = placed(placeOrder(request()));
    expect(readOrderByTrackingToken(order.trackingToken)?.reference).toBe(order.reference);
    expect(readOrderByTrackingToken("A".repeat(43))).toBeNull();
  });

  it("return null for a malformed token without opening the database", () => {
    delete process.env[DATABASE_PATH_ENV];
    expect(readOrderByTrackingToken("not-a-token")).toBeNull();
  });

  it("fail without creating the database when the file is missing", () => {
    expect(() => placeOrder(request())).toThrow();
    expect(() => readOrderByTrackingToken("A".repeat(43))).toThrow();
    expect(existsSync(temp.path)).toBe(false);
  });
});

describe("orders module surface", () => {
  it("offers no listing and no lookup by reference", () => {
    expect(Object.keys(orders).sort()).toEqual([
      "ORDER_STATUSES",
      "createOrder",
      "findOrderByTrackingToken",
      "isTrackingToken",
      "placeOrder",
      "readOrderByTrackingToken",
    ]);
  });
});
