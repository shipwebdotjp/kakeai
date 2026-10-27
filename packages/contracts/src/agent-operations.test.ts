import { describe, expect, it } from "vitest";
import {
  AGENT_DIAGNOSE_READ_TIMEOUT_MS,
  AGENT_PREVIEW_READ_TIMEOUT_MS,
  AGENT_READ_TIMEOUT_MS,
  agentCharacterCreateInputSchema,
  agentCharacterCreateOutputSchema,
  agentCharacterGetInputSchema,
  agentCharacterGetOutputSchema,
  agentCharacterListInputSchema,
  agentCharacterListOutputSchema,
  agentCharacterUpdateInputSchema,
  agentCharacterUpdateOutputSchema,
  agentFaceSetGetInputSchema,
  agentFaceSetGetOutputSchema,
  agentFaceSetListInputSchema,
  agentFaceSetListOutputSchema,
  agentFontListInputSchema,
  agentFontListOutputSchema,
  agentThemeCreateInputSchema,
  agentThemeDiagnoseInputSchema,
  agentThemeDiagnoseOutputSchema,
  agentThemeDraftGetInputSchema,
  agentThemeDraftSaveInputSchema,
  agentThemeGetInputSchema,
  agentThemeGetOutputSchema,
  agentThemeListInputSchema,
  agentThemeListOutputSchema,
  agentThemePublishInputSchema,
  agentVoiceProfileGetInputSchema,
  agentVoiceProfileGetOutputSchema,
  agentVoiceProfileListInputSchema,
  agentVoiceProfileListOutputSchema,
  agentOperationContracts,
  agentOperationInputSchemas,
  agentOperationNames,
  agentOperationOutputSchemas,
  agentOperationReadTimeoutMs,
  agentPreviewAssetFrameInputSchema,
  agentPreviewAssetFrameOutputSchema,
  agentPreviewFrameInputSchema,
  agentPreviewFrameOutputSchema,
  agentPreviewScriptFrameInputSchema,
  agentPreviewScriptFrameOutputSchema,
  agentPreviewThemeInputSchema,
  agentPreviewThemeOutputSchema,
  agentSchemaDigestInputOf,
  agentScriptListVersionsInputSchema,
  agentScriptListVersionsOutputSchema,
  agentScriptRestoreInputSchema,
  agentScriptRestoreOutputSchema,
  agentArtifactGetInputSchema,
  agentArtifactGetOutputSchema,
  agentScriptSaveInputSchema,
  agentScriptSubtitlesInputSchema,
  agentScriptSubtitlesOutputSchema,
  agentScriptValidateInputSchema,
  agentTemplateInputContracts,
  agentThumbnailTemplateContracts,
  agentTtsAttachBulkInputSchema,
  agentTtsAttachBulkOutputSchema,
  agentTtsCreateBulkInputSchema,
  agentTtsCreateBulkOutputSchema,
  agentTtsCreateInputSchema,
  agentTtsCreateOutputSchema,
  agentWorkCloneInputSchema,
  agentWorkCloneOutputSchema,
  agentWorkUpdateInputSchema,
  agentWorkUpdateOutputSchema,
  buildAgentSchemaGetResult,
  computeAgentSchemaDigest,
  isAgentLongRunningOperation,
  isAgentMutationOperation,
  resolveAgentReadTimeoutMs,
} from "./agent";
import { fixtureScriptVersion, fixtureWork } from "./testing/agent-fixtures";
import { validContentDocument } from "./testing/fixtures";
import { visualThemeDefinitions } from "./content/theme";

const job = {
  id: "job-1",
  kind: "tts" as const,
  status: "queued" as const,
  workId: "work-1",
  assetId: null,
  languageEditionId: "led-1",
  scriptVersionId: "scr-1",
  progressPercent: 0,
  createdAt: "2026-10-21T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  error: null,
  ttsResult: null,
  artifacts: [],
};

const libraryEntry = {
  id: "char-1",
  name: "四国めたん",
  names: [],
  voices: [{ locale: "ja-JP", voiceProfileId: "vp-1" }],
  appearances: [
    {
      id: "appearance-1",
      assetId: "asset-1",
      expression: "smile",
      pose: "front",
      label: "夏服",
      faceSetId: null,
    },
  ],
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
};

describe("tts.create operation contract", () => {
  it("defaults speedScale and rejects unknown fields", () => {
    const input = {
      scriptVersionId: "scr-1",
      narrationSegmentId: "line-1",
    };
    expect(agentTtsCreateInputSchema.parse(input)).toEqual({
      ...input,
      speedScale: 1,
    });
    expect(
      agentTtsCreateInputSchema.safeParse({
        ...input,
        voiceId: "voice-1",
        speechText: "こんにちは",
        speedScale: 1.5,
      }).success,
    ).toBe(true);
    expect(agentTtsCreateInputSchema.safeParse({ ...input, extra: true }).success).toBe(
      false,
    );
    expect(
      agentTtsCreateInputSchema.safeParse({ ...input, speedScale: 3 }).success,
    ).toBe(false);
    expect(agentTtsCreateInputSchema.safeParse({ scriptVersionId: "scr-1" }).success).toBe(
      false,
    );
    expect(agentTtsCreateOutputSchema.safeParse({ job }).success).toBe(true);
    expect(agentTtsCreateOutputSchema.safeParse({ job: undefined }).success).toBe(false);
  });

  it("shares the bulk result contract for tts.createBulk", () => {
    expect(agentTtsCreateBulkInputSchema.parse({ scriptVersionId: "scr-1" })).toEqual({
      scriptVersionId: "scr-1",
    });
    const output = {
      jobs: [{ narrationSegmentId: "line-1", job }],
      excluded: [
        {
          narrationSegmentId: "line-2",
          code: "TTS_INPUT_INVALID",
          message: "声が未設定です。",
        },
      ],
    };
    expect(agentTtsCreateBulkOutputSchema.safeParse(output).success).toBe(true);
    expect(
      agentTtsCreateBulkOutputSchema.safeParse({ ...output, jobs: "none" }).success,
    ).toBe(false);
  });

  it("registers tts.create and tts.createBulk as long-running mutations", () => {
    const schema = buildAgentSchemaGetResult();
    for (const name of ["tts.create", "tts.createBulk"] as const) {
      expect(agentOperationNames).toContain(name);
      expect(isAgentMutationOperation(name)).toBe(true);
      expect(isAgentLongRunningOperation(name)).toBe(true);
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "mutation",
        longRunning: true,
      });
    }
    expect(Object.keys(agentOperationInputSchemas)).toContain("tts.create");
    expect(Object.keys(agentOperationInputSchemas)).toContain("tts.createBulk");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("tts.create");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("tts.createBulk");

    const digestInput = agentSchemaDigestInputOf({
      ...schema,
      templateInputContracts: agentTemplateInputContracts(),
      thumbnailTemplateContracts: agentThumbnailTemplateContracts(),
      operationContracts: agentOperationContracts(),
    });
    expect(computeAgentSchemaDigest(digestInput)).toBe(schema.schemaDigest);
    expect(
      computeAgentSchemaDigest({
        ...digestInput,
        agentOperations: digestInput.agentOperations.map((entry) =>
          entry.name === "tts.create" ? { ...entry, longRunning: false } : entry,
        ),
      }),
    ).not.toBe(schema.schemaDigest);
  });

  it("registers tts.attachBulk as a short mutation without job waiting", () => {
    expect(
      agentTtsAttachBulkInputSchema.parse({
        scriptVersionId: "scr-1",
        bulkRequestId: "bulk-1",
        requestId: "attach-1",
      }),
    ).toEqual({
      scriptVersionId: "scr-1",
      bulkRequestId: "bulk-1",
      requestId: "attach-1",
    });
    expect(agentTtsAttachBulkInputSchema.safeParse({ scriptVersionId: "scr-1" }).success).toBe(
      false,
    );
    expect(
      agentTtsAttachBulkInputSchema.safeParse({
        scriptVersionId: "scr-1",
        bulkRequestId: "bulk-1",
        requestId: "attach-1",
        extra: true,
      }).success,
    ).toBe(false);
    const output = {
      status: "finalized" as const,
      counts: { queued: 0, running: 0, succeeded: 1, failed: 1, cancelled: 0 },
      excluded: [],
      failures: [
        {
          narrationSegmentId: "line-2",
          jobId: "job-2",
          status: "failed" as const,
          code: "TTS_SYNTHESIS_FAILED",
          message: "音声生成に失敗しました。",
        },
      ],
      scriptVersion: null,
    };
    expect(agentTtsAttachBulkOutputSchema.safeParse(output).success).toBe(true);
    expect(agentTtsAttachBulkOutputSchema.safeParse({ ...output, status: "done" }).success).toBe(
      false,
    );

    expect(agentOperationNames).toContain("tts.attachBulk");
    expect(isAgentMutationOperation("tts.attachBulk")).toBe(true);
    expect(isAgentLongRunningOperation("tts.attachBulk")).toBe(false);
    expect(buildAgentSchemaGetResult().agentOperations).toContainEqual({
      name: "tts.attachBulk",
      kind: "mutation",
      longRunning: false,
    });
    expect(Object.keys(agentOperationInputSchemas)).toContain("tts.attachBulk");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("tts.attachBulk");
  });
});

describe("work.update operation contract", () => {
  const work = {
    id: "work-1",
    title: "作品",
    originalLocale: "ja-JP" as const,
    updatedAt: "2026-10-21T00:00:00.000Z",
    createdAt: "2026-10-21T00:00:00.000Z",
    parentWorkId: null,
    languageEditions: [],
  };

  it("takes a work id and a non-empty title", () => {
    expect(
      agentWorkUpdateInputSchema.parse({ workId: "work-1", title: "  改名  " }),
    ).toEqual({ workId: "work-1", title: "改名" });
    expect(agentWorkUpdateInputSchema.safeParse({ workId: "work-1" }).success).toBe(false);
    expect(
      agentWorkUpdateInputSchema.safeParse({ workId: "work-1", title: "   " }).success,
    ).toBe(false);
    expect(
      agentWorkUpdateInputSchema.safeParse({ workId: "work-1", title: "改名", extra: true })
        .success,
    ).toBe(false);
    expect(agentWorkUpdateOutputSchema.safeParse({ work }).success).toBe(true);
    expect(
      agentWorkUpdateOutputSchema.safeParse({ work: { ...work, title: undefined } }).success,
    ).toBe(false);
  });

  it("registers work.update as a non-long-running mutation", () => {
    const schema = buildAgentSchemaGetResult();
    expect(agentOperationNames).toContain("work.update");
    expect(isAgentMutationOperation("work.update")).toBe(true);
    expect(isAgentLongRunningOperation("work.update")).toBe(false);
    expect(schema.agentOperations).toContainEqual({
      name: "work.update",
      kind: "mutation",
      longRunning: false,
    });
    expect(Object.keys(agentOperationInputSchemas)).toContain("work.update");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("work.update");
  });
});

describe("preview.frame operation contract", () => {
  const frame = {
    artifactId: "art-1",
    requestedTimeMs: 1500,
    resolvedTimeMs: 1466,
    width: 1920,
    height: 1080,
    mimeType: "image/png" as const,
    pngBase64: "aVBORw0KGgo=",
  };

  it("takes an artifact id and a non-negative time", () => {
    expect(
      agentPreviewFrameInputSchema.parse({ artifactId: "art-1", timeMs: 0 }),
    ).toEqual({ artifactId: "art-1", timeMs: 0 });
    expect(
      agentPreviewFrameInputSchema.safeParse({ artifactId: "art-1", timeMs: -1 }).success,
    ).toBe(false);
    expect(agentPreviewFrameInputSchema.safeParse({ timeMs: 0 }).success).toBe(false);
    expect(
      agentPreviewFrameInputSchema.safeParse({ artifactId: "art-1", timeMs: 0, extra: true })
        .success,
    ).toBe(false);
    expect(agentPreviewFrameOutputSchema.safeParse(frame).success).toBe(true);
    expect(
      agentPreviewFrameOutputSchema.safeParse({ ...frame, mimeType: "image/jpeg" }).success,
    ).toBe(false);
    expect(
      agentPreviewFrameOutputSchema.safeParse({ ...frame, pngBase64: "" }).success,
    ).toBe(false);
  });

  it("registers preview.frame as a sync read", () => {
    const schema = buildAgentSchemaGetResult();
    expect(agentOperationNames).toContain("preview.frame");
    expect(isAgentMutationOperation("preview.frame")).toBe(false);
    expect(isAgentLongRunningOperation("preview.frame")).toBe(false);
    expect(schema.agentOperations).toContainEqual({
      name: "preview.frame",
      kind: "read",
      longRunning: false,
    });
    expect(Object.keys(agentOperationInputSchemas)).toContain("preview.frame");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("preview.frame");
  });
});

describe("preview read timeouts", () => {
  it("extends the read timeout for image previews and slow library reads", () => {
    expect(agentOperationReadTimeoutMs("preview.frame")).toBe(
      AGENT_PREVIEW_READ_TIMEOUT_MS,
    );
    expect(agentOperationReadTimeoutMs("preview.scriptFrame")).toBe(
      AGENT_PREVIEW_READ_TIMEOUT_MS,
    );
    expect(agentOperationReadTimeoutMs("preview.assetFrame")).toBe(
      AGENT_PREVIEW_READ_TIMEOUT_MS,
    );
    expect(agentOperationReadTimeoutMs("font.list")).toBe(
      AGENT_PREVIEW_READ_TIMEOUT_MS,
    );
    expect(agentOperationReadTimeoutMs("theme.diagnose")).toBe(
      AGENT_DIAGNOSE_READ_TIMEOUT_MS,
    );
    expect(agentOperationReadTimeoutMs("schema.get")).toBeUndefined();
    expect(agentOperationReadTimeoutMs("script.get")).toBeUndefined();
    expect(resolveAgentReadTimeoutMs("schema.get", undefined)).toBe(AGENT_READ_TIMEOUT_MS);
    expect(resolveAgentReadTimeoutMs("preview.scriptFrame", undefined)).toBe(
      AGENT_PREVIEW_READ_TIMEOUT_MS,
    );
    expect(resolveAgentReadTimeoutMs("preview.scriptFrame", 5_000)).toBe(5_000);
    expect(resolveAgentReadTimeoutMs("theme.diagnose", undefined)).toBe(
      AGENT_DIAGNOSE_READ_TIMEOUT_MS,
    );
  });
});

describe("preview.scriptFrame operation contract", () => {
  const frame = {
    scriptVersionId: "scr-1",
    requestedTimeMs: 1500,
    durationMs: 9000,
    width: 1920,
    height: 1080,
    mimeType: "image/png" as const,
    imageBase64: "aVBORw0KGgo=",
  };

  it("takes a script version and a non-negative time", () => {
    expect(
      agentPreviewScriptFrameInputSchema.parse({ scriptVersionId: "scr-1", timeMs: 0 }),
    ).toEqual({ scriptVersionId: "scr-1", timeMs: 0 });
    expect(
      agentPreviewScriptFrameInputSchema.safeParse({ scriptVersionId: "scr-1", timeMs: -1 })
        .success,
    ).toBe(false);
    expect(agentPreviewScriptFrameInputSchema.safeParse({ timeMs: 0 }).success).toBe(false);
    expect(
      agentPreviewScriptFrameInputSchema.safeParse({
        scriptVersionId: "scr-1",
        timeMs: 0,
        extra: true,
      }).success,
    ).toBe(false);
    expect(agentPreviewScriptFrameOutputSchema.safeParse(frame).success).toBe(true);
    expect(
      agentPreviewScriptFrameOutputSchema.safeParse({ ...frame, imageBase64: "" }).success,
    ).toBe(false);
  });

  it("registers preview.scriptFrame as a sync read", () => {
    const schema = buildAgentSchemaGetResult();
    expect(agentOperationNames).toContain("preview.scriptFrame");
    expect(isAgentMutationOperation("preview.scriptFrame")).toBe(false);
    expect(isAgentLongRunningOperation("preview.scriptFrame")).toBe(false);
    expect(schema.agentOperations).toContainEqual({
      name: "preview.scriptFrame",
      kind: "read",
      longRunning: false,
    });
    expect(Object.keys(agentOperationInputSchemas)).toContain("preview.scriptFrame");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("preview.scriptFrame");
  });
});

describe("preview.assetFrame operation contract", () => {
  const image = {
    assetId: "ast-1",
    kind: "image" as const,
    requestedTimeMs: null,
    resolvedTimeMs: null,
    width: 800,
    height: 600,
    mimeType: "image/jpeg" as const,
    imageBase64: "/9j/4AAQSkZJRg==",
  };
  const video = {
    assetId: "ast-2",
    kind: "video" as const,
    requestedTimeMs: 500,
    resolvedTimeMs: 466,
    width: 1920,
    height: 1080,
    mimeType: "image/png" as const,
    imageBase64: "aVBORw0KGgo=",
  };

  it("takes an asset id and an optional time", () => {
    expect(agentPreviewAssetFrameInputSchema.parse({ assetId: "ast-1" })).toEqual({
      assetId: "ast-1",
    });
    expect(
      agentPreviewAssetFrameInputSchema.parse({ assetId: "ast-2", timeMs: 0 }),
    ).toEqual({ assetId: "ast-2", timeMs: 0 });
    expect(
      agentPreviewAssetFrameInputSchema.safeParse({ assetId: "ast-1", timeMs: -1 }).success,
    ).toBe(false);
    expect(agentPreviewAssetFrameInputSchema.safeParse({ timeMs: 0 }).success).toBe(false);
    expect(agentPreviewAssetFrameOutputSchema.safeParse(image).success).toBe(true);
    expect(agentPreviewAssetFrameOutputSchema.safeParse(video).success).toBe(true);
    expect(
      agentPreviewAssetFrameOutputSchema.safeParse({ ...image, kind: "audio" }).success,
    ).toBe(false);
  });

  it("registers preview.assetFrame as a sync read", () => {
    const schema = buildAgentSchemaGetResult();
    expect(agentOperationNames).toContain("preview.assetFrame");
    expect(isAgentMutationOperation("preview.assetFrame")).toBe(false);
    expect(isAgentLongRunningOperation("preview.assetFrame")).toBe(false);
    expect(schema.agentOperations).toContainEqual({
      name: "preview.assetFrame",
      kind: "read",
      longRunning: false,
    });
    expect(Object.keys(agentOperationInputSchemas)).toContain("preview.assetFrame");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("preview.assetFrame");
  });
});

describe("work.clone operation contract", () => {
  it("takes a work id and a non-empty title", () => {
    expect(
      agentWorkCloneInputSchema.parse({ workId: "work-1", title: "  複製  " }),
    ).toEqual({ workId: "work-1", title: "複製" });
    expect(agentWorkCloneInputSchema.safeParse({ workId: "work-1" }).success).toBe(false);
    expect(
      agentWorkCloneInputSchema.safeParse({ workId: "work-1", title: "  " }).success,
    ).toBe(false);
    expect(
      agentWorkCloneInputSchema.safeParse({
        workId: "work-1",
        title: "複製",
        extra: true,
      }).success,
    ).toBe(false);
    expect(agentWorkCloneOutputSchema.safeParse({ work: fixtureWork() }).success).toBe(true);
  });

  it("registers work.clone as a non-long-running mutation", () => {
    const schema = buildAgentSchemaGetResult();
    expect(agentOperationNames).toContain("work.clone");
    expect(isAgentMutationOperation("work.clone")).toBe(true);
    expect(isAgentLongRunningOperation("work.clone")).toBe(false);
    expect(schema.agentOperations).toContainEqual({
      name: "work.clone",
      kind: "mutation",
      longRunning: false,
    });
    expect(Object.keys(agentOperationInputSchemas)).toContain("work.clone");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("work.clone");
  });
});

describe("script.listVersions operation contract", () => {
  const { content: _content, ...summary } = fixtureScriptVersion();

  it("takes a language edition and returns the history with the current id", () => {
    expect(
      agentScriptListVersionsInputSchema.parse({ languageEditionId: "led-1" }),
    ).toEqual({ languageEditionId: "led-1" });
    expect(agentScriptListVersionsInputSchema.safeParse({}).success).toBe(false);
    expect(
      agentScriptListVersionsInputSchema.safeParse({
        languageEditionId: "led-1",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      agentScriptListVersionsOutputSchema.safeParse({
        languageEditionId: "led-1",
        currentScriptVersionId: summary.id,
        scriptVersions: [summary],
      }).success,
    ).toBe(true);
    expect(
      agentScriptListVersionsOutputSchema.safeParse({
        languageEditionId: "led-1",
        currentScriptVersionId: summary.id,
        scriptVersions: [{ ...summary, sourceScriptVersionId: undefined }],
      }).success,
    ).toBe(false);
  });

  it("registers script.listVersions as a read", () => {
    const schema = buildAgentSchemaGetResult();
    expect(agentOperationNames).toContain("script.listVersions");
    expect(isAgentMutationOperation("script.listVersions")).toBe(false);
    expect(isAgentLongRunningOperation("script.listVersions")).toBe(false);
    expect(schema.agentOperations).toContainEqual({
      name: "script.listVersions",
      kind: "read",
      longRunning: false,
    });
    expect(Object.keys(agentOperationInputSchemas)).toContain("script.listVersions");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("script.listVersions");
  });
});

describe("script.save and script.validate with character locale names", () => {
  it("accepts content carrying characters[].names", () => {
    const content = validContentDocument();
    content.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [
          { locale: "ja-JP", name: "リン" },
          { locale: "en-US", name: "Rin" },
        ],
        voices: [],
        appearances: [],
        libraryCharacterId: null,
      },
    ];
    expect(
      agentScriptValidateInputSchema.safeParse({ content }).success,
    ).toBe(true);
    expect(
      agentScriptSaveInputSchema.safeParse({
        languageEditionId: "led-1",
        sourceScriptVersionId: null,
        content,
      }).success,
    ).toBe(true);
  });
});

describe("script.restore operation contract", () => {
  it("requires a source version and a request id", () => {
    const input = { scriptVersionId: "scr-1", requestId: "restore-1" };
    expect(agentScriptRestoreInputSchema.parse(input)).toEqual(input);
    expect(
      agentScriptRestoreInputSchema.safeParse({
        ...input,
        baseScriptVersionId: "scr-2",
        authorAgentId: "agent-1",
      }).success,
    ).toBe(true);
    expect(
      agentScriptRestoreInputSchema.safeParse({ scriptVersionId: "scr-1" }).success,
    ).toBe(false);
    expect(
      agentScriptRestoreInputSchema.safeParse({ requestId: "restore-1" }).success,
    ).toBe(false);
    expect(
      agentScriptRestoreInputSchema.safeParse({ ...input, extra: true }).success,
    ).toBe(false);
    expect(
      agentScriptRestoreOutputSchema.safeParse({
        scriptVersion: fixtureScriptVersion("scr-2", 2),
        warnings: [],
        replay: false,
      }).success,
    ).toBe(true);
  });

  it("registers script.restore as a non-long-running mutation", () => {
    const schema = buildAgentSchemaGetResult();
    expect(agentOperationNames).toContain("script.restore");
    expect(isAgentMutationOperation("script.restore")).toBe(true);
    expect(isAgentLongRunningOperation("script.restore")).toBe(false);
    expect(schema.agentOperations).toContainEqual({
      name: "script.restore",
      kind: "mutation",
      longRunning: false,
    });
    expect(Object.keys(agentOperationInputSchemas)).toContain("script.restore");
    expect(Object.keys(agentOperationOutputSchemas)).toContain("script.restore");
  });
});

describe("character read operation contracts", () => {
  it("lists and fetches library entries", () => {
    expect(agentCharacterListInputSchema.safeParse({}).success).toBe(true);
    expect(agentCharacterListInputSchema.safeParse({ extra: true }).success).toBe(false);
    expect(agentCharacterListOutputSchema.safeParse({ characters: [] }).success).toBe(true);
    expect(
      agentCharacterListOutputSchema.safeParse({ characters: [libraryEntry] }).success,
    ).toBe(true);
    expect(agentCharacterGetInputSchema.safeParse({ characterId: "char-1" }).success).toBe(
      true,
    );
    expect(agentCharacterGetInputSchema.safeParse({}).success).toBe(false);
    expect(
      agentCharacterGetOutputSchema.safeParse({ character: libraryEntry }).success,
    ).toBe(true);
  });

  it("registers both reads in the catalog and the schema digest", () => {
    const schema = buildAgentSchemaGetResult();
    for (const name of ["character.list", "character.get"] as const) {
      expect(agentOperationNames).toContain(name);
      expect(isAgentMutationOperation(name)).toBe(false);
      expect(isAgentLongRunningOperation(name)).toBe(false);
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
      expect(Object.keys(agentOperationInputSchemas)).toContain(name);
      expect(Object.keys(agentOperationOutputSchemas)).toContain(name);
    }

    const digestInput = agentSchemaDigestInputOf({
      ...schema,
      templateInputContracts: agentTemplateInputContracts(),
      thumbnailTemplateContracts: agentThumbnailTemplateContracts(),
      operationContracts: agentOperationContracts(),
    });
    expect(computeAgentSchemaDigest(digestInput)).toBe(schema.schemaDigest);
    expect(
      computeAgentSchemaDigest({
        ...digestInput,
        agentOperations: digestInput.agentOperations.filter(
          (entry) => entry.name !== "character.list",
        ),
      }),
    ).not.toBe(schema.schemaDigest);
  });
});

describe("character write operation contracts", () => {
  it("defaults omitted lists and leaves appearance ids to the server", () => {
    expect(agentCharacterCreateInputSchema.parse({ name: "リン" })).toEqual({
      name: "リン",
      names: [],
      voices: [],
      appearances: [],
    });
    expect(
      agentCharacterCreateInputSchema.safeParse({
        name: "リン",
        names: [{ locale: "ja-JP", name: "リン" }],
        voices: [{ locale: "ja-JP", voiceProfileId: "vp-1" }],
        appearances: [
          { assetId: "asset-1", expression: "smile", pose: "front", faceSetId: "fs-1" },
        ],
      }).success,
    ).toBe(true);
    expect(agentCharacterCreateInputSchema.safeParse({ name: "  " }).success).toBe(false);
    // The library appearance id is an internal key, so callers cannot set it.
    expect(
      agentCharacterCreateInputSchema.safeParse({
        name: "リン",
        appearances: [
          { id: "appearance-1", assetId: "asset-1", expression: "smile", pose: "front" },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts a partial update and rejects unknown fields", () => {
    expect(agentCharacterUpdateInputSchema.parse({ characterId: "char-1" })).toEqual({
      characterId: "char-1",
    });
    expect(
      agentCharacterUpdateInputSchema.safeParse({
        characterId: "char-1",
        name: "リン",
        names: [],
        voices: [],
        appearances: [],
      }).success,
    ).toBe(true);
    expect(
      agentCharacterUpdateInputSchema.safeParse({
        characterId: "char-1",
        appearances: [
          {
            id: "appearance-1",
            assetId: "asset-1",
            expression: "smile",
            pose: "front",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      agentCharacterUpdateInputSchema.safeParse({ characterId: "char-1", extra: true })
        .success,
    ).toBe(false);
    expect(agentCharacterUpdateInputSchema.safeParse({ name: "リン" }).success).toBe(false);
  });

  it("registers both mutations in the catalog and the schema digest", () => {
    const schema = buildAgentSchemaGetResult();
    for (const name of ["character.create", "character.update"] as const) {
      expect(agentOperationNames).toContain(name);
      expect(isAgentMutationOperation(name)).toBe(true);
      expect(isAgentLongRunningOperation(name)).toBe(false);
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "mutation",
        longRunning: false,
      });
      expect(Object.keys(agentOperationInputSchemas)).toContain(name);
      expect(Object.keys(agentOperationOutputSchemas)).toContain(name);
    }
    expect(
      agentCharacterCreateOutputSchema.safeParse({ character: libraryEntry }).success,
    ).toBe(true);
    expect(
      agentCharacterUpdateOutputSchema.safeParse({ character: libraryEntry }).success,
    ).toBe(true);

    const digestInput = agentSchemaDigestInputOf({
      ...schema,
      templateInputContracts: agentTemplateInputContracts(),
      thumbnailTemplateContracts: agentThumbnailTemplateContracts(),
      operationContracts: agentOperationContracts(),
    });
    expect(
      computeAgentSchemaDigest({
        ...digestInput,
        agentOperations: digestInput.agentOperations.filter(
          (entry) => entry.name !== "character.create",
        ),
      }),
    ).not.toBe(schema.schemaDigest);
  });
});

describe("library read operations", () => {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const faceSet = {
    id: "face-set-1",
    name: "基本",
    version: 1,
    layers: [],
    expressions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const voiceProfile = {
    id: "voice-profile-1",
    name: "ナレーター",
    adapterId: "voicevox" as const,
    voiceId: "speaker:style",
    locale: "ja-JP" as const,
    settings: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const themeDefinition = visualThemeDefinitions[0]!;
  const themeSummary = {
    id: themeDefinition.id,
    name: themeDefinition.name ?? themeDefinition.id,
    isBuiltIn: true,
    version: themeDefinition.version,
  };

  it("registers all six reads in the catalog and the schema digest", () => {
    const schema = buildAgentSchemaGetResult();
    for (const name of [
      "theme.list",
      "theme.get",
      "faceSet.list",
      "faceSet.get",
      "voiceProfile.list",
      "voiceProfile.get",
    ] as const) {
      expect(agentOperationNames).toContain(name);
      expect(isAgentMutationOperation(name)).toBe(false);
      expect(isAgentLongRunningOperation(name)).toBe(false);
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
      expect(Object.keys(agentOperationInputSchemas)).toContain(name);
      expect(Object.keys(agentOperationOutputSchemas)).toContain(name);
      expect(agentOperationContracts().map((contract) => contract.name)).toContain(name);
    }

    const digestInput = agentSchemaDigestInputOf({
      ...schema,
      templateInputContracts: agentTemplateInputContracts(),
      thumbnailTemplateContracts: agentThumbnailTemplateContracts(),
      operationContracts: agentOperationContracts(),
    });
    expect(computeAgentSchemaDigest(digestInput)).toBe(schema.schemaDigest);
    expect(
      computeAgentSchemaDigest({
        ...digestInput,
        agentOperations: digestInput.agentOperations.filter(
          (entry) => entry.name !== "theme.list",
        ),
      }),
    ).not.toBe(schema.schemaDigest);
  });

  it("uses strict inputs and the existing library DTOs", () => {
    expect(agentThemeListInputSchema.safeParse({}).success).toBe(true);
    expect(agentThemeListInputSchema.safeParse({ extra: true }).success).toBe(false);
    expect(agentThemeGetInputSchema.safeParse({ themeId: themeDefinition.id }).success).toBe(
      true,
    );
    expect(agentThemeGetInputSchema.safeParse({}).success).toBe(false);
    expect(
      agentThemeListOutputSchema.safeParse({ themes: [themeSummary] }).success,
    ).toBe(true);
    expect(
      agentThemeGetOutputSchema.safeParse({
        theme: { ...themeSummary, definition: themeDefinition },
      }).success,
    ).toBe(true);

    expect(agentFaceSetListInputSchema.safeParse({}).success).toBe(true);
    expect(agentFaceSetGetInputSchema.safeParse({ faceSetId: faceSet.id }).success).toBe(
      true,
    );
    expect(
      agentFaceSetGetInputSchema.safeParse({ faceSetId: faceSet.id, version: 2 }).success,
    ).toBe(true);
    expect(
      agentFaceSetGetInputSchema.safeParse({ faceSetId: faceSet.id, version: 0 }).success,
    ).toBe(false);
    expect(agentFaceSetGetInputSchema.safeParse({}).success).toBe(false);
    expect(agentFaceSetListOutputSchema.safeParse({ faceSets: [faceSet] }).success).toBe(
      true,
    );
    expect(agentFaceSetGetOutputSchema.safeParse({ faceSet }).success).toBe(true);

    expect(agentVoiceProfileListInputSchema.safeParse({}).success).toBe(true);
    expect(
      agentVoiceProfileGetInputSchema.safeParse({
        voiceProfileId: voiceProfile.id,
      }).success,
    ).toBe(true);
    expect(agentVoiceProfileGetInputSchema.safeParse({}).success).toBe(false);
    expect(
      agentVoiceProfileListOutputSchema.safeParse({
        voiceProfiles: [voiceProfile],
      }).success,
    ).toBe(true);
    expect(
      agentVoiceProfileGetOutputSchema.safeParse({ voiceProfile }).success,
    ).toBe(true);
  });
});

describe("font.list and theme.diagnose contracts", () => {
  const face = {
    platformId: "HiraginoSans-W3",
    family: "Hiragino Sans",
    displayName: "Hiragino Sans W3",
    postScriptName: "HiraginoSans-W3",
    weight: 300,
    style: "normal" as const,
    stretch: "normal",
    available: true,
  };

  it("pages and filters the font catalog with bounded inputs", () => {
    expect(agentFontListInputSchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(agentFontListInputSchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(agentFontListInputSchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(
      agentFontListInputSchema.safeParse({ minWeight: 700, maxWeight: 400 }).success,
    ).toBe(false);

    const page = {
      fonts: [face],
      total: 1,
      nextOffset: null,
      catalog: {
        supported: true,
        reason: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    expect(agentFontListOutputSchema.parse(page)).toEqual(page);
  });

  it("accepts an explicit Theme revision and defaults diagnosis to ja-JP with verification", () => {
    expect(agentThemeGetInputSchema.parse({ themeId: "theme-1" })).toEqual({
      themeId: "theme-1",
    });
    expect(
      agentThemeGetInputSchema.parse({ themeId: "theme-1", version: 2 }),
    ).toEqual({ themeId: "theme-1", version: 2 });

    expect(agentThemeDiagnoseInputSchema.parse({ themeId: "theme-1" })).toEqual({
      themeId: "theme-1",
      locale: "ja-JP",
      verify: true,
    });
    expect(
      agentThemeDiagnoseInputSchema.safeParse({ themeId: "theme-1", extra: true }).success,
    ).toBe(false);

    const diagnosis = {
      themeId: "theme-1",
      version: 2,
      locale: "ja-JP" as const,
      catalogSupported: true,
      verificationSupported: true,
      verificationReason: null,
      roles: [
        {
          role: "body" as const,
          category: "sans" as const,
          localFaceName: "HiraginoSans-W3",
          localFaceWeight: 300,
          localFaceStyle: "normal" as const,
          usesFallback: false,
        },
      ],
      missingFonts: [],
      diagnostics: ["body: local face HiraginoSans-W3 を使用"],
    };
    expect(agentThemeDiagnoseOutputSchema.parse({ diagnosis })).toEqual({ diagnosis });
    expect(
      agentThemeDiagnoseOutputSchema.safeParse({
        diagnosis: {
          ...diagnosis,
          roles: [
            {
              ...diagnosis.roles[0],
              usesFallback: true,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("registers both reads in the agent catalog", () => {
    const schema = buildAgentSchemaGetResult();
    for (const name of ["font.list", "theme.diagnose"] as const) {
      expect(agentOperationNames).toContain(name);
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
      expect(Object.keys(agentOperationInputSchemas)).toContain(name);
      expect(Object.keys(agentOperationOutputSchemas)).toContain(name);
    }
  });
});

describe("theme lifecycle and preview.theme contracts", () => {
  const definition = visualThemeDefinitions[0]!;

  it("reuses the HTTP create contract and requires a full definition for a draft save", () => {
    expect(agentThemeCreateInputSchema.parse({ name: "新しいテーマ" })).toEqual({
      name: "新しいテーマ",
    });
    expect(
      agentThemeCreateInputSchema.parse({
        name: "複製",
        sourceThemeRef: { id: definition.id, version: definition.version },
      }),
    ).toEqual({
      name: "複製",
      sourceThemeRef: { id: definition.id, version: definition.version },
    });
    expect(agentThemeDraftGetInputSchema.parse({ themeId: "theme-1" })).toEqual({
      themeId: "theme-1",
    });
    expect(
      agentThemeDraftSaveInputSchema.parse({ themeId: "theme-1", definition }).themeId,
    ).toBe("theme-1");
    expect(agentThemePublishInputSchema.parse({ themeId: "theme-1" })).toEqual({
      themeId: "theme-1",
    });
  });

  it("defaults the representative preview to the body scene", () => {
    expect(agentPreviewThemeInputSchema.parse({ definition })).toMatchObject({
      locale: "ja-JP",
      timeMs: 4500,
    });
    expect(
      agentPreviewThemeInputSchema.parse({
        definition,
        locale: "en-US",
        timeMs: 1000,
      }),
    ).toMatchObject({ locale: "en-US", timeMs: 1000 });

    const frame = {
      themeId: definition.id,
      version: definition.version,
      locale: "ja-JP" as const,
      requestedTimeMs: 4500,
      durationMs: 20000,
      width: 1,
      height: 1,
      mimeType: "image/png" as const,
      imageBase64: "aVBORw0KGgo=",
    };
    expect(agentPreviewThemeOutputSchema.parse(frame)).toEqual(frame);
  });

  it("registers the theme writes, draft read and image preview", () => {
    const schema = buildAgentSchemaGetResult();
    for (const name of ["theme.create", "theme.draft.save", "theme.publish"] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "mutation",
        longRunning: false,
      });
    }
    for (const name of ["theme.draft.get", "preview.theme"] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
    }
    expect(agentOperationReadTimeoutMs("preview.theme")).toBe(
      AGENT_PREVIEW_READ_TIMEOUT_MS,
    );
  });
});

describe("voiceAdapter.list contract", () => {
  it("registers a read with the descriptor-only output", () => {
    expect(agentOperationNames).toContain("voiceAdapter.list");
    expect(buildAgentSchemaGetResult().agentOperations).toContainEqual({
      name: "voiceAdapter.list",
      kind: "read",
      longRunning: false,
    });
    expect(agentOperationInputSchemas["voiceAdapter.list"].safeParse({}).success).toBe(
      true,
    );

    const adapters = {
      adapters: [
        {
          id: "voicevox",
          label: "VOICEVOX",
          defaultLocale: "ja-JP",
          voiceSelection: "list" as const,
          modelSelection: false,
        },
      ],
    };
    expect(agentOperationOutputSchemas["voiceAdapter.list"].parse(adapters)).toEqual(
      adapters,
    );
    expect(
      agentOperationOutputSchemas["voiceAdapter.list"].parse({
        adapters: [
          {
            ...adapters.adapters[0],
            defaultBaseUrl: "http://127.0.0.1:50021",
            envName: "KAKEAI_VOICEVOX_BASE_URL",
          },
        ],
      }),
    ).toEqual(adapters);
  });
});

describe("script.subtitles and artifact.get contracts", () => {
  it("returns SRT as text with its derived size", () => {
    expect(agentScriptSubtitlesInputSchema.parse({ scriptVersionId: "scr-1" })).toEqual({
      scriptVersionId: "scr-1",
    });
    const subtitles = {
      scriptVersionId: "scr-1",
      filename: "subtitles.srt",
      mimeType: "application/x-subrip" as const,
      byteSize: 42,
      srt: "1\n00:00:00,000 --> 00:00:02,000\nこんにちは\n",
    };
    expect(agentScriptSubtitlesOutputSchema.parse(subtitles)).toEqual(subtitles);
  });

  it("returns artifact metadata with an absolute file path", () => {
    const artifact = {
      id: "art-1",
      jobId: "job-1",
      role: "render" as const,
      format: "mp4" as const,
      byteSize: 1024,
      durationMs: 2000,
      widthPx: 1920,
      heightPx: 1080,
      fps: 30,
      videoCodec: "h264",
      audioCodec: "aac",
      createdAt: "2026-01-01T00:00:00.000Z",
      contentUrl: "/api/v1/artifacts/art-1/content",
    };
    expect(agentArtifactGetInputSchema.parse({ artifactId: "art-1" })).toEqual({
      artifactId: "art-1",
    });
    expect(
      agentArtifactGetOutputSchema.parse({
        artifact,
        filePath: "/data/artifacts/render.mp4",
      }),
    ).toEqual({ artifact, filePath: "/data/artifacts/render.mp4" });
  });

  it("registers both reads in the agent catalog", () => {
    const schema = buildAgentSchemaGetResult();
    for (const name of ["script.subtitles", "artifact.get"] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
    }
  });
});
