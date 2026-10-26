import { z } from "zod";

export const idSchema = z.string().min(1);

export const accentColorSchema = z.string().regex(/^#[0-9A-F]{6}$/);

export const positiveInt = z.number().int().positive();
export const nonNegativeInt = z.number().int().nonnegative();

export const SUPPORTED_LOCALES = ["ja-JP", "en-US", "zh-Hans", "zh-Hant"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const localeSchema = z.enum(SUPPORTED_LOCALES);

const supportedLocaleCache = new Map<string, SupportedLocale | null>();

/**
 * Parses a locale string against the supported list, memoized per value so
 * per-element render paths do not re-run the schema check.
 */
export function asSupportedLocale(value: string | undefined): SupportedLocale | undefined {
  if (value === undefined) {
    return undefined;
  }
  const cached = supportedLocaleCache.get(value);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  const parsed = localeSchema.safeParse(value);
  const resolved = parsed.success ? parsed.data : null;
  supportedLocaleCache.set(value, resolved);
  return resolved ?? undefined;
}

export const timestampSchema = z.string().datetime();
