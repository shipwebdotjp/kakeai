import type {
  Character,
  CharacterAddFromLibraryOperation,
  ContentDocument,
  Speaker,
} from "@kakeai/contracts";
import type { ScriptContext } from "./context.ts";
import { preconditionFailed, targetNotFound } from "./errors.ts";
import type { SceneEditResult } from "./scene.ts";

export interface CharacterEditResult extends SceneEditResult {
  characterIds?: string[];
  appearanceIds?: string[];
  speakerIds?: string[];
}

/**
 * Copies a character library entry into the document as new local entities.
 *
 * This mirrors the Web UI's "add from library" rule and never mutates the
 * library: the Character, every Appearance and the Speaker get fresh IDs, while
 * voices, appearance fields (including the Face Set reference) and the name are
 * copied. The Speaker's voice is the entry voice whose locale matches the
 * document locale, or `null` when there is no match.
 *
 * A missing lookup capability is a precondition failure (the caller did not
 * provide the catalog); an unknown entry is a missing target.
 */
export function addCharacterFromLibrary(
  document: ContentDocument,
  operation: CharacterAddFromLibraryOperation,
  context: ScriptContext,
): CharacterEditResult {
  const library = context.libraryCharacters;
  if (library === undefined) {
    throw preconditionFailed(
      ["libraryCharacterId"],
      "キャラクターライブラリを参照できません。",
    );
  }
  const entry = library.get(operation.libraryCharacterId);
  if (entry === null) {
    throw targetNotFound(
      ["libraryCharacterId"],
      `ライブラリのキャラクターが見つかりません: ${operation.libraryCharacterId}`,
    );
  }

  const characterIds = new Set(document.characters.map((character) => character.id));
  const appearanceIds = new Set(
    document.characters.flatMap((character) =>
      character.appearances.map((appearance) => appearance.id),
    ),
  );
  const speakerIds = new Set(document.speakers.map((speaker) => speaker.id));

  const characterId = context.ids.character(characterIds);
  characterIds.add(characterId);

  const appearances = entry.appearances.map((appearance) => {
    const appearanceId = context.ids.appearance(appearanceIds);
    appearanceIds.add(appearanceId);
    return {
      id: appearanceId,
      assetId: appearance.assetId,
      expression: appearance.expression,
      pose: appearance.pose,
      ...(appearance.label === undefined ? {} : { label: appearance.label }),
      faceSetId: appearance.faceSetId,
    };
  });

  const character: Character = {
    id: characterId,
    name: entry.name,
    voices: entry.voices.map((voice) => ({
      locale: voice.locale,
      voiceProfileId: voice.voiceProfileId,
    })),
    appearances,
  };

  const voiceProfileId =
    entry.voices.find((voice) => voice.locale === document.locale)?.voiceProfileId ?? null;
  const speakerId = context.ids.speaker(speakerIds);
  const speaker: Speaker = {
    id: speakerId,
    name: entry.name,
    characterId,
    voiceProfileId,
  };

  return {
    document: {
      ...document,
      characters: [...document.characters, character],
      speakers: [...document.speakers, speaker],
    },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: characterId,
    characterIds: [characterId],
    appearanceIds: appearances.map((appearance) => appearance.id),
    speakerIds: [speakerId],
  };
}
