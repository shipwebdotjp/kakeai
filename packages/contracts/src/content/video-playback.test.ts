import { describe, expect, it } from "vitest";
import { mediaCardInputSchema, mediaFullBleedInputSchema } from "../templates";
import { nestedMediaVisualSchema } from "./nested";
import { videoPlaybackSchema } from "./video-playback";

function gated(gates: { narrationSegmentId: string; sourceMs: number }[]) {
  return { mode: "gated" as const, gates };
}

describe("videoPlaybackSchema", () => {
  it("正しい Gate 列を受け入れる", () => {
    const parsed = videoPlaybackSchema.safeParse(
      gated([
        { narrationSegmentId: "line-1", sourceMs: 0 },
        { narrationSegmentId: "line-2", sourceMs: 500 },
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it("sourceMs が昇順でない Gate 列を拒否する", () => {
    const parsed = videoPlaybackSchema.safeParse(
      gated([
        { narrationSegmentId: "line-1", sourceMs: 800 },
        { narrationSegmentId: "line-2", sourceMs: 400 },
      ]),
    );
    expect(parsed.success).toBe(false);
  });

  it("同じ Narration Segment を複数 Gate に指定できない", () => {
    const parsed = videoPlaybackSchema.safeParse(
      gated([
        { narrationSegmentId: "line-1", sourceMs: 0 },
        { narrationSegmentId: "line-1", sourceMs: 400 },
      ]),
    );
    expect(parsed.success).toBe(false);
  });

  it("Gate が 0 件では受け入れない", () => {
    expect(videoPlaybackSchema.safeParse(gated([])).success).toBe(false);
  });
});

describe("videoPlayback と連続再生の排他", () => {
  const playback = gated([{ narrationSegmentId: "line-1", sourceMs: 0 }]);

  it("media.full-bleed は loop と videoPlayback を併用できない", () => {
    const parsed = mediaFullBleedInputSchema.safeParse({
      assetId: "asset-video",
      fit: "cover",
      loop: true,
      videoPlayback: playback,
    });
    expect(parsed.success).toBe(false);
  });

  it("media.full-bleed は trim と videoPlayback を併用できない", () => {
    const parsed = mediaFullBleedInputSchema.safeParse({
      assetId: "asset-video",
      fit: "cover",
      trimStartMs: 0,
      videoPlayback: playback,
    });
    expect(parsed.success).toBe(false);
  });

  it("media.card は loop と videoPlayback を併用できない", () => {
    const parsed = mediaCardInputSchema.safeParse({
      assetId: "asset-video",
      heading: "見出し",
      loop: true,
      videoPlayback: playback,
    });
    expect(parsed.success).toBe(false);
  });

  it("videoPlayback 単体は受け入れる", () => {
    const parsed = mediaFullBleedInputSchema.safeParse({
      assetId: "asset-video",
      fit: "cover",
      videoPlayback: playback,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("nestedMediaVisualSchema", () => {
  it("videoPlayback を持つ Nested Media を受け入れる", () => {
    const parsed = nestedMediaVisualSchema.safeParse({
      kind: "media",
      assetId: "asset-video",
      videoPlayback: gated([{ narrationSegmentId: "line-1", sourceMs: 0 }]),
    });
    expect(parsed.success).toBe(true);
  });

  it("未知のフィールドを拒否する", () => {
    const parsed = nestedMediaVisualSchema.safeParse({
      kind: "media",
      assetId: "asset-video",
      playback: {},
    });
    expect(parsed.success).toBe(false);
  });
});
