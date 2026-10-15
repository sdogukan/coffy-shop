import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AdvanceOrderStatusResult,
  advanceOrderStatus,
  changeOrderStatus,
  findOrderById,
  listOrders,
  parseOrderId,
  readOrderById,
  readOrders,
} from "../../src/db/admin-orders.ts";
import { seedCatalog } from "../../src/db/catalog.ts";
import { DATABASE_PATH_ENV, openDatabase } from "../../src/db/connection.ts";
import { MIGRATIONS_DIR, listMigrations, runMigrations } from "../../src/db/migrate.ts";
import { createOrder, findOrderByTrackingToken, type OrderStatus } from "../../src/db/orders.ts";
import { parseOrderRequest } from "../../src/orders/order-request.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const WORKER = fileURLToPath(new URL("../helpers/advance-order-status-worker.ts", import.meta.url));
const SECRET_COLUMNS = ["tracking_token", "trackingToken", "idempotency_key", "idempotencyKey", "payload_fingerprint", "payloadFingerprint"];

function place(db: DatabaseSync, customerName: string, idempotencyKey: string, note: string | null = null) {
  const parsed = parseOrderRequest({
    customerName,
    note,
    items: [
      { productId: "espresso", quantity: 2 },
      { productId: "americano", quantity: 1 },
    ],
    idempotencyKey,
  });
  if (!parsed.ok) {
    throw new Error(parsed.code);
  }
  const result = createOrder(db, parsed.request);
  if (result.status !== "created") {
    throw new Error(result.status);
  }
  return result.order;
}

function storedRow(db: DatabaseSync, id: number) {
  return db.prepare("SELECT status, updated_at FROM orders WHERE id = ?").get(id) as {
    status: OrderStatus;
    updated_at: string | null;
  };
}

function setStatus(db: DatabaseSync, id: number, status: OrderStatus) {
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
}

describe("staff order reads", () => {
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

  it("lists every order newest first with only the summary fields", () => {
    place(db, "Ayşe", "list_order_key_00001");
    place(db, "Mehmet", "list_order_key_00002");
    setStatus(db, 1, "ready");
    const orders = listOrders(db);
    expect(orders).toEqual([
      { id: 2, reference: "C-1002", customerName: "Mehmet", status: "new", totalKurus: 29000, createdAt: expect.any(String) },
      { id: 1, reference: "C-1001", customerName: "Ayşe", status: "ready", totalKurus: 29000, createdAt: expect.any(String) },
    ]);
    expect(readOrders()).toEqual(orders);
  });

  it("lists nothing when there are no orders", () => {
    expect(listOrders(db)).toEqual([]);
  });

  it("finds one order by id with item snapshots, note and a null updatedAt", () => {
    const placed = place(db, "Ayşe", "detail_order_key_0001", "Az şekerli");
    const order = findOrderById(db, 1);
    expect(order).toEqual({
      id: 1,
      reference: "C-1001",
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
    });
    // Same view of the order as the customer's tracking page, plus id and updatedAt.
    const { id: _id, updatedAt: _updatedAt, ...customerView } = order as NonNullable<typeof order>;
    expect(customerView).toEqual(findOrderByTrackingToken(db, placed.trackingToken));
    expect(readOrderById(1)).toEqual(order);
  });

  it("keeps the price snapshots after the product changes", () => {
    place(db, "Ayşe", "snapshot_order_key_01");
    db.exec("UPDATE products SET name = 'Doppio', price_kurus = 25000 WHERE id = 'espresso'");
    expect(findOrderById(db, 1)?.items[1]).toEqual({
      productId: "espresso",
      name: "Espresso",
      unitPriceKurus: 9000,
      quantity: 2,
      lineTotalKurus: 18000,
    });
  });

  it("never returns the tracking token, idempotency key or payload fingerprint", () => {
    place(db, "Ayşe", "secret_order_key_0001");
    advanceOrderStatus(db, 1, "preparing");
    const serialized = JSON.stringify([listOrders(db), findOrderById(db, 1), advanceOrderStatus(db, 1, "ready")]);
    const secrets = db.prepare("SELECT tracking_token, idempotency_key, payload_fingerprint FROM orders").get() as Record<string, string>;
    for (const value of Object.values(secrets)) {
      expect(serialized).not.toContain(value);
    }
    for (const name of SECRET_COLUMNS) {
      expect(serialized).not.toContain(name);
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "returns null for the id %s and for an unknown id",
    (id) => {
      place(db, "Ayşe", "bad_id_order_key_0001");
      expect(findOrderById(db, id)).toBeNull();
      expect(findOrderById(db, 99)).toBeNull();
    },
  );
});

describe("parseOrderId", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
  ])("accepts %s", (value, id) => {
    expect(parseOrderId(value)).toBe(id);
  });

  it.each([
    ["an empty string", ""],
    ["zero", "0"],
    ["a leading zero", "01"],
    ["a negative number", "-1"],
    ["a decimal", "1.0"],
    ["an exponent", "1e3"],
    ["a hex literal", "0x1"],
    ["whitespace", " 1"],
    ["a plus sign", "+1"],
    ["a value above the safe integer range", "9007199254740993"],
    ["a 17-digit number", "12345678901234567"],
    ["a reference", "C-1001"],
    ["a tracking token", "A".repeat(43)],
  ])("rejects %s", (_label, value) => {
    expect(parseOrderId(value)).toBeNull();
  });
});

describe("advanceOrderStatus", () => {
  let temp: TempDatabase;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempDatabase();
    db = openMigratedDatabase();
    seedCatalog(db);
    place(db, "Ayşe", "advance_order_key_001");
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it("moves an order through every step one at a time and stamps updated_at each time", () => {
    const times = ["2026-10-15T09:00:00.000Z", "2026-10-15T09:05:00.000Z", "2026-10-15T09:10:00.000Z"];
    const steps: OrderStatus[] = ["preparing", "ready", "completed"];
    steps.forEach((to, index) => {
      const result = advanceOrderStatus(db, 1, to, new Date(times[index] as string));
      expect(result).toMatchObject({ status: "updated", order: { id: 1, status: to, updatedAt: times[index] } });
      expect(storedRow(db, 1)).toEqual({ status: to, updated_at: times[index] });
    });
    expect(db.isTransaction).toBe(false);
  });

  it.each([
    ["skips a step", "new", "ready"],
    ["skips two steps", "new", "completed"],
    ["repeats the current status", "preparing", "preparing"],
    ["goes back", "ready", "preparing"],
    ["goes back to new", "preparing", "new"],
    ["moves new to new", "new", "new"],
    ["changes a completed order", "completed", "ready"],
    ["reopens a completed order as new", "completed", "new"],
  ] as const)("rejects a change that %s and leaves the row unchanged", (_label, from, to) => {
    setStatus(db, 1, from);
    expect(advanceOrderStatus(db, 1, to)).toEqual({ status: "invalid_transition" });
    expect(storedRow(db, 1)).toEqual({ status: from, updated_at: null });
    expect(db.isTransaction).toBe(false);
  });

  it("rejects the same step sent twice in a row: the second call loses", () => {
    expect(advanceOrderStatus(db, 1, "preparing").status).toBe("updated");
    const after = storedRow(db, 1);
    expect(advanceOrderStatus(db, 1, "preparing")).toEqual({ status: "invalid_transition" });
    expect(storedRow(db, 1)).toEqual(after);
  });

  it.each([
    ["an unknown id", 99, "preparing"],
    ["an unknown id moving to new", 99, "new"],
    ["a zero id", 0, "preparing"],
    ["a fractional id", 1.5, "preparing"],
  ] as const)("answers not_found for %s", (_label, id, to) => {
    expect(advanceOrderStatus(db, id, to)).toEqual({ status: "not_found" });
    expect(storedRow(db, 1)).toEqual({ status: "new", updated_at: null });
  });

  it("rejects a status outside the stored codes before it reaches the CHECK constraint", () => {
    expect(advanceOrderStatus(db, 1, "cancelled" as OrderStatus)).toEqual({ status: "invalid_transition" });
    expect(storedRow(db, 1)).toEqual({ status: "new", updated_at: null });
  });

  it("rolls back and rethrows when the write fails", () => {
    db.exec("CREATE TRIGGER fail_status BEFORE UPDATE ON orders BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    expect(() => advanceOrderStatus(db, 1, "preparing")).toThrow("disk full");
    expect(db.isTransaction).toBe(false);
    expect(storedRow(db, 1)).toEqual({ status: "new", updated_at: null });
  });

  it("changeOrderStatus opens the database, changes the status and closes it", () => {
    expect(changeOrderStatus(1, "preparing")).toMatchObject({ status: "updated", order: { status: "preparing" } });
    expect(changeOrderStatus(1, "completed")).toEqual({ status: "invalid_transition" });
    expect(storedRow(db, 1).status).toBe("preparing");
  });

  it("lets exactly one of two processes win the same step at the same time", async () => {
    const env = { [DATABASE_PATH_ENV]: temp.path, NODE_ENV: "test", PATH: process.env.PATH } as const;
    // Hold the write lock until both workers are about to ask for it, so their
    // UPDATEs really overlap instead of running one after the other.
    db.exec("BEGIN IMMEDIATE");
    const workers = [0, 1].map(() => {
      const child = spawn(process.execPath, [WORKER, "1", "preparing"], { env, stdio: ["ignore", "pipe", "pipe"] });
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
    const results = outputs.map((output) => JSON.parse(output.stdout.split("\n")[1] as string) as AdvanceOrderStatusResult);
    expect(results.map((result) => result.status).sort()).toEqual(["invalid_transition", "updated"]);
    const winner = results.find((result) => result.status === "updated");
    const stored = storedRow(db, 1);
    expect(stored.status).toBe("preparing");
    expect(winner).toMatchObject({ order: { status: "preparing", updatedAt: stored.updated_at } });
  });
});

describe("migration 0004_order_updated_at", () => {
  let temp: TempDatabase;
  let earlierMigrations: string;

  beforeEach(() => {
    temp = createTempDatabase();
    earlierMigrations = mkdtempSync(join(tmpdir(), "coffy-migrations-"));
    for (const name of listMigrations().filter((file) => file < "0004")) {
      copyFileSync(join(MIGRATIONS_DIR, name), join(earlierMigrations, name));
    }
  });

  afterEach(() => {
    rmSync(earlierMigrations, { recursive: true, force: true });
    temp.cleanup();
  });

  it("applies to a database that already holds orders and keeps the previous order insert working", () => {
    const db = openDatabase({ create: true });
    try {
      runMigrations(db, earlierMigrations);
      seedCatalog(db);
      const existing = place(db, "Ayşe", "pre_migration_key_001", "Az şekerli");
      const before = findOrderByTrackingToken(db, existing.trackingToken);

      expect(runMigrations(db)).toEqual(["0004_order_updated_at.sql"]);

      const column = (db.prepare("PRAGMA table_info(orders)").all() as { name: string; notnull: number; dflt_value: unknown }[]).find(
        (info) => info.name === "updated_at",
      );
      expect(column).toMatchObject({ notnull: 0, dflt_value: null });
      expect(findOrderByTrackingToken(db, existing.trackingToken)).toEqual(before);
      expect(findOrderById(db, 1)).toMatchObject({ reference: existing.reference, status: "new", updatedAt: null });
      // createOrder's explicit column list, as the previous release runs it.
      place(db, "Mehmet", "post_migration_key_01");
      expect(storedRow(db, 2)).toEqual({ status: "new", updated_at: null });
      expect(advanceOrderStatus(db, 1, "preparing").status).toBe("updated");
    } finally {
      db.close();
    }
  });
});
