import { describe, expect, it } from "vitest";
import { parseProductCreate, parseProductPatch } from "../../src/admin/product-input.ts";

const VALID = {
  categoryId: "sicak-kahveler",
  name: "  Flat White  ",
  description: "  Çift shot.  ",
  priceKurus: 14000,
  isAvailable: true,
};

describe("parseProductCreate", () => {
  it("trims the name and description and keeps the other fields", () => {
    expect(parseProductCreate(VALID)).toEqual({
      ok: true,
      value: { categoryId: "sicak-kahveler", name: "Flat White", description: "Çift shot.", priceKurus: 14000, isAvailable: true },
    });
  });

  it("defaults a missing description to an empty string", () => {
    const { description: _omitted, ...rest } = VALID;
    expect(parseProductCreate(rest)).toMatchObject({ ok: true, value: { description: "" } });
  });

  it("accepts the bounds: 60-character name, 200-character description, 1 and 1,000,000 kuruş", () => {
    expect(parseProductCreate({ ...VALID, name: "ş".repeat(60), description: "ğ".repeat(200), priceKurus: 1 }).ok).toBe(true);
    expect(parseProductCreate({ ...VALID, priceKurus: 1_000_000, isAvailable: false }).ok).toBe(true);
  });

  it.each([
    ["an empty name", { name: "" }, "invalid_product"],
    ["a blank name", { name: "   " }, "invalid_product"],
    ["a 61-character name", { name: "a".repeat(61) }, "invalid_product"],
    ["a 201-character description", { description: "a".repeat(201) }, "invalid_product"],
    ["a zero price", { priceKurus: 0 }, "invalid_product"],
    ["a negative price", { priceKurus: -100 }, "invalid_product"],
    ["a fractional price", { priceKurus: 135.5 }, "invalid_product"],
    ["an oversized price", { priceKurus: 1_000_001 }, "invalid_product"],
    ["an unsafe integer price", { priceKurus: 2 ** 53 }, "invalid_product"],
    ["an empty category id", { categoryId: "" }, "invalid_product"],
    ["a 65-character category id", { categoryId: "a".repeat(65) }, "invalid_product"],
    ["a string price", { priceKurus: "14000" }, "invalid_request"],
    ["a string availability", { isAvailable: "true" }, "invalid_request"],
    ["a numeric availability", { isAvailable: 1 }, "invalid_request"],
    ["a null name", { name: null }, "invalid_request"],
    ["a numeric description", { description: 5 }, "invalid_request"],
    ["a numeric category id", { categoryId: 1 }, "invalid_request"],
    ["an unknown field", { id: "espresso" }, "invalid_request"],
    ["a missing price", { priceKurus: undefined }, "invalid_request"],
    ["a missing availability", { isAvailable: undefined }, "invalid_request"],
    ["a missing category", { categoryId: undefined }, "invalid_request"],
    ["a missing name", { name: undefined }, "invalid_request"],
  ])("rejects %s with %s", (_label, override, code) => {
    const body = JSON.parse(JSON.stringify({ ...VALID, ...override }));
    const result = parseProductCreate(body);
    expect(result).toMatchObject({ ok: false, code });
    expect(result.ok === false && result.error.length).toBeGreaterThan(0);
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [-0.5]])("rejects the price %s, which JSON cannot carry intact", (priceKurus) => {
    expect(parseProductCreate({ ...VALID, priceKurus })).toMatchObject({ ok: false, code: "invalid_product" });
  });

  it.each([[null], [[]], ["text"], [42]])("rejects a non-object body %j", (body) => {
    expect(parseProductCreate(body)).toMatchObject({ ok: false, code: "invalid_request" });
  });
});

describe("parseProductPatch", () => {
  it("returns only the fields present", () => {
    expect(parseProductPatch({ isAvailable: false })).toEqual({ ok: true, value: { isAvailable: false } });
    expect(parseProductPatch({ name: " Doppio ", priceKurus: 12000 })).toEqual({
      ok: true,
      value: { name: "Doppio", priceKurus: 12000 },
    });
  });

  it.each([
    ["an empty body", {}, "invalid_request"],
    ["only an unknown field", { price: 100 }, "invalid_request"],
    ["a non-boolean availability", { isAvailable: "false" }, "invalid_request"],
    ["a negative price", { priceKurus: -1 }, "invalid_product"],
    ["a 61-character name", { name: "a".repeat(61) }, "invalid_product"],
  ])("rejects %s", (_label, body, code) => {
    expect(parseProductPatch(body)).toMatchObject({ ok: false, code });
  });
});
