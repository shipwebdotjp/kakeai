import { describe, expect, it } from "vitest";
import {
  buildVideoPlaybackPlanSegments,
  type VideoPlaybackPlanSegment,
} from "./video-playback";

function hold(startMs: number, endMs: number, sourceMs: number): VideoPlaybackPlanSegment {
  return { kind: "hold", startMs, endMs, sourceMs };
}

function play(
  startMs: number,
  endMs: number,
  sourceStartMs: number,
): VideoPlaybackPlanSegment {
  return { kind: "play", startMs, endMs, sourceStartMs, audio: null };
}

describe("buildVideoPlaybackPlanSegments", () => {
  it("Cue 表示直後から最初の Gate まで source 先頭で保持する", () => {
    const segments = buildVideoPlaybackPlanSegments({
      windowStartMs: 0,
      renderEndMs: 1000,
      sourceEndMs: 5000,
      gates: [{ lineStartMs: 200, sourceMs: 0, audio: undefined }],
    });
    expect(segments).toEqual([hold(0, 200, 0), play(200, 1000, 0)]);
  });

  it("早着したときだけ途中で保持し、次の Gate 開始で再開する", () => {
    const segments = buildVideoPlaybackPlanSegments({
      windowStartMs: 0,
      renderEndMs: 4000,
      sourceEndMs: 10000,
      gates: [
        { lineStartMs: 500, sourceMs: 0, audio: undefined },
        { lineStartMs: 3000, sourceMs: 1000, audio: undefined },
      ],
    });
    expect(segments).toEqual([
      hold(0, 500, 0),
      play(500, 1500, 0),
      hold(1500, 3000, 1000),
      play(3000, 4000, 1000),
    ]);
  });

  it("台詞が早い（遅着）ときは保持もシークも起きない", () => {
    const segments = buildVideoPlaybackPlanSegments({
      windowStartMs: 0,
      renderEndMs: 4000,
      sourceEndMs: 10000,
      gates: [
        { lineStartMs: 500, sourceMs: 0, audio: undefined },
        { lineStartMs: 800, sourceMs: 2000, audio: undefined },
      ],
    });
    expect(segments).toEqual([hold(0, 500, 0), play(500, 800, 0), play(800, 4000, 2000)]);
  });

  it("sourceEndMs 到達後は最終フレームを Cue 終端まで保持する", () => {
    const segments = buildVideoPlaybackPlanSegments({
      windowStartMs: 0,
      renderEndMs: 5000,
      sourceEndMs: 1000,
      gates: [{ lineStartMs: 200, sourceMs: 0, audio: undefined }],
    });
    expect(segments).toEqual([hold(0, 200, 0), play(200, 1200, 0), hold(1200, 5000, 1000)]);
  });

  it("ゼロ長の保持は出力しない", () => {
    const segments = buildVideoPlaybackPlanSegments({
      windowStartMs: 0,
      renderEndMs: 1000,
      sourceEndMs: 5000,
      gates: [{ lineStartMs: 0, sourceMs: 0, audio: undefined }],
    });
    expect(segments).toEqual([play(0, 1000, 0)]);
  });

  it("Gate ごとに音声設定を切り替える", () => {
    const segments = buildVideoPlaybackPlanSegments({
      windowStartMs: 0,
      renderEndMs: 3000,
      sourceEndMs: 5000,
      gates: [
        { lineStartMs: 0, sourceMs: 0, audio: { enabled: true, gainDb: -6 } },
        { lineStartMs: 1000, sourceMs: 500, audio: { enabled: false } },
      ],
    });
    expect(segments.map((segment) => (segment.kind === "play" ? segment.audio : "hold"))).toEqual([
      { gainDb: -6, fadeInMs: 0, fadeOutMs: 0 },
      "hold",
      null,
    ]);
  });

  it("crossfade 延長区間でも最後の状態を継続する", () => {
    const segments = buildVideoPlaybackPlanSegments({
      windowStartMs: 0,
      renderEndMs: 2500,
      sourceEndMs: 1000,
      gates: [{ lineStartMs: 100, sourceMs: 0, audio: undefined }],
    });
    expect(segments).toEqual([hold(0, 100, 0), play(100, 1100, 0), hold(1100, 2500, 1000)]);
  });
});
