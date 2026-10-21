import { describe, expect, it } from "vitest";
import {
  agentCharacterGetInputSchema,
  agentCharacterGetOutputSchema,
  agentCharacterListInputSchema,
  agentCharacterListOutputSchema,
  agentOperationContracts,
  agentOperationInputSchemas,
  agentOperationNames,
  agentOperationOutputSchemas,
  agentPreviewFrameInputSchema,
  agentPreviewFrameOutputSchema,
  agentSchemaDigestInputOf,
  agentTtsCreateBulkInputSchema,
  agentTtsCreateBulkOutputSchema,
  agentTtsCreateInputSchema,
  agentTtsCreateOutputSchema,
  agentWorkUpdateInputSchema,
  agentWorkUpdateOutputSchema,
  buildAgentSchemaGetResult,
  computeAgentSchemaDigest,
  isAgentLongRunningOperation,
  isAgentMutationOperation,
} from "./agent";

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
