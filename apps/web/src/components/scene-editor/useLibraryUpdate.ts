import { useState } from "react";
import type {
  CharacterLibraryEntry,
  ContentDocument,
  FaceSet,
  Warning,
} from "@kakeai/contracts";
import {
  planCharacterLibraryUpdate,
  type LibraryUpdatePlan,
} from "@kakeai/script-edits";
import type {
  UseFormGetValues,
  UseFormSetValue,
} from "react-hook-form";
import type { CharacterFormValue, DocumentFormValues, SceneFormValue } from "../../content/form";
import {
  applyCharacterLibraryUpdateStructural,
  buildStructuralOrNull,
  createStructuralScriptContext,
  type StructuralAsset,
  type StructuralScriptContextExtras,
} from "../../content/structural";

interface UseLibraryUpdateOptions {
  base: ContentDocument;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  replaceScenes: (scenes: SceneFormValue[]) => void;
  assets: readonly StructuralAsset[];
  libraryEntries: readonly CharacterLibraryEntry[] | undefined;
  faceSets: readonly FaceSet[] | undefined;
  showMessage: (message: string) => void;
  showError: (error: unknown) => void;
  showWarnings: (warnings: Warning[]) => void;
}

/**
 * Drives the explicit "update from library" flow. The plan is computed from the
 * current form values before applying, so the confirmation lists exactly the
 * changes and affected lines that the operation will produce.
 */
export function useLibraryUpdate({
  base,
  getValues,
  setValue,
  replaceScenes,
  assets,
  libraryEntries,
  faceSets,
  showMessage,
  showError,
  showWarnings,
}: UseLibraryUpdateOptions) {
  const [libraryUpdate, setLibraryUpdate] = useState<{
    characterId: string;
    libraryCharacterId: string;
    plan: LibraryUpdatePlan;
    extras: StructuralScriptContextExtras;
  } | null>(null);

  const scriptContext = () => {
    const entries = new Map((libraryEntries ?? []).map((entry) => [entry.id, entry]));
    const sets = new Map((faceSets ?? []).map((faceSet) => [faceSet.id, faceSet]));
    return createStructuralScriptContext(assets, {
      libraryCharacters: { get: (characterId) => entries.get(characterId) ?? null },
      faceSets: {
        latest: (faceSetId) => {
          const faceSet = sets.get(faceSetId);
          return faceSet === undefined
            ? null
            : {
                id: faceSet.id,
                version: faceSet.version,
                expressions: faceSet.expressions,
              };
        },
      },
    });
  };

  const openLibraryUpdate = (characterId: string) => {
    const character = getValues("characters").find(
      (entry: CharacterFormValue) => entry.id === characterId,
    );
    if (character === undefined) {
      return;
    }
    if (character.libraryCharacterId === null) {
      showMessage("このキャラクターはライブラリと紐づいていません。");
      return;
    }
    const entry = libraryEntries?.find(
      (candidate) => candidate.id === character.libraryCharacterId,
    );
    if (entry === undefined) {
      showMessage("ライブラリのキャラクターが見つかりません。");
      return;
    }
    const document = buildStructuralOrNull(base, getValues());
    if (document === null) {
      showMessage("現在の編集内容から差分を作れませんでした。入力を確認してください。");
      return;
    }
    try {
      const context = scriptContext();
      setLibraryUpdate({
        characterId,
        libraryCharacterId: entry.id,
        plan: planCharacterLibraryUpdate(document, characterId, entry, context),
        extras: {
          libraryCharacters: context.libraryCharacters,
          faceSets: context.faceSets,
        },
      });
    } catch (error) {
      showError(error);
    }
  };

  const applyLibraryUpdate = () => {
    if (libraryUpdate === null) {
      return;
    }
    try {
      const next = applyCharacterLibraryUpdateStructural(
        base,
        getValues(),
        {
          characterId: libraryUpdate.characterId,
          libraryCharacterId: libraryUpdate.libraryCharacterId,
        },
        assets,
        libraryUpdate.extras,
      );
      replaceScenes(next.values.scenes);
      setValue("characters", next.values.characters, { shouldDirty: true });
      setValue("speakers", next.values.speakers, { shouldDirty: true });
      showWarnings(next.result.warnings);
      setLibraryUpdate(null);
    } catch (error) {
      showError(error);
    }
  };

  return {
    libraryUpdate,
    openLibraryUpdate,
    applyLibraryUpdate,
    cancelLibraryUpdate: () => setLibraryUpdate(null),
  };
}
