// The admin price field: Turkish lira typed as "135,50" becomes integer
// kuruş. Parsed as two digit strings, never through float math
// (0.29 * 100 is 28.999…). Only a comma separates the kuruş; a dot, a
// thousands separator, a sign or a currency symbol is rejected rather than
// guessed. The 0,01-10.000,00 TL range is the server's check.

// Seven lira digits keep every accepted value a safe integer.
const TRY_PATTERN = /^(\d{1,7})(?:,(\d{1,2}))?$/;

export const TRY_PRICE_FORMAT_MESSAGE = "Fiyatı 135,50 biçiminde, binlik ayırıcı kullanmadan girin.";

export function parseTryToKurus(text: string): number | null {
  const match = TRY_PATTERN.exec(text.trim());
  if (match === null) {
    return null;
  }
  const [, lira, kurus = ""] = match as unknown as [string, string, string | undefined];
  return Number(lira) * 100 + Number(kurus.padEnd(2, "0"));
}

// The value the edit form starts with: 13550 -> "135,50", 13500 -> "135,00".
export function formatKurusForInput(kurus: number): string {
  if (!Number.isSafeInteger(kurus) || kurus < 0) {
    throw new RangeError(`Price must be a non-negative integer number of kuruş, got ${kurus}`);
  }
  return `${Math.floor(kurus / 100)},${String(kurus % 100).padStart(2, "0")}`;
}
