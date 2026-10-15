import type { ProductFields, ProductPatch } from "../db/admin-products.ts";

// Server-side validation of the admin product bodies. A field of the wrong
// type, an unknown field or a non-object body is invalid_request; a value of
// the right type outside its bounds is invalid_product with a message naming
// the field. Whether categoryId exists is checked by the database layer.

export const MAX_PRODUCT_NAME_LENGTH = 60;
export const MAX_PRODUCT_DESCRIPTION_LENGTH = 200;
export const MIN_PRICE_KURUS = 1;
export const MAX_PRICE_KURUS = 1_000_000;
// Same bound as the categories.id column.
const MAX_CATEGORY_ID_LENGTH = 64;

export const PRODUCT_INPUT_ERRORS = {
  invalid_request: "Ürün isteği geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.",
  invalid_name: "Ürün adı 1 ile 60 karakter arasında olmalıdır.",
  invalid_description: "Ürün açıklaması en fazla 200 karakter olabilir.",
  invalid_price: "Fiyat 0,01 TL ile 10.000,00 TL arasında olmalıdır.",
  unknown_category: "Seçilen kategori bulunamadı.",
} as const;

export type ProductInputResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "invalid_request" | "invalid_product"; error: string };

type FieldResult<T> = { ok: true; value: T } | { ok: false; code: "invalid_request" | "invalid_product"; error: string };

const FIELDS = ["categoryId", "name", "description", "priceKurus", "isAvailable"] as const;

function invalidRequest<T>(): FieldResult<T> {
  return { ok: false, code: "invalid_request", error: PRODUCT_INPUT_ERRORS.invalid_request };
}

function invalidProduct<T>(message: keyof typeof PRODUCT_INPUT_ERRORS): FieldResult<T> {
  return { ok: false, code: "invalid_product", error: PRODUCT_INPUT_ERRORS[message] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Counts characters the way SQLite's length() does (code points). A string
// longer than twice the limit in UTF-16 units is over it in code points too,
// which skips the spread for oversized input.
function characterCount(value: string, max: number): number {
  return value.length > max * 2 ? value.length : [...value].length;
}

function parseField(field: (typeof FIELDS)[number], value: unknown): FieldResult<ProductFields[typeof field]> {
  switch (field) {
    case "categoryId":
      return typeof value === "string" && value.length >= 1 && value.length <= MAX_CATEGORY_ID_LENGTH
        ? { ok: true, value }
        : typeof value === "string"
          ? invalidProduct("unknown_category")
          : invalidRequest();
    case "name": {
      if (typeof value !== "string") {
        return invalidRequest();
      }
      const name = value.trim();
      const length = characterCount(name, MAX_PRODUCT_NAME_LENGTH);
      return length >= 1 && length <= MAX_PRODUCT_NAME_LENGTH ? { ok: true, value: name } : invalidProduct("invalid_name");
    }
    case "description": {
      if (typeof value !== "string") {
        return invalidRequest();
      }
      const description = value.trim();
      return characterCount(description, MAX_PRODUCT_DESCRIPTION_LENGTH) <= MAX_PRODUCT_DESCRIPTION_LENGTH
        ? { ok: true, value: description }
        : invalidProduct("invalid_description");
    }
    case "priceKurus":
      if (typeof value !== "number") {
        return invalidRequest();
      }
      return Number.isSafeInteger(value) && value >= MIN_PRICE_KURUS && value <= MAX_PRICE_KURUS
        ? { ok: true, value }
        : invalidProduct("invalid_price");
    case "isAvailable":
      return typeof value === "boolean" ? { ok: true, value } : invalidRequest();
  }
}

// Validates every key of the body; unknown keys are rejected so a misspelt
// field is never silently ignored.
function parseFields(body: unknown): FieldResult<ProductPatch> {
  if (!isPlainObject(body)) {
    return invalidRequest();
  }
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const field = FIELDS.find((name) => name === key);
    if (field === undefined) {
      return invalidRequest();
    }
    const parsed = parseField(field, value);
    if (!parsed.ok) {
      return parsed;
    }
    patch[field] = parsed.value;
  }
  return { ok: true, value: patch as ProductPatch };
}

// POST body: categoryId, name, priceKurus and isAvailable are required;
// description is optional and defaults to "".
export function parseProductCreate(body: unknown): ProductInputResult<ProductFields> {
  const parsed = parseFields(body);
  if (!parsed.ok) {
    return parsed;
  }
  const { categoryId, name, description = "", priceKurus, isAvailable } = parsed.value;
  if (categoryId === undefined || name === undefined || priceKurus === undefined || isAvailable === undefined) {
    return invalidRequest();
  }
  return { ok: true, value: { categoryId, name, description, priceKurus, isAvailable } };
}

// PATCH body: any non-empty subset of the fields; only those are updated.
export function parseProductPatch(body: unknown): ProductInputResult<ProductPatch> {
  const parsed = parseFields(body);
  if (!parsed.ok) {
    return parsed;
  }
  return Object.keys(parsed.value).length === 0 ? invalidRequest() : parsed;
}
