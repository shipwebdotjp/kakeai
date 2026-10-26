import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import { Trash2 } from "lucide-react";
import type { FaceSet, VoiceProfile } from "@kakeai/contracts";
import {
  createEmptyAppearance,
  type AppearanceFormValue,
  type CharacterFormValue,
  type DocumentFormValues,
} from "../content/form";
import { buttonDangerClass, buttonNeutralClass, formLabelClass, textFieldClass } from "../ui";
import { AppearanceFields } from "./AppearanceFields";

interface CharacterFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  characterIndex: number;
  voiceProfiles: VoiceProfile[];
  faceSets: Pick<FaceSet, "id" | "name" | "version">[];
  onUpdateFromLibrary?: (characterId: string) => void;
  onDelete: (index: number, character: CharacterFormValue) => void;
}

export function CharacterFields({
  control,
  register,
  getValues,
  setValue,
  characterIndex,
  voiceProfiles,
  faceSets,
  onUpdateFromLibrary,
  onDelete,
}: CharacterFieldsProps) {
  const { append, remove } = useFieldArray({
    control,
    name: `characters.${characterIndex}.appearances`,
  });
  const character = useWatch({ control, name: `characters.${characterIndex}` });
  const appearances = character?.appearances ?? [];

  const findIndex = (id: string): number =>
    appearances.findIndex((appearance) => appearance.id === id);

  const onPatch = (id: string, patch: Partial<AppearanceFormValue>) => {
    const index = findIndex(id);
    if (index === -1) {
      return;
    }
    const current = appearances[index]!;
    setValue(`characters.${characterIndex}.appearances.${index}`, { ...current, ...patch }, {
      shouldDirty: true,
    });
  };

  const onAdd = () => {
    append(createEmptyAppearance());
  };

  const onRemove = (id: string) => {
    const index = findIndex(id);
    if (index === -1) {
      return;
    }
    const characterId = getValues(`characters.${characterIndex}.id`);
    remove(index);
    getValues("scenes").forEach((scene, sceneIndex) => {
      (scene?.standings ?? []).forEach((standing, standingIndex) => {
        if (standing?.characterId === characterId && standing?.appearanceId === id) {
          setValue(
            `scenes.${sceneIndex}.standings.${standingIndex}.appearanceId`,
            null,
            { shouldDirty: true },
          );
        }
      });
    });
  };

  return (
    <div className="my-2 rounded border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          placeholder="キャラクター名"
          className={`min-w-[160px] flex-1 ${textFieldClass}`}
          {...register(`characters.${characterIndex}.name`)}
        />
        {character?.libraryCharacterId !== null &&
          character?.libraryCharacterId !== undefined &&
          onUpdateFromLibrary !== undefined && (
            <button
              type="button"
              className={buttonNeutralClass}
              onClick={() => onUpdateFromLibrary(character.id)}
            >
              ライブラリから更新
            </button>
          )}
        <button
          type="button"
          className={buttonDangerClass}
          onClick={() => {
            const current = getValues(`characters.${characterIndex}`);
            if (current !== undefined) {
              onDelete(characterIndex, current);
            }
          }}
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          削除
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className={formLabelClass}>
          声プロファイル
          <select
            className={textFieldClass}
            {...register(`characters.${characterIndex}.voiceProfileId`, {
              setValueAs: (value) => (value === "" ? null : value),
            })}
          >
            <option value="">未設定</option>
            {voiceProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name || profile.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <AppearanceFields
        appearances={appearances}
        onAdd={onAdd}
        onPatch={onPatch}
        onRemove={onRemove}
        faceSets={faceSets}
      />
    </div>
  );
}
