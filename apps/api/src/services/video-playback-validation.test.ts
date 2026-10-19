import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSITION_POLICY,
  createInitialContentDocument,
  createInsertScene,
  type ContentDocument,
  type NarrationSegment,
  type VideoPlayback,
  type VisualCue,
} from "@kakeai/contracts";
import { assertVideoPlayback, type AssetWithRenditions } from "./script-versions.ts";

function line(id: string): NarrationSegment {
  return {
    id,
    speakerId: null,
    captionText: "",
    speechText: "",
    selectedAudioTakeId: null,
    expressionId: null,
  };
}

function mediaCue(
  range: VisualCue["range"],
  playback: VideoPlayback,
): VisualCue {
  return {
    id: "visual-gated",
    template: { id: "media.full-bleed", version: 1 },
    range,
    layer: "background",
    order: 0,
    transition: {
      enter: { ...DEFAULT_TRANSITION_POLICY.defaultEnter },
      exit: { ...DEFAULT_TRANSITION_POLICY.defaultExit },
    },
    input: { assetId: "asset-video", fit: "cover", videoPlayback: playback },
  };
}

/** 導入(4000ms固定) + 要点(台詞2件: 4500-7000, 7000-9500) の文書。 */
function gatedDocument(cue: VisualCue): ContentDocument {
  const document = createInitialContentDocument();
  const scene = document.scenes[1]!;
  scene.lines = [line("line-1"), line("line-2")];
  scene.visualCues = [cue];
  return document;
}

function videoAsset(overrides: Record<string, unknown> = {}): AssetWithRenditions {
  return {
    id: "asset-video",
    kind: "video",
    durationMs: 10000,
    renditions: [],
    ...overrides,
  } as unknown as AssetWithRenditions;
}

function assetMap(asset: AssetWithRenditions = videoAsset()): Map<string, AssetWithRenditions> {
  return new Map([[asset.id, asset]]);
}

/** assertVideoPlayback が返す検証issueのメッセージ一覧。例外が出なければ空配列。 */
function issueMessages(run: () => void): string[] {
  try {
    run();
  } catch (error) {
    const details = (error as { details?: { issues?: { message?: string }[] } }).details;
    return (details?.issues ?? []).map((issue) => issue.message ?? "");
  }
  return [];
}

function expectRejected(run: () => void, pattern: RegExp): void {
  const messages = issueMessages(run).join("\n");
  expect(messages).toMatch(pattern);
}

describe("assertVideoPlayback", () => {
  it("accepts a gated playback whose gates are inside the cue window", () => {
    const cue = mediaCue(
      { kind: "lines", startLineId: "line-1", endLineId: "line-2" },
      {
        mode: "gated",
        gates: [
          { narrationSegmentId: "line-1", sourceMs: 0 },
          { narrationSegmentId: "line-2", sourceMs: 2000 },
        ],
      },
    );
    expect(() => assertVideoPlayback(gatedDocument(cue), assetMap())).not.toThrow();
  });

  it("rejects a gate whose line is outside the cue window", () => {
    const cue = mediaCue(
      { kind: "offset", startMs: 0, endMs: 200 },
      { mode: "gated", gates: [{ narrationSegmentId: "line-1", sourceMs: 0 }] },
    );
    expectRejected(() => assertVideoPlayback(gatedDocument(cue), assetMap()), /表示区間内/);
  });

  it("rejects gates listed against the Scene line order", () => {
    const cue = mediaCue(
      { kind: "scene" },
      {
        mode: "gated",
        gates: [
          { narrationSegmentId: "line-2", sourceMs: 0 },
          { narrationSegmentId: "line-1", sourceMs: 2000 },
        ],
      },
    );
    expectRejected(() => assertVideoPlayback(gatedDocument(cue), assetMap()), /登録順/);
  });

  it("rejects a gate at or beyond sourceEndMs", () => {
    const cue = mediaCue(
      { kind: "scene" },
      {
        mode: "gated",
        sourceEndMs: 3000,
        gates: [{ narrationSegmentId: "line-1", sourceMs: 5000 }],
      },
    );
    expectRejected(() => assertVideoPlayback(gatedDocument(cue), assetMap()), /sourceEndMs/);
  });

  it("rejects gated playback on a non-video asset", () => {
    const cue = mediaCue(
      { kind: "scene" },
      { mode: "gated", gates: [{ narrationSegmentId: "line-1", sourceMs: 0 }] },
    );
    expectRejected(
      () => assertVideoPlayback(gatedDocument(cue), assetMap(videoAsset({ kind: "image" }))),
      /動画素材/,
    );
  });

  it("rejects gated playback on a video without a confirmed duration", () => {
    const cue = mediaCue(
      { kind: "scene" },
      { mode: "gated", gates: [{ narrationSegmentId: "line-1", sourceMs: 0 }] },
    );
    expectRejected(
      () => assertVideoPlayback(gatedDocument(cue), assetMap(videoAsset({ durationMs: null }))),
      /尺が確定していない/,
    );
  });

  it("rejects fades longer than the gate segment", () => {
    const cue = mediaCue(
      { kind: "scene" },
      {
        mode: "gated",
        gates: [
          {
            narrationSegmentId: "line-1",
            sourceMs: 0,
            audio: { enabled: true, fadeInMs: 2000, fadeOutMs: 2000 },
          },
          { narrationSegmentId: "line-2", sourceMs: 1000 },
        ],
      },
    );
    expectRejected(() => assertVideoPlayback(gatedDocument(cue), assetMap()), /フェードの合計/);
  });

  it("rejects gated playback on an Insert Scene main video", () => {
    const document = createInitialContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画", "asset-video", 4000);
    const main = insert.visualCues[0]!;
    main.input = {
      ...(main.input as Record<string, unknown>),
      videoPlayback: { mode: "gated", gates: [{ narrationSegmentId: "line-1", sourceMs: 0 }] },
    };
    document.scenes.splice(1, 0, insert);
    expectRejected(() => assertVideoPlayback(document, assetMap()), /インサートScene/);
  });
});
