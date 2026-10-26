import {
  LEGACY_FACE_SET_VERSION,
  characterStandingV1InputSchema,
  resolveCharacterName,
  type Character,
  type CharacterAddFromLibraryOperation,
  type CharacterAppearance,
  type CharacterVoice,
  type ContentDocument,
  type Speaker,
  type Warning,
} from "@kakeai/contracts";
import type { ScriptContext, ScriptLibraryCharacter } from "./context.ts";
import { preconditionFailed, targetNotFound } from "./errors.ts";
import type { SceneEditResult } from "./scene.ts";

export interface CharacterLibraryUpdateInput {
  characterId: string;
  libraryCharacterId: string;
}

export interface CharacterEditResult extends SceneEditResult {
  characterIds?: string[];
  appearanceIds?: string[];
  speakerIds?: string[];
  warnings?: Warning[];
}

/** Appearance fields that an explicit library update replaces. */
export interface LibraryUpdateAppearance {
  assetId: string;
  expression: string;
  pose: string;
  label?: string;
  faceSetId: string | null;
  faceSetVersion: number | null;
}

export interface LibraryUpdateExpressionReset {
  sceneId: string;
  sceneIndex: number;
  sceneLabel: string;
  lineId: string;
  lineIndex: number;
  captionText: string;
  expressionId: string;
}

export interface LibraryUpdatePlan {
  characterId: string;
  libraryCharacterId: string;
  name: { before: string; after: string } | null;
  names: Array<{ locale: string; before: string | null; after: string | null }>;
  voices: Array<{ locale: string; before: string | null; after: string | null }>;
  appearances: {
    added: Array<{ libraryAppearanceId: string; appearance: LibraryUpdateAppearance }>;
    updated: Array<{
      appearanceId: string;
      libraryAppearanceId: string;
      before: LibraryUpdateAppearance;
      after: LibraryUpdateAppearance;
    }>;
    removed: Array<{ appearanceId: string; libraryAppearanceId: string; label: string }>;
  };
  expressionResets: LibraryUpdateExpressionReset[];
}

function latestFaceSetVersion(faceSetId: string, context: ScriptContext): number {
  const latest = context.faceSets?.latest(faceSetId);
  if (latest === null || latest === undefined) {
    throw preconditionFailed(
      ["faceSetId"],
      `表情セットの最新版が見つかりません: ${faceSetId}`,
    );
  }
  return latest.version;
}

function libraryAppearanceToNext(
  appearance: ScriptLibraryCharacter["appearances"][number],
  context: ScriptContext,
): LibraryUpdateAppearance {
  return {
    assetId: appearance.assetId,
    expression: appearance.expression,
    pose: appearance.pose,
    ...(appearance.label === undefined ? {} : { label: appearance.label }),
    faceSetId: appearance.faceSetId,
    faceSetVersion:
      appearance.faceSetId === null
        ? null
        : latestFaceSetVersion(appearance.faceSetId, context),
  };
}

function sameAppearance(
  left: LibraryUpdateAppearance,
  right: LibraryUpdateAppearance,
): boolean {
  return (
    left.assetId === right.assetId &&
    left.expression === right.expression &&
    left.pose === right.pose &&
    left.label === right.label &&
    left.faceSetId === right.faceSetId &&
    left.faceSetVersion === right.faceSetVersion
  );
}

function comparableAppearance(appearance: CharacterAppearance): LibraryUpdateAppearance {
  return {
    assetId: appearance.assetId,
    expression: appearance.expression,
    pose: appearance.pose,
    ...(appearance.label === undefined ? {} : { label: appearance.label }),
    faceSetId: appearance.faceSetId,
    faceSetVersion: appearance.faceSetVersion,
  };
}

function faceSetChanged(
  before: CharacterAppearance,
  after: CharacterAppearance,
): boolean {
  return (
    before.faceSetId !== after.faceSetId ||
    (before.faceSetVersion ?? LEGACY_FACE_SET_VERSION) !==
      (after.faceSetVersion ?? LEGACY_FACE_SET_VERSION)
  );
}

function standingAppearanceIds(
  scene: ContentDocument["scenes"][number],
  characterId: string,
): string[] {
  const ids = new Set<string>();
  for (const cue of scene.visualCues) {
    if (cue.template.id !== "character.standing") {
      continue;
    }
    const parsed = characterStandingV1InputSchema.safeParse(cue.input);
    if (!parsed.success) {
      continue;
    }
    const input = parsed.data as { characterId: string; appearanceId: string };
    if (input.characterId === characterId) {
      ids.add(input.appearanceId);
    }
  }
  return [...ids];
}

function localeValues<T>(
  entries: readonly T[],
  localeOf: (entry: T) => string,
): Map<string, T> {
  return new Map(entries.map((entry) => [localeOf(entry), entry]));
}

interface BuiltLibraryUpdate {
  nextDocument: ContentDocument;
  plan: LibraryUpdatePlan;
  addedAppearanceIds: string[];
}

function buildLibraryUpdate(
  document: ContentDocument,
  characterId: string,
  entry: ScriptLibraryCharacter,
  context: ScriptContext,
): BuiltLibraryUpdate {
  const character = document.characters.find((candidate) => candidate.id === characterId);
  if (character === undefined) {
    throw targetNotFound(["characterId"], `キャラクターが見つかりません: ${characterId}`);
  }
  if (character.libraryCharacterId === null) {
    throw preconditionFailed(
      ["characterId"],
      "このキャラクターはライブラリと紐づいていません。",
    );
  }
  if (character.libraryCharacterId !== entry.id) {
    throw preconditionFailed(
      ["libraryCharacterId"],
      `キャラクターのリンク先と一致しません: ${character.libraryCharacterId}`,
    );
  }

  const existingAppearanceIds = new Set(
    document.characters.flatMap((candidate) =>
      candidate.appearances.map((appearance) => appearance.id),
    ),
  );
  const libraryById = new Map(entry.appearances.map((appearance) => [appearance.id, appearance]));
  const appearances: CharacterAppearance[] = [];
  const added: LibraryUpdatePlan["appearances"]["added"] = [];
  const updated: LibraryUpdatePlan["appearances"]["updated"] = [];
  const removed: LibraryUpdatePlan["appearances"]["removed"] = [];
  const changedFaceSets = new Map<
    string,
    { faceSetId: string; version: number } | null | "unchanged"
  >();
  const matchedLibraryIds = new Set<string>();

  for (const current of character.appearances) {
    if (current.libraryAppearanceId === null) {
      appearances.push(current);
      continue;
    }
    const source = libraryById.get(current.libraryAppearanceId);
    if (source === undefined) {
      const detached: CharacterAppearance = {
        ...current,
        libraryAppearanceId: null,
      };
      appearances.push(detached);
      removed.push({
        appearanceId: current.id,
        libraryAppearanceId: current.libraryAppearanceId,
        label: current.label ?? "",
      });
      continue;
    }
    matchedLibraryIds.add(source.id);
    const after = libraryAppearanceToNext(source, context);
    const next: CharacterAppearance = {
      id: current.id,
      ...after,
      libraryAppearanceId: source.id,
    };
    appearances.push(next);
    if (!sameAppearance(comparableAppearance(current), after)) {
      updated.push({
        appearanceId: current.id,
        libraryAppearanceId: source.id,
        before: comparableAppearance(current),
        after,
      });
    }
    changedFaceSets.set(
      current.id,
      faceSetChanged(current, next)
        ? next.faceSetId === null
          ? null
          : { faceSetId: next.faceSetId, version: next.faceSetVersion ?? 1 }
        : "unchanged",
    );
  }

  const addedAppearanceIds: string[] = [];
  for (const source of entry.appearances) {
    if (matchedLibraryIds.has(source.id)) {
      continue;
    }
    const after = libraryAppearanceToNext(source, context);
    const id = context.ids.appearance(existingAppearanceIds);
    existingAppearanceIds.add(id);
    appearances.push({ id, ...after, libraryAppearanceId: source.id });
    addedAppearanceIds.push(id);
    added.push({ libraryAppearanceId: source.id, appearance: after });
  }

  const nextName = resolveCharacterName(entry, document.locale);
  const nextNames = entry.names.map((name) => ({ ...name }));
  const nextVoices = entry.voices.map((voice) => ({ ...voice }));
  const nextCharacter: Character = {
    ...character,
    name: nextName,
    names: nextNames,
    voices: nextVoices,
    appearances,
    libraryCharacterId: entry.id,
  };
  const voiceProfileId =
    entry.voices.find((voice) => voice.locale === document.locale)?.voiceProfileId ?? null;
  const nextSpeakers = document.speakers.map((speaker) =>
    speaker.characterId === characterId
      ? { ...speaker, name: nextName, voiceProfileId }
      : speaker,
  );

  const expressionResets: LibraryUpdateExpressionReset[] = [];
  const scenes = document.scenes.map((scene, sceneIndex) => {
    const appearanceIds = standingAppearanceIds(scene, characterId);
    if (appearanceIds.length === 0) {
      return scene;
    }
    const lines = scene.lines.map((line, lineIndex) => {
      if (line.speakerId === null || line.expressionId === null) {
        return line;
      }
      const speaker = nextSpeakers.find(
        (candidate) => candidate.id === line.speakerId,
      );
      if (speaker?.characterId !== characterId) {
        return line;
      }
      const invalid = appearanceIds.some((appearanceId) => {
        const changed = changedFaceSets.get(appearanceId);
        if (changed === undefined || changed === "unchanged") {
          return false;
        }
        if (changed === null) {
          return true;
        }
        // Defensive: libraryAppearanceToNext resolved this Face Set earlier,
        // so a missing latest revision should be impossible in one pass.
        const latest = context.faceSets?.latest(changed.faceSetId);
        if (latest === null || latest === undefined) {
          return true;
        }
        return !latest.expressions.some((preset) => preset.id === line.expressionId);
      });
      if (!invalid) {
        return line;
      }
      const expressionId = line.expressionId;
      expressionResets.push({
        sceneId: scene.id,
        sceneIndex,
        sceneLabel: scene.label,
        lineId: line.id,
        lineIndex,
        captionText: line.captionText,
        expressionId,
      });
      return { ...line, expressionId: null };
    });
    return { ...scene, lines };
  });

  const currentNames = localeValues(character.names, (name) => name.locale);
  const nextNameByLocale = localeValues(entry.names, (name) => name.locale);
  const allNameLocales = new Set([...currentNames.keys(), ...nextNameByLocale.keys()]);
  const currentVoices = localeValues(character.voices, (voice) => voice.locale);
  const nextVoiceByLocale = localeValues(entry.voices, (voice) => voice.locale);
  const allVoiceLocales = new Set([...currentVoices.keys(), ...nextVoiceByLocale.keys()]);

  const plan: LibraryUpdatePlan = {
    characterId,
    libraryCharacterId: entry.id,
    name:
      character.name === nextName
        ? null
        : { before: character.name, after: nextName },
    names: [...allNameLocales].sort().map((locale) => ({
      locale,
      before: currentNames.get(locale)?.name ?? null,
      after: nextNameByLocale.get(locale)?.name ?? null,
    })),
    voices: [...allVoiceLocales].sort().map((locale) => ({
      locale,
      before: currentVoices.get(locale)?.voiceProfileId ?? null,
      after: nextVoiceByLocale.get(locale)?.voiceProfileId ?? null,
    })),
    appearances: { added, updated, removed },
    expressionResets,
  };

  return {
    nextDocument: {
      ...document,
      characters: document.characters.map((candidate) =>
        candidate.id === characterId ? nextCharacter : candidate,
      ),
      speakers: nextSpeakers,
      scenes,
    },
    plan,
    addedAppearanceIds,
  };
}

/**
 * Computes the diff that "update from library" would apply. The caller shows
 * this before applying; the operation itself uses the same computation so the
 * confirmation and the result cannot drift.
 */
export function planCharacterLibraryUpdate(
  document: ContentDocument,
  characterId: string,
  entry: ScriptLibraryCharacter,
  context: ScriptContext,
): LibraryUpdatePlan {
  return buildLibraryUpdate(document, characterId, entry, context).plan;
}

/**
 * Re-imports the linked library Character into the work. Local Character,
 * Speaker and standing-cue references stay intact: matched Appearances keep
 * their local IDs, removed library Appearances are detached and kept, and only
 * an expression that the newly pinned Face Set revision no longer has is reset
 * to `null` (normal), with one warning per affected line.
 */
export function updateCharacterFromLibrary(
  document: ContentDocument,
  operation: CharacterLibraryUpdateInput,
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
  const built = buildLibraryUpdate(document, operation.characterId, entry, context);
  const warnings: Warning[] = built.plan.expressionResets.map((reset) => ({
    path: ["scenes", reset.sceneIndex, "lines", reset.lineIndex, "expressionId"],
    code: "expression_reset_to_normal",
    message: `表情「${reset.expressionId}」が更新後の表情セットにないため normal に戻しました。`,
  }));
  const sceneIds = [...new Set(built.plan.expressionResets.map((reset) => reset.sceneId))];
  const lineIds = [...new Set(built.plan.expressionResets.map((reset) => reset.lineId))];
  const speakerIds = built.nextDocument.speakers
    .filter((speaker) => speaker.characterId === operation.characterId)
    .map((speaker) => speaker.id);
  return {
    document: built.nextDocument,
    sceneIds,
    lineIds,
    cueIds: [],
    primaryId: operation.characterId,
    characterIds: [operation.characterId],
    appearanceIds: built.addedAppearanceIds,
    speakerIds,
    warnings,
  };
}

/**
 * Copies a character library entry into the document as new local entities.
 *
 * This mirrors the Web UI's "add from library" rule and never mutates the
 * library: the Character, every Appearance and the Speaker get fresh IDs, while
 * voices, names, appearance fields (including the Face Set reference) and the
 * resolved locale name are copied. The copy records its library provenance
 * (`libraryCharacterId` / `libraryAppearanceId`) and pins the latest Face Set
 * revision, so later library edits do not change the work's rendering.
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
    const next = libraryAppearanceToNext(appearance, context);
    return {
      id: appearanceId,
      ...next,
      libraryAppearanceId: appearance.id,
    };
  });

  const character: Character = {
    id: characterId,
    name: resolveCharacterName(entry, document.locale),
    names: entry.names.map((name) => ({
      locale: name.locale,
      name: name.name,
    })),
    voices: entry.voices.map((voice) => ({
      locale: voice.locale,
      voiceProfileId: voice.voiceProfileId,
    })) as CharacterVoice[],
    appearances,
    libraryCharacterId: entry.id,
  };

  const voiceProfileId =
    entry.voices.find((voice) => voice.locale === document.locale)?.voiceProfileId ?? null;
  const speakerId = context.ids.speaker(speakerIds);
  const speaker: Speaker = {
    id: speakerId,
    name: character.name,
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
