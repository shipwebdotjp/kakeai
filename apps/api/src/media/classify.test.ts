import { describe, expect, it } from "vitest";
import { renditionPlanFor, requiresRenderRendition } from "./classify.ts";
import type { MediaProbe } from "./probe.ts";

function probe(overrides: Partial<MediaProbe>): MediaProbe {
  return {
    kind: "image",
    codec: "png",
    durationMs: null,
    widthPx: 100,
    heightPx: 100,
    rotation: 0,
    constantFrameRate: true,
    audioCodec: null,
    exifOrientation: 1,
    ...overrides,
  };
}

describe("requiresRenderRendition", () => {
  it("uses web-ready images directly", () => {
    expect(requiresRenderRendition(probe({ kind: "image", codec: "png" }))).toBe(false);
    expect(requiresRenderRendition(probe({ kind: "image", codec: "mjpeg" }))).toBe(false);
  });

  it("normalizes images that are rotated or in another codec", () => {
    expect(requiresRenderRendition(probe({ kind: "image", exifOrientation: 6 }))).toBe(true);
    expect(requiresRenderRendition(probe({ kind: "image", codec: "tiff" }))).toBe(true);
  });

  it("uses constant-frame-rate H.264 video directly", () => {
    expect(
      requiresRenderRendition(probe({ kind: "video", codec: "h264", audioCodec: "aac" })),
    ).toBe(false);
  });

  it("normalizes video that is not H.264, variable frame rate, or rotated", () => {
    expect(requiresRenderRendition(probe({ kind: "video", codec: "mpeg4" }))).toBe(true);
    expect(
      requiresRenderRendition(probe({ kind: "video", codec: "h264", constantFrameRate: false })),
    ).toBe(true);
    expect(requiresRenderRendition(probe({ kind: "video", codec: "h264", rotation: 90 }))).toBe(true);
  });

  it("uses common audio codecs directly", () => {
    expect(requiresRenderRendition(probe({ kind: "audio", codec: "pcm_s16le" }))).toBe(false);
    expect(requiresRenderRendition(probe({ kind: "audio", codec: "mp3" }))).toBe(false);
    expect(requiresRenderRendition(probe({ kind: "audio", codec: "wmav2" }))).toBe(true);
  });
});

describe("renditionPlanFor", () => {
  it("maps each kind to a render-ready target", () => {
    expect(renditionPlanFor("image")).toEqual({ mediaType: "image/png", extension: "png" });
    expect(renditionPlanFor("video")).toEqual({ mediaType: "video/mp4", extension: "mp4" });
    expect(renditionPlanFor("audio")).toEqual({ mediaType: "audio/wav", extension: "wav" });
  });
});
