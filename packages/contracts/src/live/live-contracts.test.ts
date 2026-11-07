import { describe, expect, it } from "vitest";
import {
  consoleSnapshotSchema,
  directorOutputSchema,
  jobSchema,
  liveCommandSchema,
  liveExportResultSchema,
  livePackageManifestSchema,
  livePackageRelativePathSchema,
  livePackageShowSchema,
  liveServerHelloMessageSchema,
  liveShowProfileSchema,
  preparedCueSchema,
  runLogEventSchema,
  stageEventSchema,
  stageStateSchema,
  type LiveShowProfile,
} from "..";

const HASH = "a".repeat(64);
const NOW = "2026-11-07T12:00:00.000Z";

function profile(): LiveShowProfile {
  return liveShowProfileSchema.parse({
    schemaVersion: 1,
    show: {
      title: "テスト配信",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      characters: { left: "char-left", right: null },
      startAt: null,
    },
    commentSource: { kind: "youtube" },
    segments: [
      {
        id: "seg-opening",
        kind: "opening",
        label: "オープニング",
        targetDurationMs: 60_000,
        cues: ["cue-opening"],
      },
      {
        id: "seg-script",
        kind: "script",
        label: "本編",
        targetDurationMs: 300_000,
        cues: ["cue-script"],
      },
      {
        id: "seg-closing",
        kind: "closing",
        label: "クロージング",
        targetDurationMs: 60_000,
        cues: ["cue-closing"],
      },
    ],
    scriptCues: [{ id: "cue-script", lineId: "line-1", expressionId: "smile" }],
    liveCues: [
      {
        id: "cue-opening",
        speaker: "left",
        caption: "始まります。",
        speech: "はじまります。",
        expression: "normal",
      },
      {
        id: "cue-closing",
        speaker: "left",
        caption: "終わります。",
        speech: "おわります。",
        expression: "normal",
      },
    ],
    materials: [{ id: "material-1", sceneId: "scene-1", focus: true, format: "png" }],
    safety: {
      blockedTopics: [],
      persona: "親しみやすい解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-opening",
    },
  });
}

describe("live contracts", () => {
  it("accepts a minimal Show Profile and applies defaults", () => {
    const parsed = profile();
    expect(parsed.commentPolicy.maxCommentsPerCorner).toBe(4);
    expect(parsed.playout.minBufferMs).toBe(10_000);
    expect(parsed.materials[0]?.durationMs).toBe(4000);
  });

  it("rejects unknown schema versions and duplicate cues", () => {
    const value = profile();
    expect(
      liveShowProfileSchema.safeParse({ ...value, schemaVersion: 2 }).success,
    ).toBe(false);
    const duplicate = {
      ...value,
      liveCues: [...value.liveCues, value.liveCues[0]!],
    };
    expect(liveShowProfileSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects paths that escape the package", () => {
    expect(livePackageRelativePathSchema.safeParse("../secret").success).toBe(false);
    expect(livePackageRelativePathSchema.safeParse("/absolute").success).toBe(false);
    expect(livePackageRelativePathSchema.safeParse("media/./ok.png").success).toBe(false);
    expect(livePackageRelativePathSchema.safeParse("media\\ok.png").success).toBe(false);
  });

  it("requires sourceLineId only for script cues", () => {
    expect(
      preparedCueSchema.safeParse({
        id: "cue-1",
        origin: "script",
        speaker: "left",
        caption: "字幕",
        speech: "こくじ",
        expression: "normal",
        audio: "audio/prepared/cue-0001.wav",
        durationMs: 1000,
      }).success,
    ).toBe(false);
    expect(
      preparedCueSchema.safeParse({
        id: "cue-2",
        origin: "live",
        sourceLineId: "line-1",
        speaker: "left",
        caption: "字幕",
        speech: "こくじ",
        expression: "normal",
        audio: "audio/prepared/cue-0002.wav",
        durationMs: 1000,
      }).success,
    ).toBe(false);
  });

  it("validates the package manifest and rejects unknown versions", () => {
    const manifest = {
      packageSchemaVersion: 1,
      exporterVersion: "0.1.0",
      packageId: "livepkg-test",
      createdAt: NOW,
      source: {
        workId: "work-1",
        languageEditionId: "edition-1",
        scriptVersionId: "script-1",
        theme: { id: "neutral", version: 1 },
        profileSha256: HASH,
      },
      files: [
        {
          path: "show.json",
          sha256: HASH,
          byteSize: 10,
          mediaType: "application/json",
          kind: "show",
          durationMs: null,
          width: null,
          height: null,
          hasAudio: false,
        },
      ],
      fonts: [],
      voices: [],
    };
    expect(livePackageManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      livePackageManifestSchema.safeParse({ ...manifest, packageSchemaVersion: 2 }).success,
    ).toBe(false);
    expect(
      livePackageManifestSchema.safeParse({
        ...manifest,
        files: [{ ...manifest.files[0], path: "../manifest.json" }],
      }).success,
    ).toBe(false);
  });

  it("validates the resolved show and stage/comment contracts", () => {
    expect(
      livePackageShowSchema.safeParse({
        schemaVersion: 1,
        show: profile().show,
        commentSource: { kind: "youtube" },
        segments: profile().segments,
        cues: [
          {
            id: "cue-opening",
            origin: "live",
            speaker: "left",
            caption: "始まります。",
            speech: "はじまります。",
            expression: "normal",
            audio: "audio/prepared/cue-0001.wav",
            durationMs: 1000,
          },
          {
            id: "cue-script",
            origin: "script",
            sourceLineId: "line-1",
            speaker: "left",
            caption: "本編です。",
            speech: "ほんぺんです。",
            expression: "smile",
            audio: "audio/prepared/cue-0002.wav",
            durationMs: 1000,
          },
          {
            id: "cue-closing",
            origin: "live",
            speaker: "left",
            caption: "終わります。",
            speech: "おわります。",
            expression: "normal",
            audio: "audio/prepared/cue-0003.wav",
            durationMs: 1000,
          },
        ],
        materials: [],
        speakers: [
          {
            id: "speaker-left",
            name: "左",
            side: "left",
            characterId: "char-left",
            voice: {
              adapterId: "voicevox",
              voiceId: "voice-1",
              speedScale: 1,
              settings: {},
            },
          },
        ],
        commentPolicy: profile().commentPolicy,
        safety: profile().safety,
        playout: profile().playout,
      }).success,
    ).toBe(true);

    const stageState = {
      phase: "pre_show",
      show: { title: "テスト配信", startAt: null },
      segment: null,
      characters: {
        left: { expression: "normal", speaking: false },
        right: null,
      },
      caption: null,
      material: null,
      comment: null,
      status: "idle",
      playback: null,
      clock: { elapsedMs: 0, remainingMs: 600_000 },
    };
    expect(stageStateSchema.safeParse(stageState).success).toBe(true);
    expect(stageStateSchema.safeParse({ ...stageState, show: undefined }).success).toBe(false);

    const showMeta = {
      title: "テスト配信",
      targetDurationMs: 600_000,
      segments: [
        {
          id: "seg-opening",
          label: "オープニング",
          kind: "opening" as const,
          targetDurationMs: 60_000,
        },
      ],
    };
    const lease = {
      leaseId: "lease-1",
      runId: "run-1",
      sessionId: "session-1",
      role: "program" as const,
      expiresAt: NOW,
    };
    expect(
      liveServerHelloMessageSchema.safeParse({
        type: "hello",
        runId: "run-1",
        sessionId: "session-1",
        role: "stage",
        lease,
        state: stageState,
        showMeta,
      }).success,
    ).toBe(true);
    expect(
      consoleSnapshotSchema.safeParse({
        runId: "run-1",
        show: showMeta,
        phase: "pre_show",
        segment: null,
        stages: [
          {
            sessionId: "session-1",
            role: "program",
            connectedAt: NOW,
            leaseExpiresAt: NOW,
          },
        ],
        queue: [],
        currentCueId: null,
        playback: null,
        status: "idle",
        clock: { elapsedMs: 0, remainingMs: 600_000 },
      }).success,
    ).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "start" }).success).toBe(true);
    expect(
      liveCommandSchema.safeParse({ kind: "takeover_program", sessionId: "session-1" }).success,
    ).toBe(true);

    expect(
      stageEventSchema.safeParse({
        kind: "audio_ended",
        runId: "run-1",
        sessionId: "session-1",
        cueId: "cue-1",
        attempt: 1,
        sequence: 2,
      }).success,
    ).toBe(true);

    expect(
      directorOutputSchema.safeParse({
        cues: [
          { speaker: "none", caption: "はい。", speech: "はい。", expression: "normal" },
        ],
        skip: false,
      }).success,
    ).toBe(true);

    expect(
      runLogEventSchema.safeParse({
        schemaVersion: 1,
        runId: "run-1",
        sequence: 1,
        at: NOW,
        type: "cue_generated",
        data: { cueId: "cue-1" },
      }).success,
    ).toBe(true);
  });

  it("enforces live_export Job result rules", () => {
    const base = {
      id: "job-1",
      kind: "live_export" as const,
      status: "succeeded" as const,
      workId: "work-1",
      assetId: null,
      languageEditionId: "edition-1",
      scriptVersionId: "script-1",
      progressPercent: 100,
      createdAt: NOW,
      startedAt: NOW,
      finishedAt: NOW,
      error: null,
      ttsResult: null,
      liveExportResult: {
        packagePath: "/tmp/package",
        packageId: "livepkg-test",
        manifestSha256: HASH,
        fileCount: 1,
        preparedCueCount: 1,
        warnings: [],
        failures: [],
      },
      artifacts: [],
    };
    expect(jobSchema.safeParse(base).success).toBe(true);
    expect(jobSchema.safeParse({ ...base, liveExportResult: null }).success).toBe(false);
    expect(
      jobSchema.safeParse({ ...base, kind: "render", liveExportResult: base.liveExportResult })
        .success,
    ).toBe(false);
    expect(
      liveExportResultSchema.safeParse({ ...base.liveExportResult, manifestSha256: "bad" }).success,
    ).toBe(false);
  });
});
