import { NextResponse } from "next/server";
import { placeOrder } from "../../../src/db/orders.ts";
import { ORDER_REQUEST_ERRORS, parseOrderRequest } from "../../../src/orders/order-request.ts";

export const dynamic = "force-dynamic";

// Far above any valid order (50 lines, a 60-character name, a 200-character
// note), so it only stops oversized bodies before JSON.parse.
const MAX_BODY_LENGTH = 65_536;

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function invalidRequest() {
  return json({ error: ORDER_REQUEST_ERRORS.invalid_request, code: "invalid_request" }, 400);
}

// Only POST: an order is read back solely through its tracking token, never
// listed and never looked up by reference.
export async function POST(request: Request) {
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_LENGTH) {
      return invalidRequest();
    }
    body = JSON.parse(text);
  } catch {
    return invalidRequest();
  }

  const parsed = parseOrderRequest(body);
  if (!parsed.ok) {
    return json({ error: parsed.error, code: parsed.code }, 400);
  }

  let result: ReturnType<typeof placeOrder>;
  try {
    result = placeOrder(parsed.request);
  } catch (error) {
    console.error(`Order creation failed: ${error instanceof Error ? error.message : String(error)}`);
    return json({ error: "Siparişiniz şu anda alınamadı. Lütfen tekrar deneyin." }, 500);
  }

  switch (result.status) {
    case "created":
    case "replayed":
      return json(
        {
          reference: result.order.reference,
          trackingPath: `/siparis/${result.order.trackingToken}`,
          totalKurus: result.order.totalKurus,
        },
        201,
      );
    case "conflict":
      return json(
        {
          error: "Bu sipariş isteği daha önce farklı bir içerikle gönderildi. Lütfen sayfayı yenileyip tekrar deneyin.",
          code: "idempotency_conflict",
        },
        409,
      );
    case "unknown_product":
      return json(
        { error: "Sepetinizdeki bir ürün artık menüde yok. Lütfen sepetinizi güncelleyin.", code: "unknown_product" },
        400,
      );
    case "product_unavailable":
      return json(
        {
          error: `${result.productName} şu anda satışta değil. Lütfen sepetinizden çıkarın.`,
          code: "product_unavailable",
        },
        400,
      );
  }
}
