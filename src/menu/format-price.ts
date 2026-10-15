// The one TRY formatter for prices and totals. Server pages and client
// components both use it, so the same kuruş value renders the same text on
// the server and after hydration.
const TRY_FORMAT = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

export function formatPriceKurus(kurus: number): string {
  if (!Number.isSafeInteger(kurus)) {
    throw new RangeError(`Price must be an integer number of kuruş, got ${kurus}`);
  }
  return TRY_FORMAT.format(kurus / 100);
}
