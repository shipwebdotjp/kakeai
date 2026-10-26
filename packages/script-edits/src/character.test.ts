import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  type ContentDocument,
} from "@kakeai/contracts";
import { applyScriptOperation, applyScriptOperations } from "./apply.ts";
import type {
  ScriptContext,
  ScriptIdGenerator,
  ScriptLibraryCharacter,
} from "./context.ts";
import { ScriptEditError } from "./errors.ts";
import {
  planCharacterLibraryUpdate,
  updateCharacterFromLibrary,
} from "./character.ts";

const libraryCharacter: ScriptLibraryCharacter = {
  id: "lib-1",
  name: "四国めたん",
  names: [
    { locale: "ja-JP", name: "四国めたん" },
    { locale: "en-US", name: "Shikoku Metan" },
  ],
  voices: [
    { locale: "ja-JP", voiceProfileId: "vp-ja" },
    { locale: "en-US", voiceProfileId: "vp-en" },
  ],
  appearances: [
    {
      id: "lib-appearance-1",
      assetId: "asset-image-1",
      expression: "smile",
      pose: "front",
      label: "夏服",
      faceSetId: "face-set-1",
    },
    {
      id: "lib-appearance-2",
      assetId: "asset-image-2",
      expression: "normal",
      pose: "side",
      faceSetId: null,
    },
  ],
};

function nextId(prefix: string, existing: ReadonlySet<string>): string {
  let index = 1;
  while (existing.has(`${prefix}-${index}`)) {
    index += 1;
  }
  return `${prefix}-${index}`;
}

const ids: ScriptIdGenerator = {
  scene: (existing) => nextId("scene", existing),
  line: (sceneId, existing) => nextId(`line-${sceneId}`, existing),
  cue: (sceneId, suffix, existing) => nextId(`visual-${sceneId}-${suffix}`, existing),
  audioCue: (existing) => nextId("audio", existing),
  audioTake: (lineId, existing) => nextId(`take-${lineId}`, existing),
  character: (existing) => nextId("character", existing),
  appearance: (existing) => nextId("appearance", existing),
  speaker: (existing) => nextId("speaker", existing),
};

function contextWith(
  entries: readonly ScriptLibraryCharacter[],
): ScriptContext {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    assets: { get: () => null },
    ids,
    libraryCharacters: { get: (characterId) => byId.get(characterId) ?? null },
    faceSets: {
      latest: (faceSetId) =>
        faceSetId === "face-set-1"
          ? {
              id: faceSetId,
              version: 2,
              expressions: [
                {
                  id: "normal",
                  name: "通常",
                  browLayerId: null,
                  eyeLayerId: null,
                  mouthLayerId: null,
                },
                {
                  id: "smile",
                  name: "笑い",
                  browLayerId: null,
                  eyeLayerId: null,
                  mouthLayerId: null,
                },
              ],
            }
          : null,
    },
  };
}

function expectEditError(callback: () => unknown, code: ScriptEditError["code"]): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ScriptEditError);
    expect((error as ScriptEditError).code).toBe(code);
    return;
  }
  throw new Error(`エラーが発生しませんでした: ${code}`);
}

function copiedCharacter(document: ContentDocument, index = -1) {
  const character = document.characters.at(index);
  if (character === undefined) {
    throw new Error("コピーされたキャラクターがありません。");
  }
  return character;
}

function speakerOf(document: ContentDocument, characterId: string) {
  const speaker = document.speakers.find((entry) => entry.characterId === characterId);
  if (speaker === undefined) {
    throw new Error("コピーされた話者がありません。");
  }
  return speaker;
}

describe("character.addFromLibrary", () => {
  it("copies voices, appearances and Face Set references into new local IDs", () => {
    const document = createInitialContentDocument();
    const before = structuredClone(document);
    const result = applyScriptOperation(
      document,
      { op: "character.addFromLibrary", libraryCharacterId: "lib-1" },
      contextWith([libraryCharacter]),
    );

    const character = copiedCharacter(result.document);
    expect(character.id).toBe("character-1");
    expect(character.name).toBe("四国めたん");
    expect(character.names).toEqual([
      { locale: "ja-JP", name: "四国めたん" },
      { locale: "en-US", name: "Shikoku Metan" },
    ]);
    expect(character.voices).toEqual([
      { locale: "ja-JP", voiceProfileId: "vp-ja" },
      { locale: "en-US", voiceProfileId: "vp-en" },
    ]);
    expect(character.appearances).toEqual([
      {
        id: "appearance-1",
        assetId: "asset-image-1",
        expression: "smile",
        pose: "front",
        label: "夏服",
        faceSetId: "face-set-1",
        faceSetVersion: 2,
        libraryAppearanceId: "lib-appearance-1",
      },
      {
        id: "appearance-2",
        assetId: "asset-image-2",
        expression: "normal",
        pose: "side",
        faceSetId: null,
        faceSetVersion: null,
        libraryAppearanceId: "lib-appearance-2",
      },
    ]);
    expect(character.libraryCharacterId).toBe("lib-1");

    const speaker = speakerOf(result.document, character.id);
    expect(speaker).toEqual({
      id: "speaker-1",
      name: "四国めたん",
      characterId: character.id,
      voiceProfileId: "vp-ja",
    });

    expect(result.created).toMatchObject({
      characterIds: ["character-1"],
      appearanceIds: ["appearance-1", "appearance-2"],
      speakerIds: ["speaker-1"],
    });
    expect(result.created.sceneIds).toEqual([]);
    expect(result.created.lineIds).toEqual([]);
    expect(result.created.cueIds).toEqual([]);
    expect(result.created.audioCueIds).toEqual([]);
    expect(result.created.audioTakeIds).toEqual([]);

    // Unrelated data is untouched.
    expect(result.document.scenes).toEqual(before.scenes);
    expect(result.document.audioCues).toEqual(before.audioCues);
    expect(result.document.audioTakes).toEqual(before.audioTakes);
    expect(contentDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it("copies a character with no appearances and a locale without a voice", () => {
    const document = createInitialContentDocument();
    const result = applyScriptOperation(
      document,
      { op: "character.addFromLibrary", libraryCharacterId: "lib-2" },
      contextWith([
        {
          id: "lib-2",
          name: "ナレーター",
          names: [],
          voices: [{ locale: "en-US", voiceProfileId: "vp-en" }],
          appearances: [],
        },
      ]),
    );

    const character = copiedCharacter(result.document);
    expect(character.appearances).toEqual([]);
    expect(result.created.appearanceIds).toEqual([]);
    expect(speakerOf(result.document, character.id).voiceProfileId).toBeNull();
    expect(contentDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it("resolves the locale name when copying into a non-default locale", () => {
    const document = { ...createInitialContentDocument(), locale: "en-US" as const };
    const result = applyScriptOperation(
      document,
      { op: "character.addFromLibrary", libraryCharacterId: "lib-1" },
      contextWith([libraryCharacter]),
    );
    const character = copiedCharacter(result.document);
    expect(character.name).toBe("Shikoku Metan");
    expect(character.names).toEqual(libraryCharacter.names);
    expect(speakerOf(result.document, character.id).name).toBe("Shikoku Metan");
    expect(speakerOf(result.document, character.id).voiceProfileId).toBe("vp-en");
    expect(contentDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it("falls back to the default name when the locale has no alias", () => {
    const document = { ...createInitialContentDocument(), locale: "en-US" as const };
    const result = applyScriptOperation(
      document,
      { op: "character.addFromLibrary", libraryCharacterId: "lib-2" },
      contextWith([
        {
          id: "lib-2",
          name: "ナレーター",
          names: [],
          voices: [{ locale: "en-US", voiceProfileId: "vp-en" }],
          appearances: [],
        },
      ]),
    );
    const character = copiedCharacter(result.document);
    expect(character.name).toBe("ナレーター");
    expect(character.names).toEqual([]);
    expect(speakerOf(result.document, character.id).name).toBe("ナレーター");
    expect(contentDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it("gives distinct local IDs when the same entry is copied twice in one batch", () => {
    const result = applyScriptOperations(
      createInitialContentDocument(),
      [
        { op: "character.addFromLibrary", libraryCharacterId: "lib-1" },
        { op: "character.addFromLibrary", libraryCharacterId: "lib-1" },
      ],
      contextWith([libraryCharacter]),
    );

    expect(result.document.characters).toHaveLength(2);
    expect(result.document.speakers).toHaveLength(2);
    expect(new Set(result.document.characters.map((entry) => entry.id)).size).toBe(2);
    expect(new Set(result.document.speakers.map((entry) => entry.id)).size).toBe(2);
    expect(result.created.characterIds).toEqual(["character-1", "character-2"]);
    expect(result.created.appearanceIds).toEqual([
      "appearance-1",
      "appearance-2",
      "appearance-3",
      "appearance-4",
    ]);
    expect(result.created.speakerIds).toEqual(["speaker-1", "speaker-2"]);
    expect(result.document.speakers.map((entry) => entry.name)).toEqual([
      "四国めたん",
      "四国めたん",
    ]);
    expect(contentDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it("rejects an unknown library character and a missing lookup", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "character.addFromLibrary", libraryCharacterId: "missing" },
          contextWith([libraryCharacter]),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "character.addFromLibrary", libraryCharacterId: "lib-1" },
          { assets: { get: () => null }, ids },
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });
});

describe("character.updateFromLibrary", () => {
  function planContext(version: number, expressionIds: string[]): ScriptContext {
    const entry: ScriptLibraryCharacter = {
      ...libraryCharacter,
      name: "四国めたん（新）",
      names: [{ locale: "ja-JP", name: "四国めたん（新）" }],
      voices: [{ locale: "ja-JP", voiceProfileId: "vp-ja-2" }],
      appearances: [
        {
          id: "lib-appearance-1",
          assetId: "asset-image-1",
          expression: "smile",
          pose: "front",
          label: "夏服",
          faceSetId: "face-set-1",
        },
        {
          id: "lib-appearance-3",
          assetId: "asset-image-3",
          expression: "normal",
          pose: "front",
          faceSetId: null,
        },
      ],
    };
    const byId = new Map([[entry.id, entry]]);
    return {
      assets: { get: () => null },
      ids,
      libraryCharacters: { get: (characterId) => byId.get(characterId) ?? null },
      faceSets: {
        latest: (faceSetId) =>
          faceSetId === "face-set-1"
            ? {
                id: faceSetId,
                version,
                expressions: expressionIds.map((id) => ({
                  id,
                  name: id,
                  browLayerId: null,
                  eyeLayerId: null,
                  mouthLayerId: null,
                })),
              }
            : null,
      },
    };
  }

  function documentWithCopiedCharacter(): ContentDocument {
    const document = createInitialContentDocument();
    const copied = applyScriptOperation(
      document,
      { op: "character.addFromLibrary", libraryCharacterId: "lib-1" },
      contextWith([libraryCharacter]),
    ).document;
    const point = copied.scenes[1]!;
    if (point.kind !== "point") {
      throw new Error("expected a point scene");
    }
    point.lines = [
      {
        id: "line-smile",
        speakerId: "speaker-1",
        captionText: "笑顔",
        speechText: "えがお",
        selectedAudioTakeId: null,
        expressionId: "smile",
      },
    ];
    point.visualCues.push({
      id: "vc-standing",
      template: { id: "character.standing", version: 1 },
      range: { kind: "scene" },
      layer: "standing",
      order: 0,
      transition: {
        enter: { preset: "none", durationMs: 0 },
        exit: { preset: "none", durationMs: 0 },
      },
      input: {
        characterId: "character-1",
        appearanceId: "appearance-1",
        side: "left",
        scale: 1,
      },
    });
    return copied;
  }

  it("updates in place, keeps local IDs, detaches removed appearances and resets lost expressions", () => {
    const document = documentWithCopiedCharacter();
    const context = planContext(3, ["normal"]);
    const plan = planCharacterLibraryUpdate(
      document,
      "character-1",
      context.libraryCharacters!.get("lib-1")!,
      context,
    );
    expect(plan.name).toEqual({ before: "四国めたん", after: "四国めたん（新）" });
    expect(plan.appearances.updated).toHaveLength(1);
    expect(plan.appearances.updated[0]).toMatchObject({
      appearanceId: "appearance-1",
      libraryAppearanceId: "lib-appearance-1",
      after: { faceSetVersion: 3 },
    });
    expect(plan.appearances.removed).toEqual([
      {
        appearanceId: "appearance-2",
        libraryAppearanceId: "lib-appearance-2",
        label: "",
      },
    ]);
    expect(plan.appearances.added).toHaveLength(1);
    expect(plan.expressionResets).toMatchObject([
      { lineId: "line-smile", expressionId: "smile" },
    ]);

    const result = updateCharacterFromLibrary(
      document,
      { characterId: "character-1", libraryCharacterId: "lib-1" },
      context,
    );
    const character = result.document.characters[0]!;
    expect(character.id).toBe("character-1");
    expect(character.name).toBe("四国めたん（新）");
    expect(character.libraryCharacterId).toBe("lib-1");
    expect(character.appearances.map((appearance) => appearance.id)).toEqual([
      "appearance-1",
      "appearance-2",
      "appearance-3",
    ]);
    expect(character.appearances[0]).toMatchObject({
      libraryAppearanceId: "lib-appearance-1",
      faceSetVersion: 3,
    });
    expect(character.appearances[1]).toMatchObject({
      id: "appearance-2",
      libraryAppearanceId: null,
      faceSetId: null,
    });
    expect(character.appearances[2]).toMatchObject({
      libraryAppearanceId: "lib-appearance-3",
      assetId: "asset-image-3",
    });
    expect(result.document.speakers[0]).toMatchObject({
      id: "speaker-1",
      name: "四国めたん（新）",
      voiceProfileId: "vp-ja-2",
    });
    expect(result.document.scenes[1]!.lines[0]!.expressionId).toBeNull();
    expect(result.warnings).toMatchObject([
      {
        code: "expression_reset_to_normal",
        path: ["scenes", 1, "lines", 0, "expressionId"],
      },
    ]);
    expect(contentDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it("rejects a character that is not linked to the requested library entry", () => {
    const document = documentWithCopiedCharacter();
    const context = planContext(3, ["normal"]);
    expect(() =>
      updateCharacterFromLibrary(
        document,
        { characterId: "character-1", libraryCharacterId: "lib-2" },
        context,
      ),
    ).toThrow(ScriptEditError);
  });
});
