import { describe, expect, it } from "vitest";
import { jobInputSnapshotSchema, parseRenderJobSnapshot, renderJobSnapshotSchema } from "./job";
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

  it("accepts a tts snapshot", () => {
    const snapshot = {
      snapshotSchemaVersion: 1,
      kind: "tts",
      scriptVersionId: "scr_001",
      narrationSegmentId: "line-p1-1",
      languageEditionId: "led_ja",
      workId: "wrk_1",
      speakerId: "speaker-narrator",
      voiceProfileId: "vp_1",
      adapterId: "voicevox",
      voice: { voiceId: "uuid-1", styleId: 3 },
      speedScale: 1,
      speechText: "こんにちは",
      engineVersion: "0.19.0",
    };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("accepts an aivisspeech snapshot with a negative style id", () => {
    const snapshot = {
      snapshotSchemaVersion: 1,
      kind: "tts",
      scriptVersionId: "scr_001",
      narrationSegmentId: "line-p1-1",
      languageEditionId: "led_ja",
      workId: "wrk_1",
      speakerId: "speaker-narrator",
      speakerName: "ナレーター",
      voiceProfileId: "vp_1",
      adapterId: "aivisspeech",
      voice: { voiceId: "uuid-aivis", styleId: -1 },
      styleName: "ノーマル",
      speedScale: 1,
      speechText: "こんにちは",
      engineVersion: "1.0.0",
    };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("rejects an unknown job kind", () => {
    const snapshot = { snapshotSchemaVersion: 1, kind: "translate" };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});

describe("parseRenderJobSnapshot", () => {
  function renderSnapshotWith(content: unknown) {
    return {
      snapshotSchemaVersion: 1,
      kind: "render",
      scriptVersionId: "scr_001",
      versionNumber: 1,
      content,
      assets: [],
      template: { id: "explanation-scenes", version: 1 },
      output: { width: 1920, height: 1080, fps: 30, format: "mp4" },
    };
  }

  it("migrates v5 snapshot content to the current version", () => {
    const v5 = validContentDocument() as unknown as Record<string, unknown>;
    v5.schemaVersion = 5;
    delete v5.visualTheme;
    v5.scenes = (v5.scenes as Record<string, unknown>[]).map((scene) => {
      const copy = { ...scene };
      copy.accentColor = "#2563EB";
      delete copy.accent;
      return copy;
    });
    const parsed = parseRenderJobSnapshot(renderSnapshotWith(v5));
    expect(parsed.content.schemaVersion).toBe(6);
    expect(parsed.content.visualTheme).toEqual({ id: "soft-editorial", version: 1 });
    for (const scene of parsed.content.scenes) {
      expect(scene.accent).toEqual({ kind: "theme", token: "primary" });
    }
  });

  it("parses a current snapshot unchanged", () => {
    const parsed = parseRenderJobSnapshot(renderSnapshotWith(validContentDocument()));
    expect(parsed.content.schemaVersion).toBe(6);
  });
});
