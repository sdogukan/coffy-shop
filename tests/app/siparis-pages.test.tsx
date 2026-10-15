import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CheckoutPage, { dynamic as checkoutDynamic } from "../../app/siparis-ver/page.tsx";
import OrderNotFound from "../../app/siparis/[token]/not-found.tsx";
import OrderTrackingPage, { dynamic as trackingDynamic, metadata } from "../../app/siparis/[token]/page.tsx";
import { seedCatalog } from "../../src/db/catalog.ts";
import { openDatabase } from "../../src/db/connection.ts";
import { createOrder, type OrderStatus } from "../../src/db/orders.ts";
import { parseOrderRequest } from "../../src/orders/order-request.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

function placeTestOrder(): { reference: string; token: string } {
  const parsed = parseOrderRequest({
    customerName: "Ayşe <b>",
    note: "Az şekerli",
    items: [
      { productId: "espresso", quantity: 2 },
      { productId: "americano", quantity: 1 },
    ],
    idempotencyKey: "0b7f0e7a-3c1d-4f7e-9a51-2a4c1b2f3e4d",
  });
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const db = openDatabase();
  try {
    const result = createOrder(db, parsed.request);
    if (result.status !== "created") {
      throw new Error(result.status);
    }
    return { reference: result.order.reference, token: result.order.trackingToken };
  } finally {
    db.close();
  }
}

function setStatus(token: string, status: OrderStatus): void {
  const db = openDatabase();
  try {
    db.prepare("UPDATE orders SET status = ? WHERE tracking_token = ?").run(status, token);
  } finally {
    db.close();
  }
}

async function renderTracking(token: string): Promise<string> {
  const element = await OrderTrackingPage({ params: Promise.resolve({ token }) });
  return renderToStaticMarkup(element as ReactElement);
}

function productPrice(id: string): number {
  const db = openDatabase();
  try {
    return (db.prepare("SELECT price_kurus FROM products WHERE id = ?").get(id) as { price_kurus: number }).price_kurus;
  } finally {
    db.close();
  }
}

describe("checkout page", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
    const db = openMigratedDatabase();
    seedCatalog(db);
    db.close();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("is rendered per request, never prerendered at build time", () => {
    expect(checkoutDynamic).toBe("force-dynamic");
  });

  it("reads the menu and renders the heading with a loading state until the browser cart is read", () => {
    const html = renderToStaticMarkup(<CheckoutPage />);
    expect(html).toContain("<h1>Sipariş ver</h1>");
    expect(html).toContain("Sepet yükleniyor…");
    expect(html).not.toContain("Sepetiniz boş");
  });
});

describe("order tracking page", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
    const db = openMigratedDatabase();
    seedCatalog(db);
    db.close();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("is rendered per request and kept out of search engines and Referer headers", () => {
    expect(trackingDynamic).toBe("force-dynamic");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("shows the reference, the status in the four-step indicator, the item snapshots, the total and a full-reload refresh link", async () => {
    const { reference, token } = placeTestOrder();
    const espresso = productPrice("espresso");
    const americano = productPrice("americano");
    const html = await renderTracking(token);

    expect(html).toContain("<h1>Sipariş takibi</h1>");
    expect(html).toContain(`Sipariş numarası: <strong>${reference}</strong>`);
    expect(html).toContain("Teslim alacak: Ayşe &lt;b&gt;");
    expect(html).toContain("Durum: Yeni");
    const steps = html.slice(html.indexOf('<ol class="order-steps"'), html.indexOf("</ol>"));
    expect(steps.match(/<li /g)).toHaveLength(4);
    expect(steps).toContain('<li class="order-step order-step-current" aria-current="step">Yeni</li>');
    expect(steps).toContain('<li class="order-step">Hazırlanıyor</li>');
    expect(steps).toContain('<li class="order-step">Hazır</li>');
    expect(steps).toContain('<li class="order-step">Tamamlandı</li>');
    expect(html).toContain(`<a href="/siparis/${token}" class="button">Durumu yenile</a>`);
    expect(html).toContain("<h2>Espresso</h2>");
    expect(html).toContain("<h2>Americano</h2>");
    expect(html).toContain("Sipariş notu: Az şekerli");
    expect(html).toContain("Mağazadan teslim alınacaktır.");
    const total = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(
      (espresso * 2 + americano) / 100,
    );
    expect(html).toContain(`Toplam: ${total}`);
    expect(html).not.toMatch(/websocket|EventSource|<script/i);
  });

  it("marks the earlier steps done and the stored status current", async () => {
    const { token } = placeTestOrder();
    setStatus(token, "ready");
    const html = await renderTracking(token);
    expect(html).toContain("Durum: Hazır");
    expect(html).toContain('<li class="order-step order-step-done">Yeni</li>');
    expect(html).toContain('<li class="order-step order-step-done">Hazırlanıyor</li>');
    expect(html).toContain('<li class="order-step order-step-current" aria-current="step">Hazır</li>');
    expect(html).toContain('<li class="order-step">Tamamlandı</li>');
  });

  it("keeps the item snapshots after the product is renamed and repriced", async () => {
    const { token } = placeTestOrder();
    const db = openDatabase();
    db.prepare("UPDATE products SET name = 'Yeni Espresso', price_kurus = 99999 WHERE id = 'espresso'").run();
    db.close();
    const html = await renderTracking(token);
    expect(html).toContain("<h2>Espresso</h2>");
    expect(html).not.toContain("Yeni Espresso");
  });

  it.each([
    ["a malformed token", "not-a-token"],
    ["a token with a path character", `${"a".repeat(42)}/`],
    ["an unknown well-formed token", "b".repeat(43)],
  ])("renders the not-found page for %s", async (_name, token) => {
    placeTestOrder();
    await expect(OrderTrackingPage({ params: Promise.resolve({ token }) })).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("order not-found page", () => {
  it("says the order was not found or the link is invalid and links to the menu", () => {
    const html = renderToStaticMarkup(<OrderNotFound />);
    expect(html).toContain("<h1>Sipariş bulunamadı veya bağlantı geçersiz</h1>");
    expect(html).toContain('<a href="/">Menüye dön</a>');
  });
});
