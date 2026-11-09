import { describe, expect, it } from "vitest";
import {
  commentCornerSchema,
  commentSourceStatusSchema,
  consoleSnapshotSchema,
  directorOutputSchema,
  jobSchema,
  liveAudioUrlSchema,
  liveCommandSchema,
  liveExportRequestSchema,
  liveExportResultSchema,
  liveGenerationStatusSchema,
  livePackageBuildSchema,
  livePackageManifestSchema,
  livePackageRelativePathSchema,
  livePackageShowSchema,
  liveResolutionVoiceSchema,
  liveRunSourceInputSchema,
  liveRuntimeConfigSchema,
  liveServerHelloMessageSchema,
  parseLiveAudioUrl,
  preparedCueSchema,
  runLogEventSchema,
  stageEventSchema,
  stageStateSchema,
} from "..";

const HASH = "a".repeat(64);
const NOW = "2026-11-07T12:00:00.000Z";

function showMeta() {
  return {
    title: "テスト配信",
    locale: "ja-JP" as const,
    targetDurationMs: 600_000,
    stageTemplate: "news-desk",
    theme: "theme.css" as const,
    characters: { left: "char-left", right: null },
  };
}

function packageShow() {
  return livePackageShowSchema.parse({
    schemaVersion: 2,
    show: showMeta(),
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
        origin: "live",
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
      {
        id: "cue-fallback",
        origin: "live",
        speaker: "left",
        caption: "補足します。",
        speech: "ほそくします。",
        expression: "normal",
        audio: "audio/prepared/cue-0004.wav",
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
    commentPolicy: {},
    safety: {
      blockedTopics: [],
      persona: "親しみやすい解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-fallback",
    },
    playout: {},
  });
}

describe("live contracts", () => {
  it("accepts only the program-version export request", () => {
    expect(
      liveExportRequestSchema.safeParse({
        programVersionId: "program-version-1",
        outDir: "/tmp/kakeai/package",
      }).success,
    ).toBe(true);
    for (const legacy of [
      {
        workId: "work-1",
        scriptVersionId: "script-version-1",
        profile: {},
        outDir: "/tmp/kakeai/package",
      },
      {
        programVersionId: "program-version-1",
        workId: "work-1",
        outDir: "/tmp/kakeai/package",
      },
    ]) {
      expect(liveExportRequestSchema.safeParse(legacy).success).toBe(false);
    }
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

  it("keeps prepared cues live-only and rejects legacy fields", () => {
    const cue = {
      id: "cue-1",
      origin: "live" as const,
      speaker: "left" as const,
      caption: "字幕",
      speech: "こくじ",
      expression: "normal",
      audio: "audio/prepared/cue-0001.wav",
      durationMs: 1000,
    };
    expect(preparedCueSchema.safeParse(cue).success).toBe(true);
    expect(preparedCueSchema.safeParse({ ...cue, origin: "script" }).success).toBe(false);
    expect(preparedCueSchema.safeParse({ ...cue, sourceLineId: "line-1" }).success).toBe(false);
    expect(preparedCueSchema.safeParse({ ...cue, materialId: "material-1" }).success).toBe(false);
  });

  it("validates a v2 manifest and rejects v1 sources", () => {
    const manifest = {
      packageSchemaVersion: 2,
      exporterVersion: "0.1.0",
      packageId: "livepkg-test",
      createdAt: NOW,
      source: {
        programId: "program-1",
        programVersionId: "program-version-1",
        programVersionNumber: 1,
        programDocumentSha256: HASH,
        resolutionSnapshotSha256: HASH,
        theme: { id: "neutral", version: 1 },
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
    for (const legacy of [
      { ...manifest, packageSchemaVersion: 1 },
      {
        ...manifest,
        source: {
          workId: "work-1",
          languageEditionId: "edition-1",
          scriptVersionId: "script-1",
          theme: { id: "neutral", version: 1 },
          profileSha256: HASH,
        },
      },
      { ...manifest, packageSchemaVersion: 3 },
    ]) {
      expect(livePackageManifestSchema.safeParse(legacy).success).toBe(false);
    }
    expect(
      livePackageManifestSchema.safeParse({
        ...manifest,
        files: [{ ...manifest.files[0], path: "../manifest.json" }],
      }).success,
    ).toBe(false);
  });

  it("accepts the v2 show and rejects v1-only fields", () => {
    const show = packageShow();
    expect(show.schemaVersion).toBe(2);
    expect(livePackageShowSchema.safeParse({ ...show, schemaVersion: 1 }).success).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        show: { ...show.show, startAt: null },
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({ ...show, commentSource: { kind: "youtube" } }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({ ...show, test: { fixture: "fixtures/comments.json" } })
        .success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        cues: show.cues.map((cue) =>
          cue.id === "cue-script" ? { ...cue, materialId: "material-1" } : cue,
        ),
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        segments: show.segments.map((segment) =>
          segment.id === "seg-script" ? { ...segment, material: "material-1" } : segment,
        ),
      }).success,
    ).toBe(false);
  });

  it("validates the stage, comment and console contracts", () => {
    const stageState = {
      phase: "pre_show",
      show: { title: "テスト配信", startAt: null },
      segment: null,
      characters: {
        left: { expression: "normal", speaking: false },
        right: null,
      },
      caption: null,
      visual: null,
      comment: null,
      status: "idle",
      playback: null,
      clock: { elapsedMs: 0, remainingMs: 600_000 },
    };
    expect(stageStateSchema.safeParse(stageState).success).toBe(true);
    expect(
      stageStateSchema.safeParse({
        ...stageState,
        visual: { kind: "card", cardId: "card-1", stateId: "state-1", sequence: 2 },
      }).success,
    ).toBe(true);
    expect(
      stageStateSchema.safeParse({
        ...stageState,
        visual: { kind: "material", materialId: "material-1", focus: true, sequence: 3 },
      }).success,
    ).toBe(true);
    expect(
      stageStateSchema.safeParse({
        ...stageState,
        visual: { kind: "card", cardId: "card-1", stateId: "state-1", sequence: -1 },
      }).success,
    ).toBe(false);

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
      stageStateSchema.safeParse({ ...stageState, playback: { ...playback, sequence: undefined } })
        .success,
    ).toBe(false);

    const showMetaValue = {
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
        showMeta: showMetaValue,
      }).success,
    ).toBe(true);
    expect(
      consoleSnapshotSchema.safeParse({
        runId: "run-1",
        show: showMetaValue,
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
    expect(commentCornerSchema.safeParse({
      state: "idle",
      segmentId: null,
      selectedCommentIds: [],
      currentCommentId: null,
      deferredPinIds: [],
      remainingSlots: 0,
    }).success).toBe(true);
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
    expect(liveCommandSchema.safeParse({ kind: "unknown" }).success).toBe(false);
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

  it("enforces program-only live_export Job result rules", () => {
    const base = {
      id: "job-1",
      kind: "live_export" as const,
      status: "succeeded" as const,
      workId: null,
      assetId: null,
      languageEditionId: null,
      scriptVersionId: null,
      programId: "program-1",
      programVersionId: "program-version-1",
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
    expect(
      jobSchema.safeParse({
        ...base,
        workId: "work-1",
        languageEditionId: "edition-1",
        scriptVersionId: "script-1",
      }).success,
    ).toBe(false);
    expect(
      jobSchema.safeParse({
        ...base,
        programVersionId: undefined,
      }).success,
    ).toBe(false);
    expect(
      jobSchema.safeParse({
        ...base,
        programId: null,
        programVersionId: null,
      }).success,
    ).toBe(false);
  });

  it("validates the comment source status", () => {
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
  });

  it("validates the live runtime config", () => {
    const config = {
      llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test" },
      tts: { adapters: {} },
      port: 3010,
      dataDir: "/tmp/kakeai-live",
    };
    expect(liveRuntimeConfigSchema.safeParse(config).success).toBe(true);
    expect(
      liveRuntimeConfigSchema.safeParse({
        ...config,
        llm: { ...config.llm, baseUrl: "http://example.com/v1" },
      }).success,
    ).toBe(false);
  });

  it("bounds the resolved voice speed scale", () => {
    const voice = {
      side: "left" as const,
      characterId: "char-1",
      voiceProfileId: "voice-1",
      adapterId: "voicevox" as const,
      voiceId: "voice-1",
      speedScale: 1,
      settings: {},
      referenceAudio: null,
    };
    expect(liveResolutionVoiceSchema.safeParse(voice).success).toBe(true);
    expect(
      liveResolutionVoiceSchema.safeParse({ ...voice, speedScale: 0.49 }).success,
    ).toBe(false);
    expect(
      liveResolutionVoiceSchema.safeParse({ ...voice, speedScale: 2.01 }).success,
    ).toBe(false);
  });

  it("rejects traversal-like absolute paths for Run inputs", () => {
    expect(
      liveRunSourceInputSchema.safeParse({
        kind: "fixture",
        fixturePath: "/tmp/kakeai/fixture.json",
      }).success,
    ).toBe(true);
    for (const path of [
      "/tmp",
      "/tmp//fixture.json",
      "/tmp/./fixture.json",
      "/tmp/../fixture.json",
      "/tmp/%2e%2e/fixture.json",
      "/tmp/%2f/fixture.json",
      "/tmp/%5c/fixture.json",
      "/tmp/\\fixture.json",
      "relative/fixture.json",
    ]) {
      expect(
        liveRunSourceInputSchema.safeParse({ kind: "fixture", fixturePath: path })
          .success,
        path,
      ).toBe(false);
    }
    expect(
      livePackageBuildSchema.safeParse({
        packageId: "pkg-1",
        manifestSha256: HASH,
        packagePath: "/tmp/kakeai/package",
      }).success,
    ).toBe(true);
  });

  it("keeps stage event identities mutually exclusive", () => {
    const base = {
      runId: "run-1",
      sessionId: "session-1",
      cueId: null,
      attempt: 0,
      sequence: 1,
    };
    const card = {
      ...base,
      kind: "card_error" as const,
      cardId: "card-1",
      stateId: "state-1",
    };
    expect(stageEventSchema.safeParse(card).success).toBe(true);
    expect(
      stageEventSchema.safeParse({ ...card, cutInId: "cut-1" }).success,
    ).toBe(false);
    expect(
      stageEventSchema.safeParse({ ...card, segmentId: "seg-1" }).success,
    ).toBe(false);
    // null is the same as omitted for a nullable optional field.
    expect(
      stageEventSchema.safeParse({ ...card, cutInId: null, segmentId: null }).success,
    ).toBe(true);
    expect(
      stageEventSchema.safeParse({ ...card, cardId: undefined }).success,
    ).toBe(false);

    const cutIn = {
      ...base,
      kind: "cut_in_ended" as const,
      cutInId: "cut-1",
      segmentId: "seg-1",
    };
    expect(stageEventSchema.safeParse(cutIn).success).toBe(true);
    expect(
      stageEventSchema.safeParse({ ...cutIn, cardId: "card-1" }).success,
    ).toBe(false);
    expect(
      stageEventSchema.safeParse({ ...cutIn, stateId: "state-1" }).success,
    ).toBe(false);
    expect(
      stageEventSchema.safeParse({ ...cutIn, cardId: null, stateId: null }).success,
    ).toBe(true);
    expect(
      stageEventSchema.safeParse({ ...cutIn, segmentId: undefined }).success,
    ).toBe(false);
    expect(
      stageEventSchema.safeParse({ ...cutIn, kind: "cut_in_error", cutInId: null }).success,
    ).toBe(false);

    for (const kind of [
      "audio_ended",
      "audio_error",
      "stage_ready",
      "stage_heartbeat",
    ] as const) {
      const plain = { ...base, kind };
      expect(stageEventSchema.safeParse(plain).success).toBe(true);
      for (const stray of [
        { cutInId: "cut-1" },
        { segmentId: "seg-1" },
        { cardId: "card-1" },
        { stateId: "state-1" },
      ]) {
        expect(
          stageEventSchema.safeParse({ ...plain, ...stray }).success,
          `${kind} ${Object.keys(stray)[0]}`,
        ).toBe(false);
      }
    }
  });

  it("rejects program references on non-live_export jobs", () => {
    const tts = {
      id: "job-1",
      kind: "tts" as const,
      status: "queued" as const,
      workId: "work-1",
      assetId: null,
      languageEditionId: "edition-1",
      scriptVersionId: "script-1",
      progressPercent: 0,
      createdAt: NOW,
      startedAt: null,
      finishedAt: null,
      error: null,
      ttsResult: null,
      liveExportResult: null,
      artifacts: [],
    };
    expect(jobSchema.safeParse(tts).success).toBe(true);
    expect(
      jobSchema.safeParse({
        ...tts,
        programId: "program-1",
        programVersionId: "program-version-1",
      }).success,
    ).toBe(false);
    expect(
      jobSchema.safeParse({
        ...tts,
        kind: "asset_ingest",
        assetId: "asset-1",
        programId: "program-1",
      }).success,
    ).toBe(false);
  });
});
