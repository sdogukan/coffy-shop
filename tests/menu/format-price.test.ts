import { describe, expect, it } from "vitest";
import { formatPriceKurus } from "../../src/menu/format-price.ts";

describe("formatPriceKurus", () => {
  it("formats integer kuruş as Turkish lira with tr-TR separators", () => {
    expect(formatPriceKurus(9000)).toBe("₺90,00");
    expect(formatPriceKurus(13550)).toBe("₺135,50");
    expect(formatPriceKurus(123450)).toBe("₺1.234,50");
    expect(formatPriceKurus(0)).toBe("₺0,00");
  });

  it("rejects a value that is not an integer number of kuruş", () => {
    expect(() => formatPriceKurus(90.5)).toThrow(RangeError);
    expect(() => formatPriceKurus(Number.NaN)).toThrow(RangeError);
    expect(() => formatPriceKurus(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
