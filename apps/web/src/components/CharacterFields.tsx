import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import type { VoiceProfile } from "@kakeai/contracts";
import {
  createEmptyAppearance,
  type AppearanceFormValue,
  type CharacterFormValue,
  type DocumentFormValues,
} from "../content/form";
import { buttonDangerClass, textFieldClass } from "../ui";
import { AppearanceFields } from "./AppearanceFields";

interface CharacterFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  characterIndex: number;
  voiceProfiles: VoiceProfile[];
  onDelete: (index: number, character: CharacterFormValue) => void;
}

export function CharacterFields({
  control,
  register,
  getValues,
  setValue,
  characterIndex,
  voiceProfiles,
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
          削除
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5">
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
      />
    </div>
  );
}
