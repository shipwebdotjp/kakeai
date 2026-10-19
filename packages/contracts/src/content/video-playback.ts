import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "./primitives";

export const VIDEO_GATE_GAIN_DB_MIN = -60;
export const VIDEO_GATE_GAIN_DB_MAX = 12;

export const MAX_VIDEO_GATES = 64;

/**
 * Video Gate Audio は、1つの Gate の source 区間だけに適用する埋め込み音声設定。
 * 省略は `{ enabled: false }` と同じ意味である。
 */
export const videoGateAudioSchema = z.discriminatedUnion("enabled", [
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({
    enabled: z.literal(true),
    gainDb: z.number().min(VIDEO_GATE_GAIN_DB_MIN).max(VIDEO_GATE_GAIN_DB_MAX).optional(),
    fadeInMs: nonNegativeInt.optional(),
    fadeOutMs: nonNegativeInt.optional(),
  }),
]);
export type VideoGateAudio = z.infer<typeof videoGateAudioSchema>;

export const videoGateSchema = z.strictObject({
  narrationSegmentId: idSchema,
  sourceMs: nonNegativeInt,
  audio: videoGateAudioSchema.optional(),
});
export type VideoGate = z.infer<typeof videoGateSchema>;

/**
 * Video Playback は、video Asset の時間的な扱いを表す共通入力。
 * 直接メディア入力と `NestedVisual.kind = "media"` が同じスキーマを使う。
 */
export const videoPlaybackSchema = z
  .strictObject({
    mode: z.literal("gated"),
    sourceEndMs: positiveInt.optional(),
    gates: z.array(videoGateSchema).min(1).max(MAX_VIDEO_GATES),
  })
  .superRefine((value, ctx) => {
    for (let index = 1; index < value.gates.length; index += 1) {
      const previous = value.gates[index - 1];
      const current = value.gates[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      if (current.sourceMs <= previous.sourceMs) {
        ctx.addIssue({
          code: "custom",
          message: "Gate の sourceMs は登録順に厳密な昇順で指定してください",
          path: ["gates", index, "sourceMs"],
        });
      }
    }
    const lineIds = value.gates.map((gate) => gate.narrationSegmentId);
    if (new Set(lineIds).size !== lineIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "同じ Narration Segment を複数の Gate に指定できません",
        path: ["gates"],
      });
    }
  });
export type VideoPlayback = z.infer<typeof videoPlaybackSchema>;

export interface VideoGateLineReference {
  lineId: string;
  path: (string | number)[];
}

/** Gate が参照する Narration Segment を line 参照として列挙する。 */
export function collectVideoGateLineRefs(
  playback: VideoPlayback,
  path: (string | number)[],
): VideoGateLineReference[] {
  return playback.gates.map((gate, index) => ({
    lineId: gate.narrationSegmentId,
    path: [...path, "gates", index, "narrationSegmentId"],
  }));
}

/**
 * 任意の入力ツリーから `videoPlayback` を拾い、その位置に含まれる Gate の
 * line 参照を列挙する。直接メディア入力と Nested Media の双方を対象にする。
 */
export function collectVideoPlaybackLineRefs(
  input: unknown,
  path: (string | number)[],
  depth = 0,
): VideoGateLineReference[] {
  if (depth > MAX_VIDEO_PLAYBACK_WALK_DEPTH) {
    return [];
  }
  if (Array.isArray(input)) {
    return input.flatMap((entry, index) =>
      collectVideoPlaybackLineRefs(entry, [...path, index], depth + 1),
    );
  }
  if (typeof input !== "object" || input === null) {
    return [];
  }
  const record = input as Record<string, unknown>;
  const references: VideoGateLineReference[] = [];
  const playback = videoPlaybackSchema.safeParse(record.videoPlayback);
  if (playback.success) {
    references.push(...collectVideoGateLineRefs(playback.data, [...path, "videoPlayback"]));
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "videoPlayback") {
      continue;
    }
    references.push(...collectVideoPlaybackLineRefs(value, [...path, key], depth + 1));
  }
  return references;
}

const MAX_VIDEO_PLAYBACK_WALK_DEPTH = 64;
