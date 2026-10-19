import {
  videoPlaybackSchema,
  type ContentDocument,
  type VideoGateAudio,
  type VideoPlayback,
} from "@kakeai/contracts";
import { CompositionCompileError } from "./compile-error";
import {
  resolveCueWindow,
  resolveTimeline,
  sceneTransitionOf,
  type ResolvedTimeline,
  type ScenePlacement,
} from "./timeline";

export const GATE_SEGMENT_ATTRIBUTE = "data-kakeai-gate-segment";

export interface ResolvedVideoGateAudio {
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface VideoPlaybackPlanHold {
  kind: "hold";
  /** タイムライン上の絶対開始(ms)。 */
  startMs: number;
  /** タイムライン上の絶対終了(ms)。 */
  endMs: number;
  /** 保持する元動画の source 時刻(ms)。 */
  sourceMs: number;
}

export interface VideoPlaybackPlanPlay {
  kind: "play";
  startMs: number;
  endMs: number;
  /** 再生開始の元動画 source 時刻(ms)。 */
  sourceStartMs: number;
  /** この区間に適用する Gate 音声。無効なら null。 */
  audio: ResolvedVideoGateAudio | null;
}

export type VideoPlaybackPlanSegment = VideoPlaybackPlanHold | VideoPlaybackPlanPlay;

export interface VideoPlaybackPlan {
  /** メディア参照の位置キー。`RenderContext.path` の join("/") と一致する。 */
  path: string;
  assetId: string;
  cueId: string;
  sceneIndex: number;
  cueIndex: number;
  /** Cue の実効表示窓(絶対ms)。 */
  windowStartMs: number;
  windowEndMs: number;
  /** crossfade 延長を含む描画終端(絶対ms)。 */
  renderEndMs: number;
  sourceEndMs: number;
  segments: VideoPlaybackPlanSegment[];
}

export interface StillFrameRequest {
  assetId: string;
  sourceMs: number;
}

export interface VideoPlaybackPlansResult {
  plans: VideoPlaybackPlan[];
  byPath: Map<string, VideoPlaybackPlan>;
}

export interface DeriveVideoPlaybackPlansOptions {
  /** ready な video Asset の確定尺。省略時は `sourceEndMs` の指定が必要。 */
  resolveAssetDurationMs?: (assetId: string) => number | null;
  timeline?: ResolvedTimeline;
}

interface GatedMediaRef {
  assetId: string;
  playback: VideoPlayback;
  path: (string | number)[];
}

export type GatedMediaReference = GatedMediaRef;

/** 入力ツリー中の gated な video Asset 参照（直接メディア / Nested Media）を列挙する。 */
export function collectGatedMediaReferences(
  input: unknown,
  basePath: (string | number)[],
): GatedMediaReference[] {
  const out: GatedMediaRef[] = [];
  collectGatedMediaRefs(input, basePath, out);
  return out;
}

function collectGatedMediaRefs(
  input: unknown,
  path: (string | number)[],
  out: GatedMediaRef[],
  depth = 0,
): void {
  if (depth > MAX_GATED_WALK_DEPTH) {
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((entry, index) => collectGatedMediaRefs(entry, [...path, index], out, depth + 1));
    return;
  }
  if (typeof input !== "object" || input === null) {
    return;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.assetId === "string") {
    const playback = videoPlaybackSchema.safeParse(record.videoPlayback);
    if (playback.success) {
      out.push({ assetId: record.assetId, playback: playback.data, path });
    }
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "videoPlayback") {
      continue;
    }
    collectGatedMediaRefs(value, [...path, key], out, depth + 1);
  }
}

const MAX_GATED_WALK_DEPTH = 64;

function resolveGateAudio(audio: VideoGateAudio | undefined): ResolvedVideoGateAudio | null {
  if (audio === undefined || audio.enabled === false) {
    return null;
  }
  return {
    gainDb: audio.gainDb ?? 0,
    fadeInMs: audio.fadeInMs ?? 0,
    fadeOutMs: audio.fadeOutMs ?? 0,
  };
}

/**
 * 1つの Gate 付き素材について、タイムライン上の絶対区間列を導出する。
 * 早着時のみ保持を挿入し、sourceEndMs 到達後は末尾まで保持する。
 */
export function buildVideoPlaybackPlanSegments(options: {
  windowStartMs: number;
  renderEndMs: number;
  sourceEndMs: number;
  gates: readonly { lineStartMs: number; sourceMs: number; audio: VideoGateAudio | undefined }[];
}): VideoPlaybackPlanSegment[] {
  const { windowStartMs, renderEndMs, sourceEndMs } = options;
  const gates = [...options.gates].sort((a, b) => a.lineStartMs - b.lineStartMs);
  for (let index = 1; index < gates.length; index += 1) {
    const previous = gates[index - 1];
    const current = gates[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.sourceMs < previous.sourceMs
    ) {
      throw new CompositionCompileError([
        {
          path: [],
          code: "gate_order_mismatch",
          message: "GateのNarration Segment順とsourceMs順が一致しません。",
        },
      ]);
    }
  }
  const segments: VideoPlaybackPlanSegment[] = [];

  const pushPlay = (startMs: number, endMs: number, sourceStartMs: number, audio: ResolvedVideoGateAudio | null): void => {
    if (endMs - startMs <= 0) {
      return;
    }
    segments.push({ kind: "play", startMs, endMs, sourceStartMs, audio });
  };
  const pushHold = (startMs: number, endMs: number, sourceMs: number): void => {
    if (endMs - startMs <= 0) {
      return;
    }
    segments.push({ kind: "hold", startMs, endMs, sourceMs });
  };

  let cursor = windowStartMs;
  for (let index = 0; index < gates.length; index += 1) {
    const gate = gates[index];
    const next = gates[index + 1];
    if (gate === undefined) {
      break;
    }
    if (cursor < gate.lineStartMs) {
      const holdEndMs = Math.min(gate.lineStartMs, renderEndMs);
      pushHold(cursor, holdEndMs, gate.sourceMs);
      cursor = holdEndMs;
      if (cursor >= renderEndMs) {
        return segments;
      }
    }
    const playStartSourceMs = gate.sourceMs;
    const nextGateTimeMs = next === undefined ? Number.POSITIVE_INFINITY : next.lineStartMs;
    const limitSourceMs = next === undefined ? sourceEndMs : next.sourceMs;
    const limitTimeMs = cursor + Math.max(0, limitSourceMs - playStartSourceMs);
    const playEndMs = Math.min(limitTimeMs, nextGateTimeMs, renderEndMs);
    pushPlay(cursor, playEndMs, playStartSourceMs, resolveGateAudio(gate.audio));
    cursor = Math.max(cursor, playEndMs);
    if (cursor >= renderEndMs) {
      return segments;
    }
    if (playEndMs === limitTimeMs) {
      if (next !== undefined) {
        const holdEndMs = Math.min(nextGateTimeMs, renderEndMs);
        pushHold(cursor, holdEndMs, limitSourceMs);
        cursor = holdEndMs;
      } else {
        pushHold(cursor, renderEndMs, sourceEndMs);
        return segments;
      }
    }
  }
  return segments;
}

export function deriveVideoPlaybackPlans(
  document: ContentDocument,
  options: DeriveVideoPlaybackPlansOptions = {},
): VideoPlaybackPlansResult {
  const timeline = options.timeline ?? resolveTimeline(document);
  const plans: VideoPlaybackPlan[] = [];
  const byPath = new Map<string, VideoPlaybackPlan>();

  for (const placement of timeline.scenes) {
    const scene = document.scenes[placement.sceneIndex];
    if (scene === undefined) {
      continue;
    }
    const extensionMs = cueRenderExtensionMs(document, timeline, placement);
    for (const [cueIndex, cue] of scene.visualCues.entries()) {
      const cuePath: (string | number)[] = ["scenes", placement.sceneIndex, "visualCues", cueIndex];
      const refs: GatedMediaRef[] = [];
      collectGatedMediaRefs(cue.input, cuePath, refs);
      if (refs.length === 0) {
        continue;
      }
      const window = resolveCueWindow(placement, cue, cuePath);
      if (window === null) {
        continue;
      }
      const windowStartMs = placement.startMs + window.startMs;
      const windowEndMs = placement.startMs + window.endMs;
      const sceneEndMs = placement.startMs + placement.durationMs;
      const renderEndMs = (windowEndMs >= sceneEndMs ? extensionMs : 0) + windowEndMs;
      const lineStartById = new Map(placement.lines.map((line) => [line.lineId, line.startMs]));
      for (const ref of refs) {
        const sourceEndMs = resolveSourceEndMs(ref, options, ref.playback.sourceEndMs);
        const gates = ref.playback.gates.map((gate, gateIndex) => {
          const lineStartMs = lineStartById.get(gate.narrationSegmentId);
          if (lineStartMs === undefined) {
            throw new CompositionCompileError([
              {
                path: [...ref.path, "videoPlayback", "gates", gateIndex, "narrationSegmentId"],
                code: "unresolved_gate_line",
                message: "Gate の Narration Segment を解決できません。",
              },
            ]);
          }
          return { lineStartMs, sourceMs: gate.sourceMs, audio: gate.audio };
        });
        const segments = buildVideoPlaybackPlanSegments({
          windowStartMs,
          renderEndMs,
          sourceEndMs,
          gates,
        });
        const plan: VideoPlaybackPlan = {
          path: ref.path.join("/"),
          assetId: ref.assetId,
          cueId: cue.id,
          sceneIndex: placement.sceneIndex,
          cueIndex,
          windowStartMs,
          windowEndMs,
          renderEndMs,
          sourceEndMs,
          segments,
        };
        plans.push(plan);
        byPath.set(plan.path, plan);
      }
    }
  }

  return { plans, byPath };
}

function resolveSourceEndMs(
  ref: GatedMediaRef,
  options: DeriveVideoPlaybackPlansOptions,
  explicitSourceEndMs: number | undefined,
): number {
  if (explicitSourceEndMs !== undefined) {
    return explicitSourceEndMs;
  }
  const durationMs = options.resolveAssetDurationMs?.(ref.assetId) ?? null;
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new CompositionCompileError([
      {
        path: [...ref.path, "videoPlayback"],
        code: "unknown_asset_duration",
        message: "セリフゲート再生には確定尺を持つ video Asset が必要です。",
      },
    ]);
  }
  return durationMs;
}

function cueRenderExtensionMs(
  document: ContentDocument,
  timeline: ResolvedTimeline,
  placement: ScenePlacement,
): number {
  const placementIndex = timeline.scenes.findIndex(
    (entry) => entry.sceneIndex === placement.sceneIndex,
  );
  const nextPlacement = placementIndex < 0 ? undefined : timeline.scenes[placementIndex + 1];
  const nextScene = nextPlacement === undefined ? undefined : document.scenes[nextPlacement.sceneIndex];
  if (nextScene === undefined) {
    return 0;
  }
  const transition = sceneTransitionOf(nextScene);
  if (transition.preset !== "crossfade" || transition.durationMs <= 0) {
    return 0;
  }
  return transition.durationMs;
}

export function collectStillFrameRequests(
  plans: readonly VideoPlaybackPlan[],
): StillFrameRequest[] {
  const seen = new Set<string>();
  const requests: StillFrameRequest[] = [];
  for (const plan of plans) {
    for (const segment of plan.segments) {
      if (segment.kind !== "hold") {
        continue;
      }
      const key = `${plan.assetId}|${segment.sourceMs}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      requests.push({ assetId: plan.assetId, sourceMs: segment.sourceMs });
    }
  }
  return requests;
}
