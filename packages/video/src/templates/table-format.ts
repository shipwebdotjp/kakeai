import { SUPPORTED_LOCALES, type SupportedLocale, type TableNumberFormat } from "@kakeai/contracts";

// 新しい locale を SUPPORTED_LOCALES に足したら通貨もここに足す。
const CURRENCY_BY_LOCALE: Record<SupportedLocale, string> = {
  "ja-JP": "JPY",
  "en-US": "USD",
  "zh-Hans": "CNY",
  "zh-Hant": "TWD",
};

export function currencyForLocale(locale: string): string {
  return CURRENCY_BY_LOCALE[locale as SupportedLocale] ?? "USD";
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
