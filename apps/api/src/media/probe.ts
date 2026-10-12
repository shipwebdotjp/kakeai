import type { AssetKindName } from "@kakeai/contracts";
import { readJpegOrientation } from "./exif.ts";
import { runFfprobe } from "./ffmpeg.ts";

export interface MediaProbe {
  kind: AssetKindName;
  codec: string;
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
  rotation: number;
  constantFrameRate: boolean;
  audioCodec: string | null;
  exifOrientation: number;
  hasAlpha: boolean;
}

interface ProbeStream {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  pix_fmt?: unknown;
  r_frame_rate?: unknown;
  avg_frame_rate?: unknown;
  side_data_list?: unknown;
  tags?: unknown;
}

interface ProbeFormat {
  duration?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseFrameRate(value: unknown): number | undefined {
  const text = asString(value);
  if (text === undefined) {
    return undefined;
  }
  if (!text.includes("/")) {
    const single = Number(text);
    return Number.isFinite(single) && single > 0 ? single : undefined;
  }
  const [numerator, denominator] = text.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }
  return numerator / denominator;
}

function rotationFromStream(stream: ProbeStream): number {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  for (const entry of sideData) {
    if (typeof entry === "object" && entry !== null) {
      const rotation = asNumber((entry as { rotation?: unknown }).rotation);
      if (rotation !== undefined) {
        return rotation;
      }
    }
  }
  const tags = typeof stream.tags === "object" && stream.tags !== null ? (stream.tags as Record<string, unknown>) : {};
  const rawRotate = tags.rotate;
  const tagRotation =
    typeof rawRotate === "string" ? asNumber(Number(rawRotate)) : asNumber(rawRotate);
  return tagRotation ?? 0;
}

const ALPHA_PIX_FMT_TOKENS = ["yuva", "rgba", "argb", "abgr", "bgra", "gbrap", "ayuv"];

function pixelFormatHasAlpha(pixFmt: string | undefined): boolean {
  if (pixFmt === undefined) {
    return false;
  }
  const name = pixFmt.toLowerCase();
  if (/^ya\d/.test(name)) {
    return true;
  }
  return ALPHA_PIX_FMT_TOKENS.some((token) => name.includes(token));
}

function alphaModeEnabled(tags: unknown): boolean {
  if (typeof tags !== "object" || tags === null) {
    return false;
  }
  const entry = Object.entries(tags as Record<string, unknown>).find(
    ([key]) => key.toUpperCase() === "ALPHA_MODE",
  );
  const mode = entry?.[1];
  return mode === "1" || mode === 1;
}

export function summarizeProbe(kind: AssetKindName, raw: unknown): MediaProbe {
  const streams =
    typeof raw === "object" && raw !== null && Array.isArray((raw as { streams?: unknown }).streams)
      ? ((raw as { streams: ProbeStream[] }).streams)
      : [];
  const format =
    typeof raw === "object" && raw !== null && typeof (raw as { format?: unknown }).format === "object"
      ? ((raw as { format: ProbeFormat }).format)
      : {};
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");

  const durationSeconds = asNumber(Number(format.duration));
  const videoRate = parseFrameRate(video?.r_frame_rate);
  const averageRate = parseFrameRate(video?.avg_frame_rate);
  const constantFrameRate =
    videoRate === undefined || averageRate === undefined || Math.abs(videoRate - averageRate) < 0.01;

  const isAudio = kind === "audio";
  const isImage = kind === "image";

  return {
    kind,
    codec:
      kind === "audio"
        ? (asString(audio?.codec_name) ?? asString(video?.codec_name) ?? "unknown")
        : (asString(video?.codec_name) ?? asString(audio?.codec_name) ?? "unknown"),
    durationMs: isImage || durationSeconds === undefined ? null : Math.round(durationSeconds * 1000),
    widthPx: isAudio ? null : (asNumber(video?.width) ?? null),
    heightPx: isAudio ? null : (asNumber(video?.height) ?? null),
    rotation: rotationFromStream(video ?? {}),
    constantFrameRate,
    audioCodec: asString(audio?.codec_name) ?? null,
    exifOrientation: 1,
    hasAlpha:
      pixelFormatHasAlpha(asString(video?.pix_fmt)) || alphaModeEnabled(video?.tags),
  };
}

export async function probeMedia(
  filePath: string,
  kind: AssetKindName,
  mediaType?: string,
): Promise<MediaProbe> {
  const raw = await runFfprobe(filePath);
  const probe = summarizeProbe(kind, raw);
  if (kind === "image" && mediaType === "image/jpeg") {
    try {
      probe.exifOrientation = await readJpegOrientation(filePath);
    } catch {
      probe.exifOrientation = 1;
    }
  }
  return probe;
}
