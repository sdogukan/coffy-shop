import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { orderBody, smokeAdminCredentials } from "./support.ts";

const ORDERS_ENDPOINT = "/api/orders";
const JSON_HEADERS = { "Content-Type": "application/json" };

test.describe("order validation", () => {
  for (const quantity of [0, 21]) {
    test(`quantity ${quantity} is rejected with 400 invalid_quantity`, async ({ request }) => {
      const response = await request.post(ORDERS_ENDPOINT, { data: orderBody([{ productId: "espresso", quantity }]) });
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_quantity" });
    });
  }

  test("an empty cart is rejected with 400 empty_cart", async ({ request }) => {
    const response = await request.post(ORDERS_ENDPOINT, { data: orderBody([]) });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: "empty_cart" });
  });

  test("the unavailable cold-brew is rejected with 400 product_unavailable", async ({ request }) => {
    const response = await request.post(ORDERS_ENDPOINT, { data: orderBody([{ productId: "cold-brew", quantity: 1 }]) });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: "product_unavailable" });
  });
});

test.describe("admin API without a session", () => {
  test("GET /api/admin/orders answers 401 unauthorized", async ({ request }) => {
    const response = await request.get("/api/admin/orders");
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
  });

  // A same-origin PATCH passes the Origin check only when the proxy kept the
  // Host header, so the 401 also shows the request reached the session check.
  test("a same-origin status PATCH answers 401 unauthorized", async ({ request, baseURL }) => {
    const response = await request.patch("/api/admin/orders/1/status", {
      data: { to: "preparing" },
      headers: { Origin: new URL(baseURL ?? "").origin },
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
  });

  test("a status PATCH without Origin answers 403 forbidden_origin", async ({ request }) => {
    const response = await request.patch("/api/admin/orders/1/status", { data: { to: "preparing" } });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden_origin" });
  });
});

test("an invalid tracking link shows the not-found page", async ({ page }) => {
  const response = await page.goto("/siparis/gecersiz-baglanti");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Sipariş bulunamadı veya bağlantı geçersiz" })).toBeVisible();
});

test.describe("resending the same checkout", () => {
  test("the same key and payload twice answers the same 201 and stores one order", async ({ request, baseURL }) => {
    // Captured once and resent byte for byte, like the checkout form's retry.
    const body = JSON.stringify(orderBody([{ productId: "americano", quantity: 2 }]));
    const first = await request.post(ORDERS_ENDPOINT, { data: body, headers: JSON_HEADERS });
    const second = await request.post(ORDERS_ENDPOINT, { data: body, headers: JSON_HEADERS });
    expect(first.status()).toBe(201);
    expect(second.status()).toBe(201);
    const placed = (await first.json()) as { reference: string };
    expect(await second.json()).toEqual(placed);

    const { username, password } = smokeAdminCredentials();
    const login = await request.post("/api/admin/login", {
      data: { username, password },
      headers: { Origin: new URL(baseURL ?? "").origin },
    });
    expect(login.status()).toBe(200);
    const list = await request.get("/api/admin/orders");
    expect(list.status()).toBe(200);
    const { orders } = (await list.json()) as { orders: { reference: string }[] };
    expect(orders.filter((order) => order.reference === placed.reference)).toHaveLength(1);
  });

  test("the same key with a different payload answers 409 idempotency_conflict", async ({ request }) => {
    const key = randomUUID();
    const first = await request.post(ORDERS_ENDPOINT, { data: orderBody([{ productId: "limonata", quantity: 1 }], key) });
    expect(first.status()).toBe(201);
    const changed = await request.post(ORDERS_ENDPOINT, { data: orderBody([{ productId: "limonata", quantity: 2 }], key) });
    expect(changed.status()).toBe(409);
    expect(await changed.json()).toMatchObject({ code: "idempotency_conflict" });
  });
});
