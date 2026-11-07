import { liveMediaTypeSchema, type LiveMediaType } from "@kakeai/contracts";
import { LiveExportError } from "./errors";

const MEDIA_TYPE_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "audio/mp3": "audio/mpeg",
};

export function toLiveMediaType(value: string, id: string | null = null): LiveMediaType {
  const base = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const normalized = MEDIA_TYPE_ALIASES[base] ?? base;
  const parsed = liveMediaTypeSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new LiveExportError(
      "LIVE_EXPORT_MATERIAL_FAILED",
      "material",
      `未対応の mediaType です: ${value}`,
      id,
    );
  }
  return parsed.data;
}
