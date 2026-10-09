import type { AssetKindName } from "@kakeai/contracts";
import type { MediaProbe } from "./probe.ts";

const DIRECT_IMAGE_CODECS = new Set(["png", "mjpeg", "webp", "gif", "bmp", "avif"]);
const DIRECT_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "vorbis",
  "opus",
  "flac",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_f32le",
  "pcm_u8",
]);

export function requiresRenderRendition(probe: MediaProbe): boolean {
  if (probe.kind === "image") {
    return !DIRECT_IMAGE_CODECS.has(probe.codec) || probe.exifOrientation !== 1;
  }
  if (probe.kind === "video") {
    if (probe.codec !== "h264" || !probe.constantFrameRate || probe.rotation !== 0) {
      return true;
    }
    return probe.audioCodec !== null && !DIRECT_AUDIO_CODECS.has(probe.audioCodec);
  }
  return !DIRECT_AUDIO_CODECS.has(probe.codec);
}

export interface RenditionPlan {
  mediaType: string;
  extension: string;
}

export function renditionPlanFor(kind: AssetKindName): RenditionPlan {
  if (kind === "image") {
    return { mediaType: "image/png", extension: "png" };
  }
  if (kind === "video") {
    return { mediaType: "video/mp4", extension: "mp4" };
  }
  return { mediaType: "audio/wav", extension: "wav" };
}
