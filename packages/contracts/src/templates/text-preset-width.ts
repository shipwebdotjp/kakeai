import { z } from "zod";

/** Occupied-width preset shared by `list.callout@1` and `quote@1`. */
export const textPresetWidthSchema = z.enum(["long", "medium", "short"]);
export type TextPresetWidth = z.infer<typeof textPresetWidthSchema>;

export const TEXT_PRESET_WIDTH_PX: Record<TextPresetWidth, number> = {
  long: 1400,
  medium: 1120,
  short: 840,
};

export const TEXT_PRESET_WIDTH_OPTIONS = [
  { value: "long", label: "長い" },
  { value: "medium", label: "中くらい" },
  { value: "short", label: "短い" },
] as const;
