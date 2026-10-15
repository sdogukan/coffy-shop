import { writeSync } from "node:fs";
import { openDatabase } from "../../src/db/connection.ts";
import { createOrder } from "../../src/db/orders.ts";
import { parseOrderRequest } from "../../src/orders/order-request.ts";

// Runs createOrder in its own process and connection against
// COFFY_DATABASE_PATH, so tests can overlap two real write transactions.
// Prints "ready" before it asks for the write lock, then the result as JSON.
// writeSync, because createOrder blocks the event loop while it waits.
const parsed = parseOrderRequest(JSON.parse(process.argv[2] ?? "null"));
if (!parsed.ok) {
  throw new Error(`invalid request: ${parsed.code}`);
}
const db = openDatabase();
try {
  writeSync(1, "ready\n");
  writeSync(1, `${JSON.stringify(createOrder(db, parsed.request))}\n`);
} finally {
  db.close();
}
