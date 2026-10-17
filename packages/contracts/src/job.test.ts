import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_SCHEMA_VERSION,
  jobInputSnapshotSchema,
  parseRenderJobSnapshot,
  renderJobSnapshotSchema,
} from "./job";
import { validContentDocument } from "./testing/fixtures";

describe("jobInputSnapshotSchema", () => {
  it("accepts a render snapshot built from a valid document", () => {
    const snapshot = {
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
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

  it("accepts a render snapshot with a fixed skin ref", () => {
    const snapshot = {
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      kind: "render",
      scriptVersionId: "scr_001",
      versionNumber: 1,
      content: validContentDocument(),
      assets: [],
      skin: { id: "neutral", version: 1 },
      template: { id: "explanation-scenes", version: 1 },
      output: { width: 1920, height: 1080, fps: 30, format: "mp4" },
    };
    expect(renderJobSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("accepts an asset_ingest snapshot", () => {
    const snapshot = {
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
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
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      kind: "tts",
      scriptVersionId: "scr_001",
      narrationSegmentId: "line-p1-1",
      languageEditionId: "led_ja",
      workId: "wrk_1",
      speakerId: "speaker-narrator",
      voiceProfileId: "vp_1",
      adapterId: "voicevox",
      voice: { voiceId: "uuid-1:3" },
      settings: {},
      speedScale: 1,
      speechText: "こんにちは",
      engineVersion: "0.19.0",
    };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("accepts an aivisspeech snapshot with an opaque voice id", () => {
    const snapshot = {
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      kind: "tts",
      scriptVersionId: "scr_001",
      narrationSegmentId: "line-p1-1",
      languageEditionId: "led_ja",
      workId: "wrk_1",
      speakerId: "speaker-narrator",
      speakerName: "ナレーター",
      voiceProfileId: "vp_1",
      adapterId: "aivisspeech",
      voice: { voiceId: "uuid-aivis:-1" },
      voiceName: "ノーマル",
      settings: {},
      speedScale: 1,
      speechText: "こんにちは",
      engineVersion: "1.0.0",
    };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("accepts an openai-compatible snapshot with model settings", () => {
    const snapshot = {
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      kind: "tts",
      scriptVersionId: "scr_001",
      narrationSegmentId: "line-p1-1",
      languageEditionId: "led_en",
      workId: "wrk_1",
      speakerId: "speaker-narrator",
      voiceProfileId: "vp_1",
      adapterId: "openai-compatible",
      voice: { voiceId: "af_heart" },
      settings: { model: "kokoro" },
      speedScale: 1,
      speechText: "Hello",
      engineVersion: null,
    };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("rejects an unknown job kind", () => {
    const snapshot = { snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION, kind: "translate" };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects a superseded snapshot version", () => {
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
      voice: { voiceId: "uuid-1:3" },
      speedScale: 1,
      speechText: "こんにちは",
      engineVersion: "0.19.0",
    };
    expect(jobInputSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});

describe("parseRenderJobSnapshot", () => {
  function renderSnapshotWith(content: unknown) {
    return {
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      kind: "render",
      scriptVersionId: "scr_001",
      versionNumber: 1,
      content,
      assets: [],
      template: { id: "explanation-scenes", version: 1 },
      output: { width: 1920, height: 1080, fps: 30, format: "mp4" },
    };
  }

  it("rejects snapshot content with a non-current schemaVersion", () => {
    const stale = validContentDocument() as unknown as Record<string, unknown>;
    stale.schemaVersion = 8;
    expect(() => parseRenderJobSnapshot(renderSnapshotWith(stale))).toThrow();
  });

  it("parses a current snapshot unchanged", () => {
    const parsed = parseRenderJobSnapshot(renderSnapshotWith(validContentDocument()));
    expect(parsed.content.schemaVersion).toBe(1);
  });
});
