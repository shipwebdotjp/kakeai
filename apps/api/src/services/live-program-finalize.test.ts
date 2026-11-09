import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  liveProgramDocumentSchema,
  type LiveProgramDocument,
} from "@kakeai/contracts";
import {
  addScriptCue,
  createLiveAsset,
  createLiveCharacter,
  createLiveTestContext,
  createLiveVoiceProfile,
  createLiveWorkWithScene,
  liveFormatFixture,
  testAssetSha,
  testRenditionSha,
  type LiveTestContext,
} from "./live-program-test-helpers.ts";
import { createLiveFormat } from "./live-formats.ts";
import {
  createLiveProgram,
  finalizeLiveProgramVersion,
  importLiveMaterial,
  listLiveMaterials,
  saveLiveProgramDraft,
} from "./live-programs.ts";

let context: LiveTestContext;
let materialWorkId: string;
let materialSceneId: string;

beforeAll(async () => {
  context = await createLiveTestContext("kakeai-live-finalize-");
  await createLiveAsset(context.prisma, {
    id: "asset-char",
    kind: "image",
    mediaType: "image/png",
  });
  await createLiveAsset(context.prisma, {
    id: "asset-face-layer",
    kind: "image",
    mediaType: "image/png",
  });
  await context.prisma.faceSet.create({
    data: {
      id: "face-set-1",
      name: "標準フェイス",
      revisions: {
        create: [
          {
            versionNumber: 1,
            layers: {
              create: [
                {
                  id: "layer-eye",
                  part: "eye",
                  assetId: "asset-face-layer",
                },
              ],
            },
            expressions: {
              create: [{ id: "normal", name: "通常" }],
            },
          },
        ],
      },
    },
  });
  await createLiveAsset(context.prisma, {
    id: "asset-card-image",
    kind: "image",
    mediaType: "image/jpeg",
  });
  await createLiveAsset(context.prisma, {
    id: "asset-audio-rendition",
    kind: "audio",
    mediaType: "audio/wav",
    rendition: true,
  });
  await createLiveAsset(context.prisma, {
    id: "asset-audio-no-rendition",
    kind: "audio",
    mediaType: "audio/wav",
  });
  await createLiveAsset(context.prisma, {
    id: "asset-video",
    kind: "video",
    mediaType: "video/mp4",
    hasAudio: false,
  });
  await createLiveAsset(context.prisma, {
    id: "asset-ref-audio",
    kind: "audio",
    mediaType: "audio/wav",
  });
  await createLiveAsset(context.prisma, {
    id: "asset-bg",
    kind: "image",
    mediaType: "image/png",
  });
  await createLiveCharacter(context.prisma, {
    id: "char-left",
    name: "左キャラ",
    appearanceAssetId: "asset-char",
    faceSetId: "face-set-1",
  });
  await createLiveVoiceProfile(context.prisma, { id: "voice-left" });
  await createLiveVoiceProfile(context.prisma, {
    id: "voice-openai",
    adapterId: "openai-compatible",
    voiceId: "alloy",
    settingsJson: JSON.stringify({
      model: "tts-1",
      refAudioAssetId: "asset-ref-audio",
      langCode: "Japanese",
    }),
  });
  const work = await createLiveWorkWithScene(context.prisma, {
    workId: "work-material-source",
  });
  materialWorkId = work.workId;
  materialSceneId = work.sceneId;
}, 60_000);

afterAll(async () => {
  await context.close();
});

async function createProgramWithScript(voiceProfileId = "voice-left") {
  const formatDocument = liveFormatFixture({
    characterId: "char-left",
    voiceProfileId,
  });
  const format = await createLiveFormat(context.prisma, formatDocument);
  const created = await createLiveProgram(context.prisma, { formatId: format.id });
  const document = addScriptCue(created.draftDocument);
  const saved = await saveLiveProgramDraft(context.prisma, created.id, {
    expectedRevision: 0,
    document,
  });
  return {
    programId: created.id,
    revision: saved.draftRevision,
    document: saved.draftDocument,
  };
}

async function saveInvalidDraft(
  programId: string,
  expectedRevision: number,
  document: LiveProgramDocument,
): Promise<number> {
  const saved = await saveLiveProgramDraft(context.prisma, programId, {
    expectedRevision,
    document,
  });
  return saved.draftRevision;
}

async function expectFinalizeValidationError(
  programId: string,
  expectedRevision: number,
  messagePart: string,
) {
  await expect(
    finalizeLiveProgramVersion(context.prisma, programId, { expectedRevision }),
  ).rejects.toMatchObject({
    status: 422,
    code: "VALIDATION_ERROR",
    details: {
      issues: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(messagePart),
        }),
      ]),
    },
  });
}

describe("Live Program version validation", () => {
  it("rejects a draft without opening and closing segments", async () => {
    const { programId, revision, document } = await createProgramWithScript();
    const invalid = liveProgramDocumentSchema.parse({
      ...document,
      segments: document.segments.filter((segment) => segment.kind === "script"),
    });
    const nextRevision = await saveInvalidDraft(programId, revision, invalid);
    await expectFinalizeValidationError(programId, nextRevision, "opening");
  });

  it("rejects a right speaker when the right cast is null", async () => {
    const { programId, revision, document } = await createProgramWithScript();
    const invalid = liveProgramDocumentSchema.parse({
      ...document,
      cues: document.cues.map((cue) =>
        cue.id === "test-script-cue" ? { ...cue, speaker: "right" } : cue,
      ),
    });
    const nextRevision = await saveInvalidDraft(programId, revision, invalid);
    await expectFinalizeValidationError(programId, nextRevision, "右話者");
  });

  it("rejects a missing audio Asset", async () => {
    const { programId, revision, document } = await createProgramWithScript();
    const invalid = liveProgramDocumentSchema.parse({
      ...document,
      cues: document.cues.map((cue) =>
        cue.id === "test-script-cue"
          ? { ...cue, audioAssetId: "asset-missing-audio" }
          : cue,
      ),
    });
    const nextRevision = await saveInvalidDraft(programId, revision, invalid);
    await expectFinalizeValidationError(programId, nextRevision, "asset-missing-audio");
  });

  it("rejects an audio Asset without a ready rendition", async () => {
    const { programId, revision, document } = await createProgramWithScript();
    const invalid = liveProgramDocumentSchema.parse({
      ...document,
      cues: document.cues.map((cue) =>
        cue.id === "test-script-cue"
          ? { ...cue, audioAssetId: "asset-audio-no-rendition" }
          : cue,
      ),
    });
    const nextRevision = await saveInvalidDraft(programId, revision, invalid);
    await expectFinalizeValidationError(programId, nextRevision, "Rendition");
  });

  it("rejects a missing card image Asset", async () => {
    const { programId, revision, document } = await createProgramWithScript();
    const invalid = liveProgramDocumentSchema.parse({
      ...document,
      cards: [
        ...document.cards,
        {
          id: "card-image-missing",
          type: "image",
          states: [{ id: "state-image-missing", assetId: "asset-missing-image" }],
        },
      ],
      cues: document.cues.map((cue) =>
        cue.id === "test-script-cue"
          ? {
              ...cue,
              visual: {
                kind: "card",
                cardId: "card-image-missing",
                stateId: "state-image-missing",
              },
            }
          : cue,
      ),
    });
    const nextRevision = await saveInvalidDraft(programId, revision, invalid);
    await expectFinalizeValidationError(programId, nextRevision, "asset-missing-image");
  });

  it("ignores the image Asset of a card that no visual references", async () => {
    const { programId, revision, document } = await createProgramWithScript();
    // v2 packages only carry referenced cards, so an unused broken card must
    // not block finalization.
    const withUnused = liveProgramDocumentSchema.parse({
      ...document,
      cards: [
        ...document.cards,
        {
          id: "card-image-unused",
          type: "image",
          states: [{ id: "state-image-unused", assetId: "asset-missing-unused" }],
        },
      ],
    });
    const nextRevision = await saveInvalidDraft(programId, revision, withUnused);
    const version = await finalizeLiveProgramVersion(context.prisma, programId, {
      expectedRevision: nextRevision,
    });
    expect(version.versionNumber).toBe(1);
  });

  it("rejects a Live Material owned by another program", async () => {
    const source = await createProgramWithScript();
    const other = await createProgramWithScript();
    const imported = await importLiveMaterial(context.prisma, other.programId, {
      expectedRevision: other.revision,
      workId: materialWorkId,
      sceneId: materialSceneId,
    });
    const invalid = liveProgramDocumentSchema.parse({
      ...source.document,
      materials: [{ id: imported.material.id, name: "別プログラムの素材" }],
    });
    const nextRevision = await saveInvalidDraft(source.programId, source.revision, invalid);
    await expectFinalizeValidationError(
      source.programId,
      nextRevision,
      "別のプログラム",
    );
  });

  it("stores the selected material format and duration in the snapshot", async () => {
    const { programId, revision } = await createProgramWithScript();
    const imported = await importLiveMaterial(context.prisma, programId, {
      expectedRevision: revision,
      workId: materialWorkId,
      sceneId: materialSceneId,
      format: "mp4",
      durationMs: 8000,
    });
    expect(imported.material.snapshot).toMatchObject({
      format: "mp4",
      durationMs: 8000,
    });
    const row = await context.prisma.liveMaterial.findUniqueOrThrow({
      where: { id: imported.material.id },
    });
    expect(JSON.parse(row.snapshotJson)).toMatchObject({
      format: "mp4",
      durationMs: 8000,
    });
  });

  it("rejects an invalid visual reference stored in the draft", async () => {
    const { programId, revision, document } = await createProgramWithScript();
    const invalid = {
      ...document,
      cues: document.cues.map((cue) =>
        cue.id === "test-script-cue"
          ? {
              ...cue,
              visual: { kind: "card", cardId: "card-missing", stateId: "state-missing" },
            }
          : cue,
      ),
    };
    await context.prisma.liveProgram.update({
      where: { id: programId },
      data: { draftJson: JSON.stringify(invalid) },
    });
    await expect(
      finalizeLiveProgramVersion(context.prisma, programId, {
        expectedRevision: revision,
      }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
  });

  it("freezes theme, characters, voices, audio, CutIn and material hashes", async () => {
    const { programId, revision, document } = await createProgramWithScript(
      "voice-openai",
    );
    const closingIndex = document.segments.findIndex(
      (segment) => segment.kind === "closing",
    );
    const withAssets = liveProgramDocumentSchema.parse({
      ...document,
      cues: document.cues.map((cue) =>
        cue.id === "test-script-cue"
          ? {
              ...cue,
              audioAssetId: "asset-audio-rendition",
              visual: { kind: "card", cardId: "card-image", stateId: "state-image" },
            }
          : cue,
      ),
      cards: [
        ...document.cards,
        {
          id: "card-image",
          type: "image",
          states: [{ id: "state-image", assetId: "asset-card-image" }],
        },
      ],
      cutIns: [{ id: "cut-in-1", assetId: "asset-video" }],
      segments: [
        ...document.segments.slice(0, closingIndex),
        { id: "seg-cut-in", kind: "cut_in", label: "コーナー", cutInId: "cut-in-1" },
        ...document.segments.slice(closingIndex),
      ],
    });
    const withAssetsRevision = await saveInvalidDraft(
      programId,
      revision,
      withAssets,
    );
    const imported = await importLiveMaterial(context.prisma, programId, {
      expectedRevision: withAssetsRevision,
      workId: materialWorkId,
      sceneId: materialSceneId,
      format: "html",
      durationMs: 6000,
    });
    expect(imported.program.draftRevision).toBe(withAssetsRevision + 1);

    const materials = await listLiveMaterials(context.prisma, programId);
    expect(materials.items).toHaveLength(1);
    expect(materials.items[0]?.provenance.workId).toBe(materialWorkId);
    expect(materials.items[0]?.provenance.sceneId).toBe(materialSceneId);

    const version = await finalizeLiveProgramVersion(context.prisma, programId, {
      expectedRevision: imported.program.draftRevision,
    });
    const snapshot = version.resolutionSnapshot;
    expect(snapshot.theme.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.characters[0]?.appearances[0]?.image.sha256).toBe(
      testAssetSha("asset-char"),
    );
    expect(snapshot.characters[0]?.appearances[0]?.standing).toEqual({
      scale: 1,
      edge: "margin",
      vertical: "standard",
    });
    expect(snapshot.characters[0]?.appearances[0]?.faceSet?.sha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(
      snapshot.characters[0]?.appearances[0]?.faceSet?.layers[0]?.assetId,
    ).toBe("asset-face-layer");
    expect(snapshot.voices[0]?.voiceProfileId).toBe("voice-openai");
    expect(snapshot.voices[0]?.referenceAudio?.sha256).toBe(
      testAssetSha("asset-ref-audio"),
    );
    expect(snapshot.voices[0]?.settings).not.toHaveProperty("refAudioAssetId");
    expect(snapshot.audioAssets).toEqual([
      expect.objectContaining({
        cueId: "test-script-cue",
        asset: expect.objectContaining({
          renditionId: "rendition-asset-audio-rendition",
          sha256: testRenditionSha("asset-audio-rendition"),
        }),
      }),
    ]);
    expect(snapshot.cutIns).toEqual([
      expect.objectContaining({
        cutInId: "cut-in-1",
        asset: expect.objectContaining({ sha256: testAssetSha("asset-video") }),
      }),
    ]);
    expect(snapshot.cardAssets).toEqual([
      expect.objectContaining({
        assetId: "asset-card-image",
        asset: expect.objectContaining({
          assetId: "asset-card-image",
          kind: "image",
          sha256: testAssetSha("asset-card-image"),
        }),
      }),
    ]);
    expect(snapshot.materials).toHaveLength(1);
    expect(snapshot.materials[0]).toMatchObject({
      format: "html",
      // PNG/HTML cards are always 4000ms stills, regardless of the request.
      durationMs: 4_000,
    });
    expect(
      snapshot.materials[0]?.assets.some((asset) => asset.assetId === "asset-bg"),
    ).toBe(true);
    expect(snapshot.materials[0]?.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
