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

const libraryCharacter: ScriptLibraryCharacter = {
  id: "lib-1",
  name: "四国めたん",
  voices: [
    { locale: "ja-JP", voiceProfileId: "vp-ja" },
    { locale: "en-US", voiceProfileId: "vp-en" },
  ],
  appearances: [
    {
      assetId: "asset-image-1",
      expression: "smile",
      pose: "front",
      label: "夏服",
      faceSetId: "face-set-1",
    },
    {
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
      },
      {
        id: "appearance-2",
        assetId: "asset-image-2",
        expression: "normal",
        pose: "side",
        faceSetId: null,
      },
    ]);

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
