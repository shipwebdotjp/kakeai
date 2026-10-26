import {
  resolveCharacterName,
  type CharacterLibraryEntry,
  type ContentDocument,
  type FaceSet,
} from "@kakeai/contracts";
import {
  newAppearanceId,
  newCharacterId,
  type CharacterFormValue,
} from "../../content/form";

export interface LibraryCharacterCopy {
  character: CharacterFormValue;
  resolvedName: string;
  voiceProfileId: string | null;
}

/**
 * Builds the work-local copy of a library Character. Returns null when a Face
 * Set referenced by the library entry is not loaded yet, because the copy must
 * pin a concrete revision.
 */
export function buildLibraryCharacterCopy(
  entry: CharacterLibraryEntry,
  faceSets: readonly FaceSet[],
  locale: ContentDocument["locale"],
): LibraryCharacterCopy | null {
  const faceSetById = new Map(faceSets.map((faceSet) => [faceSet.id, faceSet]));
  const unresolved = entry.appearances.find(
    (appearance) =>
      appearance.faceSetId !== null &&
      faceSetById.get(appearance.faceSetId) === undefined,
  );
  if (unresolved !== undefined) {
    return null;
  }
  const resolvedName = resolveCharacterName(entry, locale);
  const voiceProfileId =
    entry.voices.find((voice) => voice.locale === locale)?.voiceProfileId ?? null;
  return {
    resolvedName,
    voiceProfileId,
    character: {
      id: newCharacterId(),
      name: resolvedName,
      names: entry.names.map((name) => ({ ...name })),
      voiceProfileId,
      voices: entry.voices.map((voice) => ({ ...voice })),
      appearances: entry.appearances.map((appearance) => ({
        id: newAppearanceId(),
        assetId: appearance.assetId,
        expression: appearance.expression,
        pose: appearance.pose,
        label: appearance.label ?? "",
        faceSetId: appearance.faceSetId,
        faceSetVersion:
          appearance.faceSetId === null
            ? null
            : (faceSetById.get(appearance.faceSetId)?.version ?? 1),
        libraryAppearanceId: appearance.id,
      })),
      libraryCharacterId: entry.id,
    },
  };
}

export function buildVoiceOnlyCharacter(): CharacterFormValue {
  return {
    id: newCharacterId(),
    name: "ナレーター",
    names: [],
    voiceProfileId: null,
    voices: [],
    appearances: [],
    libraryCharacterId: null,
  };
}

export function characterUsageText(usage: {
  lines: number;
  standing: number;
  scenes: number;
}): string {
  const details: string[] = [];
  if (usage.lines > 0) {
    details.push(`セリフ ${usage.lines} 件`);
  }
  if (usage.standing > 0) {
    details.push(`立ち絵 ${usage.standing} 件（${usage.scenes} シーン）`);
  }
  return details.length === 0
    ? ""
    : `\n使用中: ${details.join("、")}。保存するとこれらの参照を解除します。`;
}

export function libraryCopyFailureMessage(
  loading: boolean,
  failed: boolean,
): string {
  if (loading) {
    return "表情セットの情報を読み込めません。読み込み完了後にもう一度追加してください。";
  }
  if (failed) {
    return "表情セットを読み込めませんでした。再読み込みしてから追加してください。";
  }
  return "ライブラリの参照する表情セットが見つかりません。表情セットの設定を確認してください。";
}
