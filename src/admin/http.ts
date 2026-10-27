import { NextResponse } from "next/server";

// Shared by the /api/admin route handlers: every response is no-store and
// every error body is {"error": "<Turkish message>", "code": "<snake_case>"},
// like POST /api/orders.

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export const ADMIN_ERRORS = {
  invalid_request: "İstek geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.",
  forbidden_origin: "İstek reddedildi. Lütfen sayfayı yenileyip tekrar deneyin.",
  unauthorized: "Oturumunuz yok veya süresi doldu. Lütfen tekrar giriş yapın.",
  invalid_credentials: "Kullanıcı adı veya şifre hatalı.",
  too_many_attempts: "Çok fazla başarısız giriş denemesi yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.",
  admin_disabled: "Yönetici girişi şu anda kapalı.",
  not_found: "Ürün bulunamadı.",
  // Sent with code not_found by the order endpoints, so an order 404 does not
  // read as a missing product.
  order_not_found: "Sipariş bulunamadı.",
  // Sent with code not_found by the milk option endpoints.
  milk_option_not_found: "Süt seçeneği bulunamadı.",
  default_milk_option: "Normal süt değiştirilemez ve kaldırılamaz.",
  invalid_status: "Sipariş durumu geçersiz.",
  invalid_transition:
    "Sipariş bu duruma geçirilemedi; durumu değişmiş olabilir. Lütfen sayfayı yenileyip güncel durumu kontrol edin.",
  server_error: "İşlem şu anda yapılamadı. Lütfen tekrar deneyin.",
} as const;

export type AdminErrorCode = keyof typeof ADMIN_ERRORS;

export function json(body: unknown, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function errorResponse(code: string, error: string, status: number, headers: Record<string, string> = {}): NextResponse {
  return json({ error, code }, status, headers);
}

export function adminError(code: AdminErrorCode, status: number, headers: Record<string, string> = {}): NextResponse {
  return errorResponse(code, ADMIN_ERRORS[code], status, headers);
}

function isJsonContentType(value: string | null): boolean {
  return value !== null && value.split(";")[0]?.trim().toLowerCase() === "application/json";
}

// Mutating admin requests carry a JSON body with Content-Type
// application/json. Anything else, an oversized body or invalid JSON is
// reported as not ok without saying why.
export async function readJsonBody(request: Request, maxLength: number): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { ok: false };
  }
  try {
    const text = await request.text();
    if (text.length > maxLength) {
      return { ok: false };
    }
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
