import { describe, expect, it } from "vitest";
import { ORDER_STATUSES as STORED_STATUSES } from "../../src/db/orders.ts";
import { isOrderStatus, nextOrderStatus, ORDER_STATUSES, previousOrderStatus } from "../../src/orders/order-status.ts";

describe("order status transitions", () => {
  it("are the stored status codes the orders module exposes", () => {
    expect(ORDER_STATUSES).toEqual(["new", "preparing", "ready", "completed"]);
    expect(STORED_STATUSES).toBe(ORDER_STATUSES);
  });

  it("move exactly one step forward and stop at completed", () => {
    expect(ORDER_STATUSES.map(nextOrderStatus)).toEqual(["preparing", "ready", "completed", null]);
  });

  it("allow nothing to move back to new", () => {
    expect(ORDER_STATUSES.map(previousOrderStatus)).toEqual([null, "new", "preparing", "ready"]);
  });

  it("are inverse of each other", () => {
    for (const status of ORDER_STATUSES) {
      const next = nextOrderStatus(status);
      if (next !== null) {
        expect(previousOrderStatus(next)).toBe(status);
      }
    }
  });

  it.each([["new"], ["preparing"], ["ready"], ["completed"]])("accept the stored code %s", (value) => {
    expect(isOrderStatus(value)).toBe(true);
  });

  it.each([
    ["cancelled", "cancelled"],
    ["a Turkish label", "Hazır"],
    ["an upper-case code", "READY"],
    ["a padded code", " ready"],
    ["an empty string", ""],
    ["an inherited property name", "toString"],
    ["a number", 1],
    ["null", null],
    ["an array", ["ready"]],
  ])("reject %s", (_label, value) => {
    expect(isOrderStatus(value)).toBe(false);
  });
});
