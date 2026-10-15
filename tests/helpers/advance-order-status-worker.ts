import { writeSync } from "node:fs";
import { advanceOrderStatus } from "../../src/db/admin-orders.ts";
import { openDatabase } from "../../src/db/connection.ts";
import { isOrderStatus } from "../../src/orders/order-status.ts";

// Runs advanceOrderStatus in its own process and connection against
// COFFY_DATABASE_PATH, so tests can overlap two real status changes.
// Prints "ready" before it asks for the write lock, then the result as JSON.
// writeSync, because advanceOrderStatus blocks the event loop while it waits.
const id = Number(process.argv[2]);
const to = process.argv[3];
if (!isOrderStatus(to)) {
  throw new Error(`invalid status: ${to}`);
}
const db = openDatabase();
try {
  writeSync(1, "ready\n");
  writeSync(1, `${JSON.stringify(advanceOrderStatus(db, id, to))}\n`);
} finally {
  db.close();
}
