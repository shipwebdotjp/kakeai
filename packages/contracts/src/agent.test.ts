import { describe, expect, it } from "vitest";
import {
  AGENT_ERROR_CODES,
  agentCompositionAuthoringContextInputSchema,
  agentCompositionCreateInputSchema,
  agentCompositionDraftSaveInputSchema,
  agentCompositionGetInputSchema,
  agentCompositionPublishInputSchema,
  agentCompositionPublishOutputSchema,
  agentErrorCodeSchema,
  agentMutationOperationNames,
  agentOperationInputSchemas,
  agentOperationNames,
  agentOperationOutputSchemas,
  agentReadOperationNames,
  agentSchemaDigestInputOf,
  agentSchemaGetResultSchema,
  buildAgentSchemaGetResult,
  computeAgentSchemaDigest,
  isAgentLongRunningOperation,
  isAgentMutationOperation,
  isAgentOperationName,
  scriptEditRequestSchema,
  scriptEditResultSchema,
  scriptSaveRequestSchema,
  scriptSaveResultSchema,
  scriptValidateRequestSchema,
  scriptValidateResultSchema,
} from "./agent";
import { validContentDocument } from "./testing/fixtures";

const timeline = {
  totalDurationMs: 4000,
  fps: 30,
  scenes: [
    {
      sceneId: "scene-intro",
      startMs: 0,
      durationMs: 4000,
      lines: [],
      cues: [],
    },
  ],
};

const scriptVersion = {
  id: "scr-003",
  languageEditionId: "led-1",
  versionNumber: 3,
  contentSchemaVersion: 1,
  author: "agent" as const,
  authorAgentId: "agent-1",
  agentRequestId: "edit-1",
  agentRequestHash: "hash-1",
  createdAt: "2026-10-21T00:00:00.000Z",
  content: validContentDocument(),
};

const editOperations = [
  { op: "scene.add" as const, kind: "point" as const, key: "scene-1" },
  {
    op: "line.add" as const,
    sceneId: { key: "scene-1" },
    captionText: "最初の要点です。",
  },
];

describe("agent error codes", () => {
  it("has unique stable codes including the operation core", () => {
    const values = Object.values(AGENT_ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
    expect(AGENT_ERROR_CODES.APP_UNAVAILABLE).toBe("AGENT_APP_UNAVAILABLE");
    expect(AGENT_ERROR_CODES.TARGET_NOT_FOUND).toBe("EDIT_TARGET_NOT_FOUND");
    expect(agentErrorCodeSchema.safeParse("AGENT_PROTOCOL_MISMATCH").success).toBe(true);
    expect(agentErrorCodeSchema.safeParse("NOT_A_CODE").success).toBe(false);
  });
});

describe("schema.get", () => {
  it("lists each script operation once", () => {
    const names = buildAgentSchemaGetResult().operations.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("derives template fields, operations and warnings from the registry", () => {
    const result = buildAgentSchemaGetResult();
    expect(agentSchemaGetResultSchema.safeParse(result).success).toBe(true);
    expect(result.contentSchemaVersion).toBe(1);

    const textBlock = result.templates.find((template) => template.id === "text.block");
    expect(textBlock?.inputFields.map((field) => field.key)).toContain("text");
    expect(textBlock?.layers).toEqual(["overlay"]);

    const standing = result.templates.find((template) => template.id === "character.standing");
    expect(standing?.inputFields).toEqual([]);
    expect(standing?.editable).toBe(false);

    expect(result.operations).toContainEqual({ name: "scene.add", category: "scene" });
    expect(result.operations).toContainEqual({ name: "cue.setInput", category: "cue" });
    expect(result.warningCodes).toContain("text_overflow");
    expect(result.assetKinds).toEqual(["image", "video", "audio"]);
  });

  it("catalogs every agent operation with kind and job behaviour", () => {
    const result = buildAgentSchemaGetResult();
    expect(result.agentOperations.map((entry) => entry.name)).toEqual([...agentOperationNames]);
    expect(result.agentOperations).toContainEqual({
      name: "script.edit",
      kind: "mutation",
      longRunning: false,
    });
    expect(result.agentOperations).toContainEqual({
      name: "job.get",
      kind: "read",
      longRunning: false,
    });
    expect(result.agentOperations).toContainEqual({
      name: "asset.import",
      kind: "mutation",
      longRunning: true,
    });
    expect(result.agentOperations).toContainEqual({
      name: "render.start",
      kind: "mutation",
      longRunning: true,
    });
    for (const entry of result.agentOperations) {
      expect(entry.kind).toBe(isAgentMutationOperation(entry.name) ? "mutation" : "read");
      expect(entry.longRunning).toBe(isAgentLongRunningOperation(entry.name));
    }
  });

  it("pins a deterministic digest that is sensitive to schema changes", () => {
    const result = buildAgentSchemaGetResult();
    expect(result.schemaDigest).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(buildAgentSchemaGetResult().schemaDigest).toBe(result.schemaDigest);
    expect(computeAgentSchemaDigest({ b: [true, null, "x"], a: 1 })).toBe(
      "fnv1a64:dfbb1f98a6d14526",
    );

    const descriptor = agentSchemaDigestInputOf(result);
    expect(computeAgentSchemaDigest(descriptor)).toBe(result.schemaDigest);

    const reordered = {
      assetKinds: descriptor.assetKinds,
      warningCodes: descriptor.warningCodes,
      agentOperations: descriptor.agentOperations,
      operations: descriptor.operations,
      templates: descriptor.templates.map((template) =>
        Object.fromEntries(Object.entries(template).reverse()),
      ),
      contentSchemaVersion: descriptor.contentSchemaVersion,
    };
    expect(computeAgentSchemaDigest(reordered)).toBe(result.schemaDigest);

    const firstTemplate = descriptor.templates[0]!;
    const changedTemplate = { ...firstTemplate, version: firstTemplate.version + 1 };
    expect(
      computeAgentSchemaDigest({
        ...descriptor,
        templates: [changedTemplate, ...descriptor.templates.slice(1)],
      }),
    ).not.toBe(result.schemaDigest);
    expect(
      computeAgentSchemaDigest({
        ...descriptor,
        warningCodes: [...descriptor.warningCodes, "new_warning"],
      }),
    ).not.toBe(result.schemaDigest);
    expect(
      computeAgentSchemaDigest({
        ...descriptor,
        agentOperations: descriptor.agentOperations.map((entry) =>
          entry.name === "render.start" ? { ...entry, longRunning: false } : entry,
        ),
      }),
    ).not.toBe(result.schemaDigest);
  });
});

describe("composition operations", () => {
  const manifest = {
    entrypoint: "index.html",
    contentHash: "hash-1",
    runtimeCompositionId: "cmp.motion.test",
    canvasProfile: "landscape",
    width: 1920,
    height: 1080,
    durationMs: 4000,
    dependencies: [],
  };

  const version = {
    id: "cmpver-1",
    compositionId: "cmp-1",
    versionNumber: 1,
    bundleHash: "hash-1",
    storageKey: "compositions/bundles/hash-1/cmpver-1",
    manifest,
    createdAt: "2026-10-21T00:00:00.000Z",
  };

  it("registers every composition operation and classifies reads and mutations", () => {
    const compositionNames = [
      "composition.list",
      "composition.get",
      "composition.draft.get",
      "composition.authoringContext",
      "composition.create",
      "composition.draft.save",
      "composition.publish",
    ] as const;

    for (const name of compositionNames) {
      expect(agentOperationNames).toContain(name);
      expect(isAgentOperationName(name)).toBe(true);
    }
    for (const name of ["composition.list", "composition.get", "composition.draft.get", "composition.authoringContext"] as const) {
      expect(agentReadOperationNames).toContain(name);
      expect(isAgentMutationOperation(name)).toBe(false);
    }
    for (const name of ["composition.create", "composition.draft.save", "composition.publish"] as const) {
      expect(agentMutationOperationNames).toContain(name);
      expect(isAgentMutationOperation(name)).toBe(true);
    }
  });

  it("keeps input and output schemas mapped one-to-one with the operation list", () => {
    expect(Object.keys(agentOperationInputSchemas).sort()).toEqual([...agentOperationNames].sort());
    expect(Object.keys(agentOperationOutputSchemas).sort()).toEqual([...agentOperationNames].sort());
  });

  it("never exposes composition or other irreversible deletion", () => {
    const deletion = agentOperationNames.filter(
      (name) => name.startsWith("composition.") && /(delete|remove|destroy|purge)/u.test(name),
    );
    expect(deletion).toEqual([]);
    expect([...agentReadOperationNames, ...agentMutationOperationNames].sort()).toEqual(
      [...agentOperationNames].sort(),
    );
  });

  it("accepts composition reads and rejects a missing id", () => {
    expect(agentCompositionGetInputSchema.safeParse({ compositionId: "cmp-1" }).success).toBe(true);
    expect(agentCompositionGetInputSchema.safeParse({}).success).toBe(false);
    expect(
      agentCompositionGetInputSchema.safeParse({ compositionId: "cmp-1", extra: 1 }).success,
    ).toBe(false);
    expect(
      agentCompositionAuthoringContextInputSchema.safeParse({
        visualTheme: { id: "soft-editorial", version: 1 },
        canvasProfile: "landscape",
      }).success,
    ).toBe(true);
    expect(agentCompositionAuthoringContextInputSchema.safeParse({}).success).toBe(false);
    expect(
      agentCompositionAuthoringContextInputSchema.safeParse({
        visualTheme: { id: "soft-editorial", version: 1 },
        canvasProfile: "square",
      }).success,
    ).toBe(false);
  });

  it("accepts create with an optional authoring style", () => {
    expect(
      agentCompositionCreateInputSchema.safeParse({
        name: "Motion",
        runtimeCompositionId: "cmp.motion.test",
      }).success,
    ).toBe(true);
    expect(
      agentCompositionCreateInputSchema.safeParse({
        name: "Motion",
        runtimeCompositionId: "cmp.motion.test",
        canvasProfile: "portrait",
        authoringStyle: { visualTheme: { id: "soft-editorial", version: 1 } },
      }).success,
    ).toBe(true);
    expect(
      agentCompositionCreateInputSchema.safeParse({ name: "Motion" }).success,
    ).toBe(false);
    expect(
      agentCompositionCreateInputSchema.safeParse({
        name: "Motion",
        runtimeCompositionId: "cmp.motion.test",
        entrypoint: "../escape.html",
      }).success,
    ).toBe(false);
  });

  it("accepts partial draft saves and rejects unknown draft fields", () => {
    expect(
      agentCompositionDraftSaveInputSchema.safeParse({
        compositionId: "cmp-1",
        files: { "index.html": "<!doctype html>" },
        manifest: { durationMs: 4000, canvasProfile: "portrait" },
      }).success,
    ).toBe(true);
    expect(
      agentCompositionDraftSaveInputSchema.safeParse({ compositionId: "cmp-1" }).success,
    ).toBe(true);
    expect(
      agentCompositionDraftSaveInputSchema.safeParse({ files: { "a.txt": "x" } }).success,
    ).toBe(false);
    expect(
      agentCompositionDraftSaveInputSchema.safeParse({
        compositionId: "cmp-1",
        files: { "/abs.txt": "x" },
      }).success,
    ).toBe(false);
    expect(
      agentCompositionDraftSaveInputSchema.safeParse({ compositionId: "cmp-1", bin: {} }).success,
    ).toBe(false);
  });

  it("discriminates dry-run and real publish results", () => {
    expect(
      agentCompositionPublishInputSchema.safeParse({ compositionId: "cmp-1", dryRun: true })
        .success,
    ).toBe(true);
    expect(
      agentCompositionPublishInputSchema.safeParse({ compositionId: "cmp-1" }).success,
    ).toBe(true);
    expect(
      agentCompositionPublishInputSchema.safeParse({ compositionId: "cmp-1", dryRun: "yes" })
        .success,
    ).toBe(false);

    const dryRun = { dryRun: true as const, manifest, fontDiagnostics: ["f"] };
    const published = { dryRun: false as const, version, fontDiagnostics: [] };
    expect(agentCompositionPublishOutputSchema.parse(dryRun)).toEqual(dryRun);
    expect(agentCompositionPublishOutputSchema.parse(published)).toEqual(published);
    expect(
      agentCompositionPublishOutputSchema.safeParse({ ...dryRun, version }).success,
    ).toBe(false);
    expect(
      agentCompositionPublishOutputSchema.safeParse({ ...published, dryRun: undefined }).success,
    ).toBe(false);
    expect(
      agentCompositionPublishOutputSchema.safeParse({
        ...published,
        version: { ...version, manifest: { ...manifest, width: 1080 } },
      }).success,
    ).toBe(false);
  });
});

describe("script.edit", () => {
  it("accepts base version, requestId and operations", () => {
    const request = {
      baseScriptVersionId: "scr-002",
      requestId: "edit-1",
      operations: editOperations,
    };
    expect(scriptEditRequestSchema.safeParse(request).success).toBe(true);
    expect(scriptEditRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
    expect(
      scriptEditRequestSchema.safeParse({ ...request, requestId: "   " }).success,
    ).toBe(false);
    expect(
      scriptEditRequestSchema.safeParse({
        ...request,
        operations: [{ op: "scene.explode" }],
      }).success,
    ).toBe(false);
    expect(
      scriptEditRequestSchema.safeParse({
        requestId: "edit-1",
        operations: editOperations,
      }).success,
    ).toBe(false);
  });

  it("round-trips the result with attribution, created IDs and timeline", () => {
    const result = {
      scriptVersion,
      created: {
        sceneIds: ["scene-1"],
        lineIds: ["line-1"],
        cueIds: [],
        audioCueIds: [],
        audioTakeIds: [],
      },
      warnings: [
        {
          path: ["scenes", 1, "lines", 0, "captionText"],
          code: "text_overflow",
          message: "overflows",
        },
      ],
      timeline,
      replay: false,
    };
    expect(scriptEditResultSchema.parse(result)).toEqual(result);
    expect(
      scriptEditResultSchema.safeParse({ ...result, author: "robot" }).success,
    ).toBe(false);
    expect(
      scriptEditResultSchema.safeParse({
        ...result,
        scriptVersion: { ...scriptVersion, author: "robot" },
      }).success,
    ).toBe(false);
    expect(
      scriptEditResultSchema.safeParse({
        ...result,
        created: { ...result.created, audioTakeIds: undefined },
      }).success,
    ).toBe(false);
    expect(scriptEditResultSchema.safeParse({ ...result, replay: undefined }).success).toBe(
      false,
    );
  });
});

describe("script.save and script.validate", () => {
  it("accepts a full document for save and rejects unknown fields", () => {
    expect(
      scriptSaveRequestSchema.safeParse({
        languageEditionId: "led-1",
        content: validContentDocument(),
      }).success,
    ).toBe(true);
    expect(
      scriptSaveRequestSchema.safeParse({
        content: validContentDocument(),
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      scriptSaveRequestSchema.safeParse({ content: validContentDocument() }).success,
    ).toBe(false);
    expect(
      scriptSaveResultSchema.safeParse({
        scriptVersion,
        warnings: [],
      }).success,
    ).toBe(true);
  });

  it("accepts either a document or a base version with operations", () => {
    expect(
      scriptValidateRequestSchema.safeParse({ content: validContentDocument() }).success,
    ).toBe(true);
    expect(
      scriptValidateRequestSchema.safeParse({
        baseScriptVersionId: "scr-002",
        operations: editOperations,
      }).success,
    ).toBe(true);
    expect(
      scriptValidateRequestSchema.safeParse({
        baseScriptVersionId: "scr-002",
        operations: editOperations,
        extra: 1,
      }).success,
    ).toBe(false);
    expect(scriptValidateRequestSchema.safeParse({}).success).toBe(false);
    expect(
      scriptValidateResultSchema.safeParse({ warnings: [], timeline }).success,
    ).toBe(true);
  });
});
