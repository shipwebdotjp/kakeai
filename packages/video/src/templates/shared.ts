import type { AssetResolver, StillResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import type { RenderContext } from "../render-context";
import { GATE_SEGMENT_ATTRIBUTE, type VideoPlaybackPlan } from "../video-playback";

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

/** セリフゲート再生は動画素材にだけ指定できる。 */
export function assertVideoMedia(media: ResolvedMedia, path: (string | number)[]): void {
  if (media.kind !== "video") {
    throw new CompositionCompileError([
      { path, code: "invalid_asset_kind", message: "セリフゲート再生には動画素材を指定してください。" },
    ]);
  }
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

export function secondsText(ms: number): string {
  const seconds = ms / 1000;
  if (Number.isInteger(seconds)) {
    return String(seconds);
  }
  return String(Math.round(seconds * 1000) / 1000);
}

export function gainToVolume(gainDb: number | undefined): string {
  const db = Number.isFinite(gainDb) ? (gainDb as number) : 0;
  const volume = Math.min(3.98, Math.max(0, Math.pow(10, db / 20)));
  return String(Math.round(volume * 1000) / 1000);
}

export function renderLoopVideoSegments(options: {
  idPrefix: string;
  url: string;
  className: string;
  style: string;
  startMs: number;
  spanMs: number;
  sourceDurationMs: number | null;
  mediaStartMs?: number;
  loopLengthMs?: number | null;
  audible?: boolean;
  volume?: string;
  path: (string | number)[];
}): string | null {
  const fullSourceMs = options.sourceDurationMs;
  const mediaStartMs = options.mediaStartMs ?? 0;
  const sourceMs =
    options.loopLengthMs !== undefined
      ? options.loopLengthMs
      : fullSourceMs === null
        ? null
        : fullSourceMs - mediaStartMs;
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
  const audioAttr = options.audible === true ? ' data-has-audio="true"' : " muted";
  const volumeAttr =
    options.audible === true && options.volume !== undefined
      ? ` data-volume="${escapeHtmlAttribute(options.volume)}"`
      : "";
  const mediaStartText = secondsText(mediaStartMs);
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
      `<video id="${id}" class="${options.className}" src="${src}" style="${options.style}"${audioAttr}${volumeAttr} playsinline preload="auto" data-media-start="${mediaStartText}" data-start="${secondsText(startMs)}" data-duration="${secondsText(durationMs)}" data-kakeai-loop-segment="true"${last}></video>`,
    );
  }
  return segments.join("");
}

/**
 * VideoPlaybackPlan の区間列を、絶対タイミングを持つ video / 静止 img として描画する。
 * 直接メディアと Nested Media で共通に使う。
 */export function renderVideoPlaybackSegments(options: {
  idPrefix: string;
  plan: VideoPlaybackPlan;
  videoUrl: string;
  className: string;
  style: string;
  stillResolver: StillResolver | undefined;
  path: (string | number)[];
}): string {
  const segments: string[] = [];
  options.plan.segments.forEach((segment, index) => {
    const id = escapeHtmlAttribute(`${options.idPrefix}-${index}`);
    const start = secondsText(segment.startMs);
    const duration = secondsText(segment.endMs - segment.startMs);
    if (segment.kind === "hold") {
      if (options.stillResolver === undefined) {
        throw new CompositionCompileError([
          {
            path: options.path,
            code: "missing_still_resolver",
            message: "保持フレームの解決器が設定されていません。",
          },
        ]);
      }
      const src = escapeHtmlAttribute(options.stillResolver(options.plan.assetId, segment.sourceMs));
      segments.push(
        `<img id="${id}" class="${options.className}" src="${src}" style="${options.style}" alt="" data-start="${start}" data-duration="${duration}" ${GATE_SEGMENT_ATTRIBUTE}="true">`,
      );
      return;
    }
    const src = escapeHtmlAttribute(options.videoUrl);
    const audioAttr = segment.audio === null ? " muted" : ' data-has-audio="true"';
    const volumeAttr =
      segment.audio === null
        ? ""
        : ` data-volume="${escapeHtmlAttribute(gainToVolume(segment.audio.gainDb))}"`;
    const fadeIn =
      segment.audio !== null && segment.audio.fadeInMs > 0
        ? ` data-fade-in="${secondsText(segment.audio.fadeInMs)}"`
        : "";
    const fadeOut =
      segment.audio !== null && segment.audio.fadeOutMs > 0
        ? ` data-fade-out="${secondsText(segment.audio.fadeOutMs)}"`
        : "";
    segments.push(
      `<video id="${id}" class="${options.className}" src="${src}" style="${options.style}"${audioAttr}${volumeAttr}${fadeIn}${fadeOut} playsinline preload="auto" data-media-start="${secondsText(segment.sourceStartMs)}" data-start="${start}" data-duration="${duration}" ${GATE_SEGMENT_ATTRIBUTE}="true"></video>`,
    );
  });
  return segments.join("");
}

/**
 * 現在の描画位置に対応する VideoPlaybackPlan を取り出す。
 * Plan が渡されていないのに gated な素材へ到達した場合はコンパイルエラーにする。
 */
export function requireVideoPlaybackPlan(context: RenderContext): VideoPlaybackPlan {
  const key = context.path.join("/");
  const plan = context.videoPlaybackPlans?.get(key);
  if (plan === undefined) {
    throw new CompositionCompileError([
      {
        path: context.path,
        code: "gate_plan_missing",
        message:
          "セリフゲート再生のPlanがありません。プレビュー/レンダーでPlanを導出して渡してください。",
      },
    ]);
  }
  return plan;
}
