import { z } from "zod";

export const idSchema = z.string().min(1);

export const accentColorSchema = z.string().regex(/^#[0-9A-F]{6}$/);

export const positiveInt = z.number().int().positive();
export const nonNegativeInt = z.number().int().nonnegative();

export const SUPPORTED_LOCALES = ["ja-JP", "en-US"] as const;
export const localeSchema = z.enum(SUPPORTED_LOCALES);

export const timestampSchema = z.string().datetime();
