import { z } from "zod";

export const tableToneSchema = z.enum([
  "primary",
  "secondary",
  "tertiary",
  "success",
  "warning",
  "error",
  "info",
]);
export type TableTone = z.infer<typeof tableToneSchema>;
export const TABLE_TONES = tableToneSchema.options;
