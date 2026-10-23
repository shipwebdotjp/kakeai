import type { TableNumberFormat } from "@kakeai/contracts";

export function currencyForLocale(locale: string): string {
  return locale.startsWith("ja") ? "JPY" : "USD";
}

export function formatNumber(
  value: number,
  format: TableNumberFormat | undefined,
  locale = "ja-JP",
): string {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currencyForLocale(locale),
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    case "integer":
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
    case "decimal":
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      }).format(value);
    default:
      return String(value);
  }
}
