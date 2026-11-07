import { describe, expect, it } from "vitest";
import {
  commentCornerSchema,
  commentSourceStatusSchema,
  consoleSnapshotSchema,
  liveCommentEntrySchema,
  directorOutputSchema,
  jobSchema,
  liveCommandSchema,
  liveExportResultSchema,
  livePackageManifestSchema,
  livePackageRelativePathSchema,
  livePackageShowSchema,
  liveRuntimeConfigSchema,
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

    const playback = {
      cueId: "cue-script",
      attempt: 1,
      sequence: 4,
      startedAt: NOW,
      audioUrl: "audio/prepared/cue-0002.wav",
    };
    expect(
      stageStateSchema.safeParse({
        ...stageState,
        phase: "script",
        status: "speaking",
        playback,
      }).success,
    ).toBe(true);
    expect(
      stageStateSchema.safeParse({
        ...stageState,
        playback: { ...playback, sequence: undefined },
      }).success,
    ).toBe(false);

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
        queuePosition: null,
        playback: null,
        status: "idle",
        clock: { elapsedMs: 0, remainingMs: 600_000 },
        comments: [],
        commentCorner: {
          state: "idle",
          segmentId: null,
          selectedCommentIds: [],
          currentCommentId: null,
          deferredPinIds: [],
          remainingSlots: 0,
        },
        commentSource: {
          kind: "youtube",
          state: "idle",
          liveChatId: null,
          pollingIntervalMs: 0,
          lastPolledAt: null,
          lastError: null,
          quota: null,
          authExpiresAt: null,
          needsReauth: false,
        },
      }).success,
    ).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "start" }).success).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "skip_cue" }).success).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "unknown" }).success).toBe(false);
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

  it("validates the comment source status and comment commands", () => {
    const status = {
      kind: "youtube" as const,
      state: "polling" as const,
      liveChatId: "chat-1",
      pollingIntervalMs: 5000,
      lastPolledAt: NOW,
      lastError: null,
      quota: { requests: 12, units: 60, startedAt: NOW, windowStartedAt: NOW },
      authExpiresAt: NOW,
      needsReauth: false,
    };
    expect(commentSourceStatusSchema.safeParse(status).success).toBe(true);
    expect(
      commentSourceStatusSchema.safeParse({ ...status, state: "unknown" }).success,
    ).toBe(false);
    expect(
      commentSourceStatusSchema.safeParse({ ...status, quota: { requests: -1, units: 0, startedAt: NOW } })
        .success,
    ).toBe(false);

    expect(liveCommandSchema.safeParse({ kind: "pause_comments" }).success).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "resume_comments" }).success).toBe(true);
    expect(
      liveCommandSchema.safeParse({ kind: "pin_comment", commentId: "yt-1", note: "質問として" })
        .success,
    ).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "unpin_comment", commentId: "yt-1" }).success).toBe(
      true,
    );
    expect(liveCommandSchema.safeParse({ kind: "skip_comment", commentId: "yt-1" }).success).toBe(
      true,
    );
    expect(liveCommandSchema.safeParse({ kind: "block_author", author: "spam" }).success).toBe(
      true,
    );
    expect(liveCommandSchema.safeParse({ kind: "block_topic", topic: "政治" }).success).toBe(true);
    expect(
      liveCommandSchema.safeParse({ kind: "set_live_chat", liveChatId: "chat-2" }).success,
    ).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "pin_comment", commentId: "" }).success).toBe(false);

    const entry = {
      comment: {
        id: "yt-1",
        authorName: "みかん",
        text: "こんにちは",
        publishedAt: NOW,
        receivedAt: NOW,
        kind: "normal" as const,
      },
      decision: "accepted" as const,
      reasons: [],
      redactedText: "こんにちは",
      candidate: null,
      pinned: false,
      pinNote: null,
      selected: false,
      state: "received" as const,
      freshnessMs: 1_000,
    };
    expect(liveCommentEntrySchema.safeParse(entry).success).toBe(true);
    expect(liveCommentEntrySchema.safeParse({ ...entry, state: "unknown" }).success).toBe(false);
    expect(
      liveCommentEntrySchema.safeParse({ ...entry, freshnessMs: -1 }).success,
    ).toBe(false);

    const corner = {
      state: "running" as const,
      segmentId: "seg-comments",
      selectedCommentIds: ["yt-1"],
      currentCommentId: "yt-1",
      deferredPinIds: [],
      remainingSlots: 3,
    };
    expect(commentCornerSchema.safeParse(corner).success).toBe(true);
    expect(commentCornerSchema.safeParse({ ...corner, remainingSlots: -1 }).success).toBe(false);
  });

  it("keeps older runtime configs valid and defaults the new comment settings", () => {
    const base = {
      llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
      tts: { adapters: {} },
      port: 3010,
      dataDir: "/tmp/kakeai-live",
    };
    const parsed = liveRuntimeConfigSchema.parse(base);
    expect(parsed.llm.timeoutMs).toBe(15_000);
    expect(parsed.comments).toEqual({
      ngWords: [],
      maxLength: 300,
      maxPerAuthorPerMinute: 3,
      analysisBatchSize: 20,
      analysisTimeoutMs: 15_000,
      cornerHoldMs: 4_000,
    });
    expect(parsed.youtube).toBeUndefined();

    const explicit = liveRuntimeConfigSchema.parse({
      ...base,
      llm: { ...base.llm, timeoutMs: 5_000 },
      youtube: {
        clientId: "client-1",
        clientSecret: "secret-1",
        videoUrl: "https://youtu.be/abcdefghijk",
        pollingIntervalMs: 9_000,
      },
      comments: { ngWords: ["NG"], maxLength: 120, analysisBatchSize: 5 },
    });
    expect(explicit.llm.timeoutMs).toBe(5_000);
    expect(explicit.comments.maxLength).toBe(120);
    expect(explicit.comments.maxPerAuthorPerMinute).toBe(3);
    expect(explicit.youtube?.pollingIntervalMs).toBe(9_000);
  });
});
