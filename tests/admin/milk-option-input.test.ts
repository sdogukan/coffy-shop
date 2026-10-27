import { describe, expect, it } from "vitest";
import { MILK_OPTION_INPUT_ERRORS, parseMilkOptionCreate, parseMilkOptionPatch } from "../../src/admin/milk-option-input.ts";

const VALID = { name: "  Yulaf sütü  ", surchargeKurus: 1500 };

describe("parseMilkOptionCreate", () => {
  it("trims the name and keeps the surcharge", () => {
    expect(parseMilkOptionCreate(VALID)).toEqual({ ok: true, value: { name: "Yulaf sütü", surchargeKurus: 1500 } });
  });

  it("accepts the bounds: 60-character name, 1 and 1,000,000 kuruş", () => {
    expect(parseMilkOptionCreate({ name: "ş".repeat(60), surchargeKurus: 1 }).ok).toBe(true);
    expect(parseMilkOptionCreate({ name: "a", surchargeKurus: 1_000_000 }).ok).toBe(true);
  });

  it.each([
    ["an empty name", { name: "" }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_name],
    ["a blank name", { name: "   " }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_name],
    ["a 61-character name", { name: "ş".repeat(61) }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_name],
    ["a zero surcharge", { surchargeKurus: 0 }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_surcharge],
    ["a negative surcharge", { surchargeKurus: -1 }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_surcharge],
    ["a fractional surcharge", { surchargeKurus: 150.5 }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_surcharge],
    ["an oversized surcharge", { surchargeKurus: 1_000_001 }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_surcharge],
    ["an unsafe integer surcharge", { surchargeKurus: 2 ** 53 }, "invalid_milk_option", MILK_OPTION_INPUT_ERRORS.invalid_surcharge],
    ["a string surcharge", { surchargeKurus: "1500" }, "invalid_request", MILK_OPTION_INPUT_ERRORS.invalid_request],
    ["a numeric name", { name: 7 }, "invalid_request", MILK_OPTION_INPUT_ERRORS.invalid_request],
    ["a null name", { name: null }, "invalid_request", MILK_OPTION_INPUT_ERRORS.invalid_request],
    ["an unknown field", { isDefault: true }, "invalid_request", MILK_OPTION_INPUT_ERRORS.invalid_request],
    ["an isAvailable field", { isAvailable: true }, "invalid_request", MILK_OPTION_INPUT_ERRORS.invalid_request],
    ["a missing name", { name: undefined }, "invalid_request", MILK_OPTION_INPUT_ERRORS.invalid_request],
    ["a missing surcharge", { surchargeKurus: undefined }, "invalid_request", MILK_OPTION_INPUT_ERRORS.invalid_request],
  ])("rejects %s with %s", (_label, override, code, error) => {
    const body = JSON.parse(JSON.stringify({ ...VALID, ...override }));
    expect(parseMilkOptionCreate(body)).toEqual({ ok: false, code, error });
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY]])("rejects the surcharge %s", (surchargeKurus) => {
    expect(parseMilkOptionCreate({ ...VALID, surchargeKurus })).toMatchObject({ ok: false, code: "invalid_milk_option" });
  });

  it.each([[null], [[]], ["text"], [42]])("rejects a non-object body %j", (body) => {
    expect(parseMilkOptionCreate(body)).toMatchObject({ ok: false, code: "invalid_request" });
  });

  it("writes Turkish messages that name the field and the TRY bounds", () => {
    expect(MILK_OPTION_INPUT_ERRORS.invalid_surcharge).toBe("Ek ücret 0,01 TL ile 10.000,00 TL arasında olmalıdır.");
    expect(MILK_OPTION_INPUT_ERRORS.invalid_name).toBe("Süt seçeneği adı 1 ile 60 karakter arasında olmalıdır.");
  });
});

describe("parseMilkOptionPatch", () => {
  it("returns only the fields present", () => {
    expect(parseMilkOptionPatch({ surchargeKurus: 2000 })).toEqual({ ok: true, value: { surchargeKurus: 2000 } });
    expect(parseMilkOptionPatch({ isAvailable: false })).toEqual({ ok: true, value: { isAvailable: false } });
    expect(parseMilkOptionPatch({ surchargeKurus: 1, isAvailable: true })).toEqual({
      ok: true,
      value: { surchargeKurus: 1, isAvailable: true },
    });
  });

  it.each([
    ["an empty body", {}, "invalid_request"],
    ["a name", { name: "Yulaf" }, "invalid_request"],
    ["an unknown field", { isDefault: false }, "invalid_request"],
    ["a non-boolean availability", { isAvailable: "false" }, "invalid_request"],
    ["a numeric availability", { isAvailable: 0 }, "invalid_request"],
    ["a string surcharge", { surchargeKurus: "100" }, "invalid_request"],
    ["a zero surcharge", { surchargeKurus: 0 }, "invalid_milk_option"],
    ["an oversized surcharge", { surchargeKurus: 1_000_001 }, "invalid_milk_option"],
    ["a non-object body", [], "invalid_request"],
  ])("rejects %s", (_label, body, code) => {
    expect(parseMilkOptionPatch(body)).toMatchObject({ ok: false, code });
  });
});
