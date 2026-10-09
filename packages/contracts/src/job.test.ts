import { describe, expect, it } from "vitest";
import { jobInputSnapshotSchema, renderJobSnapshotSchema } from "./job";
import { validContentDocument } from "./testing/fixtures";

describe("jobInputSnapshotSchema", () => {
  it("accepts a render snapshot built from a valid document", () => {
    const snapshot = {
      snapshotSchemaVersion: 1,
      kind: "render",
      scriptVersionId: "scr_001",
      versionNumber: 1,
      content: validContentDocument(),
      assets: [
        {
          assetId: "asset-audio-1",
          renditionId: null,
          sha256: "sha256:abc",
          mediaType: "audio/wav",
          byteSize: 1024,
          durationMs: 3000,
          widthPx: null,
          heightPx: null,
        },
      ],
      template: { id: "explanation-scenes", version: 1 },
      output: { width: 1920, height: 1080, fps: 30, format: "mp4" },
    };
    expect(renderJobSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("accepts an asset_ingest snapshot", () => {
    const snapshot = {
      snapshotSchemaVersion: 1,
      kind: "asset_ingest",
      assetId: "asset-1",
      sha256: "sha256:abc",
      mediaType: "image/png",
      storageKey: "assets/ab/cd/abcd",
    };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("rejects an unknown job kind", () => {
    const snapshot = { snapshotSchemaVersion: 1, kind: "tts" };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});
