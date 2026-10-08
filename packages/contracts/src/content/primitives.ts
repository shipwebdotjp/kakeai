import { z } from "zod";

export const idSchema = z.string().min(1);

export const accentColorSchema = z.string().regex(/^#[0-9A-F]{6}$/);

export const positiveInt = z.number().int().positive();
export const nonNegativeInt = z.number().int().nonnegative();

export const localeSchema = z.literal("ja-JP");
export const SUPPORTED_LOCALES = ["ja-JP"] as const;

export const timestampSchema = z.string().datetime();
