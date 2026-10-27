import type { MilkOptionFields, MilkOptionPatch } from "../db/milk-options.ts";
import { characterCount, MAX_PRICE_KURUS, MIN_PRICE_KURUS } from "./product-input.ts";

// Server-side validation of the admin milk option bodies. A field of the
// wrong type, an unknown field or a non-object body is invalid_request; a
// value of the right type outside its bounds is invalid_milk_option with a
// message naming the field. The surcharge bounds are the product price bounds.

export const MAX_MILK_OPTION_NAME_LENGTH = 60;

export const MILK_OPTION_INPUT_ERRORS = {
  invalid_request: "Süt seçeneği isteği geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.",
  invalid_name: "Süt seçeneği adı 1 ile 60 karakter arasında olmalıdır.",
  invalid_surcharge: "Ek ücret 0,01 TL ile 10.000,00 TL arasında olmalıdır.",
} as const;

export type MilkOptionInputResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "invalid_request" | "invalid_milk_option"; error: string };

const CREATE_FIELDS = ["name", "surchargeKurus"] as const;
const PATCH_FIELDS = ["surchargeKurus", "isAvailable"] as const;

type Field = (typeof CREATE_FIELDS)[number] | (typeof PATCH_FIELDS)[number];
type FieldValues = { name: string; surchargeKurus: number; isAvailable: boolean };

function invalidRequest<T>(): MilkOptionInputResult<T> {
  return { ok: false, code: "invalid_request", error: MILK_OPTION_INPUT_ERRORS.invalid_request };
}

function invalidMilkOption<T>(message: "invalid_name" | "invalid_surcharge"): MilkOptionInputResult<T> {
  return { ok: false, code: "invalid_milk_option", error: MILK_OPTION_INPUT_ERRORS[message] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseField(field: Field, value: unknown): MilkOptionInputResult<FieldValues[Field]> {
  switch (field) {
    case "name": {
      if (typeof value !== "string") {
        return invalidRequest();
      }
      const name = value.trim();
      const length = characterCount(name, MAX_MILK_OPTION_NAME_LENGTH);
      return length >= 1 && length <= MAX_MILK_OPTION_NAME_LENGTH ? { ok: true, value: name } : invalidMilkOption("invalid_name");
    }
    case "surchargeKurus":
      if (typeof value !== "number") {
        return invalidRequest();
      }
      return Number.isSafeInteger(value) && value >= MIN_PRICE_KURUS && value <= MAX_PRICE_KURUS
        ? { ok: true, value }
        : invalidMilkOption("invalid_surcharge");
    case "isAvailable":
      return typeof value === "boolean" ? { ok: true, value } : invalidRequest();
  }
}

// Validates every key of the body against the allowed fields; unknown keys
// are rejected so a misspelt field is never silently ignored.
function parseFields(body: unknown, allowed: readonly Field[]): MilkOptionInputResult<Partial<FieldValues>> {
  if (!isPlainObject(body)) {
    return invalidRequest();
  }
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const field = allowed.find((name) => name === key);
    if (field === undefined) {
      return invalidRequest();
    }
    const parsed = parseField(field, value);
    if (!parsed.ok) {
      return parsed;
    }
    fields[field] = parsed.value;
  }
  return { ok: true, value: fields as Partial<FieldValues> };
}

// POST body: exactly name and surchargeKurus, both required.
export function parseMilkOptionCreate(body: unknown): MilkOptionInputResult<MilkOptionFields> {
  const parsed = parseFields(body, CREATE_FIELDS);
  if (!parsed.ok) {
    return parsed;
  }
  const { name, surchargeKurus } = parsed.value;
  if (name === undefined || surchargeKurus === undefined) {
    return invalidRequest();
  }
  return { ok: true, value: { name, surchargeKurus } };
}

// PATCH body: a non-empty subset of surchargeKurus and isAvailable. The name
// is not editable.
export function parseMilkOptionPatch(body: unknown): MilkOptionInputResult<MilkOptionPatch> {
  const parsed = parseFields(body, PATCH_FIELDS);
  if (!parsed.ok) {
    return parsed;
  }
  const { surchargeKurus, isAvailable } = parsed.value;
  if (surchargeKurus === undefined && isAvailable === undefined) {
    return invalidRequest();
  }
  return {
    ok: true,
    value: {
      ...(surchargeKurus === undefined ? {} : { surchargeKurus }),
      ...(isAvailable === undefined ? {} : { isAvailable }),
    },
  };
}
