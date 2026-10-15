import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";

export const MAX_LOOP_COPIES = 1000;

export interface RenderedMedia {
  html: string;
  assetIds: string[];
}

export interface ResolvedMedia {
  url: string;
  kind: "image" | "video";
  durationMs: number | null;
}

export function resolveCueMedia(
  assetId: string,
  assetResolver: AssetResolver,
  path: (string | number)[],
): ResolvedMedia {
  const resolved = assetResolver(assetId);
  if (resolved.kind === "audio") {
    throw new CompositionCompileError([
      { path, code: "invalid_asset_kind", message: "画像または動画を指定してください。" },
    ]);
  }
  return { url: resolved.url, kind: resolved.kind, durationMs: resolved.durationMs ?? null };
}

export function focalPointStyle(focalPoint: { x: number; y: number } | undefined): string {
  const point = focalPoint ?? { x: 0.5, y: 0.5 };
  return `object-position:${point.x * 100}% ${point.y * 100}%;`;
}

export function mediaCropStyle(
  focalPoint: { x: number; y: number } | undefined,
  zoom: number | undefined,
): string {
  const base = focalPointStyle(focalPoint);
  if (zoom === undefined) {
    return base;
  }
  const point = focalPoint ?? { x: 0.5, y: 0.5 };
  return `${base}transform:scale(${zoom});transform-origin:${point.x * 100}% ${point.y * 100}%;`;
}

function secondsText(ms: number): string {
  const seconds = ms / 1000;
  if (Number.isInteger(seconds)) {
    return String(seconds);
  }
  return String(Math.round(seconds * 1000) / 1000);
}

export function renderLoopVideoSegments(options: {
  idPrefix: string;
  url: string;
  className: string;
  style: string;
  startMs: number;
  spanMs: number;
  sourceDurationMs: number | null;
  path: (string | number)[];
}): string | null {
  const sourceMs = options.sourceDurationMs;
  if (sourceMs === null || sourceMs <= 0 || sourceMs >= options.spanMs) {
    return null;
  }
  const copies = Math.ceil(options.spanMs / sourceMs);
  if (copies > MAX_LOOP_COPIES) {
    throw new CompositionCompileError([
      {
        path: options.path,
        code: "loop_span_too_long",
        message:
          "ループ動画の繰り返し回数が多すぎます。表示区間を短くするか、より長い動画素材を指定してください。",
      },
    ]);
  }
  const src = escapeHtmlAttribute(options.url);
  const segments: string[] = [];
  for (let index = 0; index < copies; index += 1) {
    const startMs = options.startMs + index * sourceMs;
    const durationMs = Math.min(sourceMs, options.spanMs - index * sourceMs);
    if (durationMs <= 0) {
      break;
    }
    const id = escapeHtmlAttribute(`${options.idPrefix}-${index}`);
    const last = index === copies - 1 ? " data-kakeai-loop-segment-last=\"true\"" : "";
    segments.push(
      `<video id="${id}" class="${options.className}" src="${src}" style="${options.style}" muted playsinline preload="auto" data-media-start="0" data-start="${secondsText(startMs)}" data-duration="${secondsText(durationMs)}" data-kakeai-loop-segment="true"${last}></video>`,
    );
  }
  return segments.join("");
}
