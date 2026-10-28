import type { SupportedLocale } from "@kakeai/contracts";

/** Localized labels for the supported locales, shared by locale pickers. */
export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  "ja-JP": "日本語",
  "en-US": "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

/** Display label for the Edition locale shown on the thumbnail screen. */
export function editionLocaleLabel(locale: SupportedLocale): string {
  return `${LOCALE_LABELS[locale]} (${locale})`;
}
