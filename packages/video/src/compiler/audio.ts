import { toSecondsText } from "./animation";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import { MAX_LOOP_COPIES } from "../templates/shared";

export function audioElement(options: {
  id: string;
  url: string;
  startMs: number;
  durationMs: number;
  volume: string;
  mediaStartMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}): string {
  const mediaStart =
    options.mediaStartMs !== undefined && options.mediaStartMs > 0
      ? ` data-media-start="${toSecondsText(options.mediaStartMs)}"`
      : "";
  const fadeIn =
    options.fadeInMs !== undefined && options.fadeInMs > 0
      ? ` data-fade-in="${toSecondsText(options.fadeInMs)}"`
      : "";
  const fadeOut =
    options.fadeOutMs !== undefined && options.fadeOutMs > 0
      ? ` data-fade-out="${toSecondsText(options.fadeOutMs)}"`
      : "";
  return `<audio id="${escapeHtmlAttribute(options.id)}" src="${escapeHtmlAttribute(options.url)}"${mediaStart}${fadeIn}${fadeOut} data-start="${toSecondsText(options.startMs)}" data-duration="${toSecondsText(options.durationMs)}" data-volume="${escapeHtmlAttribute(options.volume)}"></audio>`;
}

export function buildLoopAudios(options: {
  idPrefix: string;
  url: string;
  spanStartMs: number;
  spanEndMs: number;
  volume: string;
  loop: boolean;
  sourceDurationMs: number | null | undefined;
  path: (string | number)[];
}): string[] {
  const { idPrefix, url, spanStartMs, spanEndMs, volume } = options;
  const spanMs = spanEndMs - spanStartMs;
  if (spanMs <= 0) {
    return [];
  }
  const sourceMs = options.sourceDurationMs ?? null;
  if (!options.loop || sourceMs === null || sourceMs <= 0) {
    const durationMs = sourceMs !== null ? Math.min(sourceMs, spanMs) : spanMs;
    return [
      audioElement({
        id: `${idPrefix}-0`,
        url,
        startMs: spanStartMs,
        durationMs,
        volume,
      }),
    ];
  }
  const copies = Math.ceil(spanMs / sourceMs);
  if (copies > MAX_LOOP_COPIES) {
    throw new CompositionCompileError([
      {
        path: options.path,
        code: "loop_span_too_long",
        message:
          "ループ音声の繰り返しが多すぎるため、音声を短く設定できません。",
      },
    ]);
  }
  const elements: string[] = [];
  for (let index = 0; index < copies; index += 1) {
    const startMs = spanStartMs + index * sourceMs;
    const durationMs = Math.min(sourceMs, spanEndMs - startMs);
    if (durationMs <= 0) {
      break;
    }
    elements.push(
      audioElement({
        id: `${idPrefix}-${index}`,
        url,
        startMs,
        durationMs,
        volume,
      }),
    );
  }
  return elements;
}

const BGM_SUPPRESSION_FADE_MS = 200;

function subtractWindows(
  spanStartMs: number,
  spanEndMs: number,
  windows: readonly { startMs: number; endMs: number }[],
): { startMs: number; endMs: number }[] {
  const clipped = windows
    .map((window) => ({
      startMs: Math.max(window.startMs, spanStartMs),
      endMs: Math.min(window.endMs, spanEndMs),
    }))
    .filter((window) => window.endMs > window.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const active: { startMs: number; endMs: number }[] = [];
  let cursor = spanStartMs;
  for (const window of clipped) {
    if (window.startMs > cursor) {
      active.push({ startMs: cursor, endMs: window.startMs });
    }
    cursor = Math.max(cursor, window.endMs);
  }
  if (cursor < spanEndMs) {
    active.push({ startMs: cursor, endMs: spanEndMs });
  }
  return active;
}

function audioSegmentElements(options: {
  idPrefix: string;
  url: string;
  startMs: number;
  endMs: number;
  sourceOffsetMs: number;
  volume: string;
  loop: boolean;
  sourceDurationMs: number | null | undefined;
  fadeInMs: number;
  fadeOutMs: number;
  path: (string | number)[];
}): string[] {
  const { idPrefix, url, volume } = options;
  const spanMs = options.endMs - options.startMs;
  if (spanMs <= 0) {
    return [];
  }
  const sourceMs = options.sourceDurationMs ?? null;
  const specs: { startMs: number; durationMs: number; mediaStartMs: number }[] =
    [];
  if (!options.loop || sourceMs === null || sourceMs <= 0) {
    const mediaStartMs = sourceMs !== null ? options.sourceOffsetMs : 0;
    const available = sourceMs !== null ? sourceMs - mediaStartMs : spanMs;
    const durationMs = Math.min(Math.max(available, 0), spanMs);
    if (durationMs > 0) {
      specs.push({ startMs: options.startMs, durationMs, mediaStartMs });
    }
  } else {
    const phase = ((options.sourceOffsetMs % sourceMs) + sourceMs) % sourceMs;
    let cursor = options.startMs;
    let mediaStartMs = phase;
    while (cursor < options.endMs) {
      const durationMs = Math.min(
        sourceMs - mediaStartMs,
        options.endMs - cursor,
      );
      if (durationMs <= 0) {
        break;
      }
      specs.push({ startMs: cursor, durationMs, mediaStartMs });
      cursor += durationMs;
      mediaStartMs = 0;
      if (specs.length > MAX_LOOP_COPIES) {
        throw new CompositionCompileError([
          {
            path: options.path,
            code: "loop_span_too_long",
            message:
              "ループ音声の繰り返しが多すぎるため、音声を短く設定できません。",
          },
        ]);
      }
    }
  }
  return specs.map((spec, index) =>
    audioElement({
      id: `${idPrefix}-${index}`,
      url,
      startMs: spec.startMs,
      durationMs: spec.durationMs,
      volume,
      mediaStartMs: spec.mediaStartMs,
      fadeInMs: index === 0 ? options.fadeInMs : 0,
      fadeOutMs: index === specs.length - 1 ? options.fadeOutMs : 0,
    }),
  );
}

export function buildWorkAudioSegments(options: {
  idPrefix: string;
  url: string;
  workStartMs: number;
  workEndMs: number;
  muteWindows: readonly { startMs: number; endMs: number }[];
  volume: string;
  loop: boolean;
  sourceDurationMs: number | null | undefined;
  path: (string | number)[];
}): string[] {
  const active = subtractWindows(
    options.workStartMs,
    options.workEndMs,
    options.muteWindows,
  );
  const elements: string[] = [];
  const segmented = active.length > 1;
  active.forEach((segment, segmentIndex) => {
    const isFirst = segmentIndex === 0;
    const isLast = segmentIndex === active.length - 1;
    const segmentElements = audioSegmentElements({
      idPrefix: segmented
        ? `${options.idPrefix}-seg${segmentIndex}`
        : options.idPrefix,
      url: options.url,
      startMs: segment.startMs,
      endMs: segment.endMs,
      sourceOffsetMs: segment.startMs - options.workStartMs,
      volume: options.volume,
      loop: options.loop,
      sourceDurationMs: options.sourceDurationMs,
      fadeInMs: isFirst ? 0 : BGM_SUPPRESSION_FADE_MS,
      fadeOutMs: isLast ? 0 : BGM_SUPPRESSION_FADE_MS,
      path: options.path,
    });
    if (
      options.loop &&
      elements.length + segmentElements.length > MAX_LOOP_COPIES
    ) {
      throw new CompositionCompileError([
        {
          path: options.path,
          code: "loop_span_too_long",
          message:
            "ループ音声の繰り返しが多すぎるため、音声を短く設定できません。",
        },
      ]);
    }
    elements.push(...segmentElements);
  });
  return elements;
}
