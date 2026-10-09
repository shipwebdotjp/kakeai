import { fileTypeFromFile } from "file-type";
import type { AssetKindName } from "@kakeai/contracts";

const ALLOWED_MEDIA_TYPES: Record<AssetKindName, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif"],
  video: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"],
  audio: [
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/ogg",
    "audio/webm",
    "audio/flac",
    "audio/x-flac",
  ],
};

const KINDS: readonly AssetKindName[] = ["image", "video", "audio"];

export interface DetectedMedia {
  kind: AssetKindName;
  mediaType: string;
}

export function classifyMediaType(mediaType: string): AssetKindName | null {
  for (const kind of KINDS) {
    if (ALLOWED_MEDIA_TYPES[kind].includes(mediaType)) {
      return kind;
    }
  }
  return null;
}

export function allowedMediaTypes(): readonly string[] {
  return KINDS.flatMap((kind) => ALLOWED_MEDIA_TYPES[kind]);
}

export async function detectMedia(filePath: string): Promise<DetectedMedia | null> {
  const type = await fileTypeFromFile(filePath);
  if (type === undefined) {
    return null;
  }
  const kind = classifyMediaType(type.mime);
  if (kind === null) {
    return null;
  }
  return { kind, mediaType: type.mime };
}
