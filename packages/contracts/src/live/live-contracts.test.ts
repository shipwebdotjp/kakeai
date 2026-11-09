import { describe, expect, it } from "vitest";
import {
  commentCornerSchema,
  commentSourceStatusSchema,
  consoleSnapshotSchema,
  liveCommentEntrySchema,
  directorOutputSchema,
  jobSchema,
  liveAudioUrlSchema,
  liveCommandSchema,
  liveExportResultSchema,
  liveGenerationStatusSchema,
  livePackageManifestSchema,
  livePackageRelativePathSchema,
  livePackageShowSchema,
  parseLiveAudioUrl,
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

  it("accepts per-cue material overrides and rejects unknown references", () => {
    const base = profile();
    const withCueMaterial = {
      ...base,
      scriptCues: [{ ...base.scriptCues[0]!, materialId: "material-1" }],
    };
    expect(liveShowProfileSchema.safeParse(withCueMaterial).success).toBe(true);
    expect(
      liveShowProfileSchema.safeParse({
        ...withCueMaterial,
        scriptCues: [{ ...withCueMaterial.scriptCues[0]!, materialId: null }],
      }).success,
    ).toBe(true);
    expect(
      liveShowProfileSchema.safeParse({
        ...withCueMaterial,
        scriptCues: [{ ...withCueMaterial.scriptCues[0]!, materialId: "material-missing" }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate cue occurrences in a Show Profile", () => {
    const base = profile();
    expect(
      liveShowProfileSchema.safeParse({
        ...base,
        segments: base.segments.map((segment) =>
          segment.id === "seg-script"
            ? { ...segment, cues: ["cue-script", "cue-script"] }
            : segment,
        ),
      }).success,
    ).toBe(false);
    expect(
      liveShowProfileSchema.safeParse({
        ...base,
        segments: base.segments.map((segment) =>
          segment.id === "seg-script"
            ? { ...segment, cues: ["cue-script", "cue-opening"] }
            : segment,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects paths that escape the package", () => {
    expect(livePackageRelativePathSchema.safeParse("../secret").success).toBe(false);
    expect(livePackageRelativePathSchema.safeParse("/absolute").success).toBe(false);
    expect(livePackageRelativePathSchema.safeParse("media/./ok.png").success).toBe(false);
    expect(livePackageRelativePathSchema.safeParse("media\\ok.png").success).toBe(false);
  });

  it("accepts package and run audio URLs without path escapes", () => {
    expect(parseLiveAudioUrl("audio/prepared/cue-1.wav")).toEqual({
      kind: "package",
      path: "audio/prepared/cue-1.wav",
    });
    expect(parseLiveAudioUrl("run:generated/cue-1-ab12cd.wav")).toEqual({
      kind: "run",
      fileName: "cue-1-ab12cd.wav",
    });
    expect(liveAudioUrlSchema.safeParse("run:generated/response.mp3").success).toBe(true);
    for (const invalid of [
      "run:generated/../secret.wav",
      "run:generated//etc/passwd",
      "run:generated/foo.ogg",
      "run:generated/.hidden.wav",
      "run:generated/foo..wav",
      "run:generated/sub/foo.wav",
      "run:other/foo.wav",
      "../secret.wav",
      "/absolute.wav",
    ]) {
      expect(liveAudioUrlSchema.safeParse(invalid).success).toBe(false);
    }
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
    const programManifest = {
      ...manifest,
      packageSchemaVersion: 2,
      source: {
        programId: "program-1",
        programVersionId: "program-version-1",
        programVersionNumber: 1,
        programDocumentSha256: HASH,
        resolutionSnapshotSha256: HASH,
        theme: { id: "neutral", version: 1 },
      },
    };
    expect(livePackageManifestSchema.safeParse(programManifest).success).toBe(true);
    expect(
      livePackageManifestSchema.safeParse({
        ...manifest,
        packageSchemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      livePackageManifestSchema.safeParse({
        ...manifest,
        source: programManifest.source,
      }).success,
    ).toBe(false);
    expect(
      livePackageManifestSchema.safeParse({ ...manifest, packageSchemaVersion: 3 }).success,
    ).toBe(false);
    expect(
      livePackageManifestSchema.safeParse({
        ...manifest,
        files: [{ ...manifest.files[0], path: "../manifest.json" }],
      }).success,
    ).toBe(false);
  });

  it("validates the resolved show and stage/comment contracts", () => {
    const packageShow = {
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
          materialId: "material-1",
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
      materials: [
        {
          id: "material-1",
          kind: "image",
          file: "materials/card-1.png",
          hasAudio: false,
          focus: true,
          width: 1920,
          height: 1080,
        },
      ],
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
    };
    expect(livePackageShowSchema.safeParse(packageShow).success).toBe(true);
    expect(
      livePackageShowSchema.safeParse({
        ...packageShow,
        cues: packageShow.cues.map((cue) =>
          cue.id === "cue-script" ? { ...cue, materialId: null } : cue,
        ),
      }).success,
    ).toBe(true);
    expect(
      livePackageShowSchema.safeParse({
        ...packageShow,
        cues: packageShow.cues.map((cue) =>
          cue.id === "cue-script" ? { ...cue, materialId: "material-missing" } : cue,
        ),
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...packageShow,
        segments: packageShow.segments.map((segment) =>
          segment.id === "seg-script"
            ? { ...segment, cues: ["cue-script", "cue-opening"] }
            : segment,
        ),
      }).success,
    ).toBe(false);

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
        phase: "script",
        status: "speaking",
        playback: { ...playback, audioUrl: "run:generated/response-ab12cd.wav" },
      }).success,
    ).toBe(true);
    expect(
      stageStateSchema.safeParse({
        ...stageState,
        playback: { ...playback, audioUrl: "run:generated/../escape.wav" },
      }).success,
    ).toBe(false);
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
          authMode: "apiKey",
          fallbackAvailable: false,
          authExpiresAt: null,
          needsReauth: false,
        },
        generation: null,
      }).success,
    ).toBe(true);
    expect(
      liveGenerationStatusSchema.safeParse({
        phase: "preparing",
        commentId: "yt-1",
        cueIds: ["cue-gen-1"],
        error: null,
        updatedAt: NOW,
      }).success,
    ).toBe(true);
    expect(
      liveGenerationStatusSchema.safeParse({
        phase: "unknown",
        commentId: null,
        cueIds: [],
        error: null,
        updatedAt: NOW,
      }).success,
    ).toBe(false);
    expect(liveCommandSchema.safeParse({ kind: "start" }).success).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "skip_cue" }).success).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "unknown" }).success).toBe(false);
    expect(
      liveCommandSchema.safeParse({ kind: "takeover_program", sessionId: "session-1" }).success,
    ).toBe(true);
    expect(
      liveCommandSchema.safeParse({
        kind: "edit_cue",
        cueId: "cue-1",
        caption: "直した字幕",
      }).success,
    ).toBe(true);
    expect(
      liveCommandSchema.safeParse({ kind: "edit_cue", cueId: "cue-1" }).success,
    ).toBe(false);
    expect(
      liveCommandSchema.safeParse({
        kind: "move_cue",
        cueId: "cue-1",
        beforeCueId: null,
      }).success,
    ).toBe(true);
    for (const kind of ["cancel_cue", "regenerate_cue", "delete_cue", "play_correction"] as const) {
      expect(liveCommandSchema.safeParse({ kind, cueId: "cue-1" }).success).toBe(true);
      expect(liveCommandSchema.safeParse({ kind, cueId: "" }).success).toBe(false);
    }

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
      authMode: "oauth" as const,
      fallbackAvailable: true,
      authExpiresAt: NOW,
      needsReauth: false,
    };
    expect(commentSourceStatusSchema.safeParse(status).success).toBe(true);
    expect(
      commentSourceStatusSchema.safeParse({ ...status, state: "unknown" }).success,
    ).toBe(false);
    expect(
      commentSourceStatusSchema.safeParse({ ...status, authMode: "unknown" }).success,
    ).toBe(false);
    expect(
      commentSourceStatusSchema.safeParse({
        ...status,
        authMode: null,
        fallbackAvailable: false,
      }).success,
    ).toBe(true);
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
    expect(parsed.tts.timeoutMs).toBe(20_000);
    expect(parsed.tts.maxConcurrentTts).toBe(2);
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

    const apiKeyOnly = liveRuntimeConfigSchema.parse({
      ...base,
      youtube: { apiKey: "api-key-1", videoUrl: "https://youtu.be/abcdefghijk" },
    });
    expect(apiKeyOnly.youtube).toMatchObject({ apiKey: "api-key-1" });
    expect(apiKeyOnly.youtube?.clientId).toBeUndefined();
    expect(
      liveRuntimeConfigSchema.safeParse({
        ...base,
        youtube: { videoUrl: "https://youtu.be/abcdefghijk" },
      }).success,
    ).toBe(false);
    expect(
      liveRuntimeConfigSchema.safeParse({
        ...base,
        youtube: {
          apiKey: "api-key-1",
          clientId: "client-1",
          videoUrl: "https://youtu.be/abcdefghijk",
        },
      }).success,
    ).toBe(false);
    expect(
      liveRuntimeConfigSchema.safeParse({
        ...base,
        youtube: {
          apiKey: "api-key-1",
          clientId: "client-1",
          clientSecret: "secret-1",
          videoUrl: "https://youtu.be/abcdefghijk",
        },
      }).success,
    ).toBe(true);
  });
});

const CUT_IN_FILE = `media/assets/${"b".repeat(64)}.mp4`;

function cutInProfile() {
  const base = profile();
  return {
    ...base,
    segments: [
      base.segments[0],
      base.segments[1],
      {
        id: "seg-cut",
        kind: "cut_in",
        label: "コメントコーナーへ",
        cutInId: "jingle-1",
      },
      base.segments[2],
    ],
    cutIns: [{ id: "jingle-1", assetId: "asset-video-1" }],
  };
}

const PACKAGE_CUT_IN = {
  id: "jingle-1",
  file: CUT_IN_FILE,
  durationMs: 4200,
  hasAudio: true,
  width: 1920,
  height: 1080,
};

function packageShow(options: { withCutIn: boolean; cutIns?: unknown[] }) {
  const base = profile();
  return {
    schemaVersion: 1,
    show: base.show,
    commentSource: { kind: "youtube" },
    segments: [
      base.segments[0],
      base.segments[1],
      ...(options.withCutIn
        ? [
            {
              id: "seg-cut",
              kind: "cut_in",
              label: "コメントコーナーへ",
              cutInId: "jingle-1",
            },
          ]
        : []),
      base.segments[2],
    ],
    cues: [
      {
        id: "cue-opening",
        origin: "live",
        speaker: "left",
        caption: "始まります。",
        speech: "はじまります。",
        expression: "normal",
        audio: "audio/prepared/cue-opening.wav",
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
        audio: "audio/prepared/cue-script.wav",
        durationMs: 1000,
      },
      {
        id: "cue-closing",
        origin: "live",
        speaker: "left",
        caption: "終わります。",
        speech: "おわります。",
        expression: "normal",
        audio: "audio/prepared/cue-closing.wav",
        durationMs: 1000,
      },
    ],
    materials: [],
    ...(options.cutIns === undefined ? {} : { cutIns: options.cutIns }),
    speakers: [],
    commentPolicy: base.commentPolicy,
    safety: base.safety,
    playout: base.playout,
  };
}

function baseStageState() {
  return {
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
}

function baseConsoleSnapshot() {
  return {
    runId: "run-1",
    show: {
      title: "テスト配信",
      targetDurationMs: 600_000,
      segments: [
        {
          id: "seg-opening",
          label: "オープニング",
          kind: "opening",
          targetDurationMs: 60_000,
        },
      ],
    },
    phase: "pre_show",
    segment: null,
    stages: [],
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
      authMode: "apiKey",
      fallbackAvailable: false,
      authExpiresAt: null,
      needsReauth: false,
    },
    generation: null,
  };
}

describe("live CutIn contracts", () => {
  it("keeps old profiles valid with an empty cutIns default", () => {
    const parsed = liveShowProfileSchema.parse(profile());
    expect(parsed.cutIns).toEqual([]);
  });

  it("accepts a cut_in segment that references a profile CutIn", () => {
    const parsed = liveShowProfileSchema.safeParse(cutInProfile());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.segments.map((segment) => segment.kind)).toContain("cut_in");
      expect(parsed.data.cutIns).toEqual([{ id: "jingle-1", assetId: "asset-video-1" }]);
    }
  });

  it("rejects duplicate profile CutIn ids and missing cutInId references", () => {
    expect(
      liveShowProfileSchema.safeParse({
        ...cutInProfile(),
        cutIns: [
          { id: "jingle-1", assetId: "asset-video-1" },
          { id: "jingle-1", assetId: "asset-video-2" },
        ],
      }).success,
    ).toBe(false);
    expect(
      liveShowProfileSchema.safeParse({
        ...cutInProfile(),
        cutIns: [],
      }).success,
    ).toBe(false);
    expect(
      liveShowProfileSchema.safeParse({
        ...cutInProfile(),
        cutIns: [{ id: "other", assetId: "asset-video-1" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a cut_in segment that carries duration, cues, material or comment policy", () => {
    const base = cutInProfile();
    for (const extra of [
      { targetDurationMs: 4200 },
      { cues: ["cue-opening"] },
      { material: "material-1" },
      { commentPolicy: { maxCommentsPerCorner: 2 } },
    ]) {
      expect(
        liveShowProfileSchema.safeParse({
          ...base,
          segments: [
            base.segments[0],
            base.segments[1],
            {
              id: "seg-cut",
              kind: "cut_in",
              label: "コメントコーナーへ",
              cutInId: "jingle-1",
              ...extra,
            },
            base.segments[2],
          ],
        }).success,
      ).toBe(false);
    }
  });

  it("parses package CutIns and defaults old packages to an empty array", () => {
    const withCutIn = livePackageShowSchema.parse(
      packageShow({ withCutIn: true, cutIns: [PACKAGE_CUT_IN] }),
    );
    expect(withCutIn.cutIns).toHaveLength(1);
    expect(withCutIn.cutIns[0]).toMatchObject({
      id: "jingle-1",
      durationMs: 4200,
      hasAudio: true,
      width: 1920,
      height: 1080,
    });

    const withoutCutIns = livePackageShowSchema.parse(packageShow({ withCutIn: false }));
    expect(withoutCutIns.cutIns).toEqual([]);
  });

  it("rejects duplicate package CutIn ids and missing cutInId references", () => {
    expect(
      livePackageShowSchema.safeParse(
        packageShow({ withCutIn: true, cutIns: [PACKAGE_CUT_IN, PACKAGE_CUT_IN] }),
      ).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse(packageShow({ withCutIn: true, cutIns: [] })).success,
    ).toBe(false);
  });

  it("defaults stage state cutIn to null and accepts a playing CutIn", () => {
    const idle = stageStateSchema.parse(baseStageState());
    expect(idle.cutIn).toBeNull();

    const parsed = stageStateSchema.safeParse({
      ...baseStageState(),
      phase: "cut_in",
      segment: { id: "seg-cut", label: "コメントコーナーへ" },
      cutIn: {
        cutInId: "jingle-1",
        segmentId: "seg-cut",
        label: "コメントコーナーへ",
        file: CUT_IN_FILE,
        durationMs: 4200,
        hasAudio: true,
        attempt: 1,
        sequence: 1,
        startedAt: NOW,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cutIn?.cutInId).toBe("jingle-1");
    }
  });

  it("accepts cut_in_ended stage events with CutIn identity", () => {
    const parsed = stageEventSchema.safeParse({
      kind: "cut_in_ended",
      runId: "run-1",
      sessionId: "session-1",
      cueId: null,
      cutInId: "jingle-1",
      segmentId: "seg-cut",
      attempt: 1,
      sequence: 2,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cutInId).toBe("jingle-1");
      expect(parsed.data.segmentId).toBe("seg-cut");
    }
  });

  it("requires CutIn identity on cut_in_ended and cut_in_error events", () => {
    const base = {
      runId: "run-1",
      sessionId: "session-1",
      cueId: null,
      attempt: 1,
      sequence: 2,
    };
    for (const kind of ["cut_in_ended", "cut_in_error"] as const) {
      expect(stageEventSchema.safeParse({ ...base, kind }).success).toBe(false);
      expect(
        stageEventSchema.safeParse({ ...base, kind, cutInId: "jingle-1" }).success,
      ).toBe(false);
      expect(
        stageEventSchema.safeParse({ ...base, kind, segmentId: "seg-cut" }).success,
      ).toBe(false);
      expect(
        stageEventSchema.safeParse({
          ...base,
          kind,
          cutInId: null,
          segmentId: "seg-cut",
        }).success,
      ).toBe(false);
      expect(
        stageEventSchema.safeParse({
          ...base,
          kind,
          cutInId: "jingle-1",
          segmentId: null,
        }).success,
      ).toBe(false);
      expect(
        stageEventSchema.safeParse({
          ...base,
          kind,
          cutInId: "jingle-1",
          segmentId: "seg-cut",
        }).success,
      ).toBe(true);
    }
  });

  it("accepts an audio stage event with an explicit null segmentId", () => {
    const parsed = stageEventSchema.safeParse({
      kind: "audio_ended",
      runId: "run-1",
      sessionId: "session-1",
      cueId: "cue-1",
      segmentId: null,
      attempt: 1,
      sequence: 2,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.segmentId).toBeNull();
    }
  });

  it("defaults console cutIn to null and accepts a playing CutIn", () => {
    const idle = consoleSnapshotSchema.parse(baseConsoleSnapshot());
    expect(idle.cutIn).toBeNull();

    const parsed = consoleSnapshotSchema.safeParse({
      ...baseConsoleSnapshot(),
      phase: "cut_in",
      segment: { id: "seg-cut", label: "コメントコーナーへ" },
      cutIn: {
        cutInId: "jingle-1",
        segmentId: "seg-cut",
        label: "コメントコーナーへ",
        durationMs: 4200,
        startedAt: NOW,
        attempt: 1,
        sequence: 1,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cutIn?.sequence).toBe(1);
    }
  });

  it("accepts skip_cut_in and CutIn run log events", () => {
    expect(liveCommandSchema.safeParse({ kind: "skip_cut_in" }).success).toBe(true);
    expect(liveCommandSchema.safeParse({ kind: "skip_cut_in", cueId: "cue-1" }).success).toBe(
      false,
    );

    const parsed = runLogEventSchema.safeParse({
      schemaVersion: 1,
      runId: "run-1",
      sequence: 1,
      at: NOW,
      type: "cut_in_started",
      cueId: null,
      cutInId: "jingle-1",
      segmentId: "seg-cut",
      data: {},
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cutInId).toBe("jingle-1");
    }
  });

  it("accepts a cut-in manifest file with video/mp4 and audio", () => {
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
          path: CUT_IN_FILE,
          sha256: HASH,
          byteSize: 10,
          mediaType: "video/mp4",
          kind: "cut-in",
          durationMs: 4200,
          width: 1920,
          height: 1080,
          hasAudio: true,
        },
      ],
      fonts: [],
      voices: [],
    };
    expect(livePackageManifestSchema.safeParse(manifest).success).toBe(true);
  });
});
