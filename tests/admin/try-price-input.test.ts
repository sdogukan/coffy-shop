import { describe, expect, it } from "vitest";
import { formatKurusForInput, parseTryToKurus } from "../../src/admin/try-price-input.ts";

describe("parseTryToKurus", () => {
  it.each([
    ["135,50", 13550],
    ["135", 13500],
    ["0,1", 10],
    ["0,01", 1],
    ["135,1", 13510],
    ["135,10", 13510],
    ["10000,00", 1_000_000],
    [" 42,5 ", 4250],
    ["9999999,99", 999_999_999],
  ])("maps %j to %i kuruş", (text, kurus) => {
    expect(parseTryToKurus(text)).toBe(kurus);
  });

  it.each([
    ["0,29", 0.29, 29],
    ["1,15", 1.15, 115],
    ["4,35", 4.35, 435],
  ])("gives exact kuruş for %j where float math would not", (text, lira, kurus) => {
    expect(lira * 100).not.toBe(kurus);
    expect(parseTryToKurus(text)).toBe(kurus);
  });

  it.each([
    ["an empty string", ""],
    ["only spaces", "   "],
    ["letters", "abc"],
    ["a three-digit fraction", "1,234"],
    ["a thousands separator", "1.250,00"],
    ["a negative number", "-5"],
    ["three decimals", "135,505"],
    ["a dot as decimal separator", "135.50"],
    ["a plus sign", "+5"],
    ["a trailing comma", "5,"],
    ["a leading comma", ",5"],
    ["a currency symbol", "₺135"],
    ["a currency word", "135 TL"],
    ["an exponent", "1e3"],
    ["eight lira digits", "12345678"],
    ["two commas", "1,2,3"],
    ["an inner space", "1 250"],
    ["Arabic-Indic digits", "١٣٥"],
  ])("rejects %s", (_name, text) => {
    expect(parseTryToKurus(text)).toBeNull();
  });
});

describe("formatKurusForInput", () => {
  it.each([
    [13550, "135,50"],
    [13500, "135,00"],
    [10, "0,10"],
    [1, "0,01"],
    [1_000_000, "10000,00"],
  ])("writes %i kuruş as %j, which parses back to the same value", (kurus, text) => {
    expect(formatKurusForInput(kurus)).toBe(text);
    expect(parseTryToKurus(text)).toBe(kurus);
  });

  it.each([[-1], [1.5], [Number.NaN]])("refuses %d", (kurus) => {
    expect(() => formatKurusForInput(kurus)).toThrow(RangeError);
  });
});
