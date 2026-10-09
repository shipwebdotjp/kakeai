import { Link } from "react-router-dom";
import {
  useWatch,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import { useAssets } from "../api/hooks";
import { charactersRoute } from "../lib/routes";
import {
  DEFAULT_APPEARANCE_EXPRESSION,
  DEFAULT_APPEARANCE_POSE,
  DEFAULT_STANDING_SCALE,
  DEFAULT_STANDING_X,
  DEFAULT_STANDING_Y,
  MAX_STANDING_SCALE,
  MIN_STANDING_SCALE,
  STANDING_SCALE_STEP,
  type CharacterFormValue,
  type DocumentFormValues,
} from "../content/form";
import { buttonNeutralClass, metaTextClass, textFieldClass } from "../ui";

interface StandingFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  characters: CharacterFormValue[];
  workId: string;
}

export function StandingFields({
  control,
  register,
  setValue,
  sceneIndex,
  characters,
  workId,
}: StandingFieldsProps) {
  const characterId = useWatch({
    control,
    name: `scenes.${sceneIndex}.standingCharacterId`,
  });
  const appearanceId = useWatch({
    control,
    name: `scenes.${sceneIndex}.standingAppearanceId`,
  });
  const assets = useAssets();

  const character = characters.find((entry) => entry.id === characterId);
  const appearances = character?.appearances ?? [];
  const selectedAppearance = appearances.find((entry) => entry.id === appearanceId);
  const selected = characterId !== null && selectedAppearance !== undefined;

  const fileName = (assetId: string | null): string | null => {
    if (assetId === null) {
      return null;
    }
    return assets.data?.find((asset) => asset.id === assetId)?.originalFilename ?? assetId;
  };

  const onCharacterChange = (nextId: string) => {
    const next = characters.find((entry) => entry.id === nextId);
    const nextAppearanceId = next?.appearances[0]?.id ?? null;
    const hadSelection = characterId !== null && characterId !== undefined;
    setValue(`scenes.${sceneIndex}.standingCharacterId`, next?.id ?? null, {
      shouldDirty: true,
    });
    setValue(`scenes.${sceneIndex}.standingAppearanceId`, nextAppearanceId, {
      shouldDirty: true,
    });
    if (!hadSelection && next !== undefined) {
      setValue(`scenes.${sceneIndex}.standingX`, DEFAULT_STANDING_X, { shouldDirty: true });
      setValue(`scenes.${sceneIndex}.standingY`, DEFAULT_STANDING_Y, { shouldDirty: true });
      setValue(`scenes.${sceneIndex}.standingScale`, DEFAULT_STANDING_SCALE, {
        shouldDirty: true,
      });
    }
  };

  const onClear = () => {
    setValue(`scenes.${sceneIndex}.standingCharacterId`, null, { shouldDirty: true });
    setValue(`scenes.${sceneIndex}.standingAppearanceId`, null, { shouldDirty: true });
  };

  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">立ち絵</span>
        {selected && (
          <button type="button" className={buttonNeutralClass} onClick={onClear}>
            解除
          </button>
        )}
      </div>

      {characters.length === 0 ? (
        <p className={metaTextClass}>
          キャラクターが登録されていません。
          <Link
            to={charactersRoute(workId)}
            className="text-brand-700 hover:underline dark:text-brand-400"
          >
            キャラクター管理
          </Link>
          で登録してください。
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5">
              キャラクター
              <select
                className={textFieldClass}
                value={characterId ?? ""}
                onChange={(event) => onCharacterChange(event.target.value)}
              >
                <option value="">未指定</option>
                {characters.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name.length > 0 ? entry.name : entry.id}
                  </option>
                ))}
              </select>
            </label>
            {character !== undefined && (
              <label className="inline-flex items-center gap-1.5">
                外観
                <select
                  className={textFieldClass}
                  value={appearanceId ?? ""}
                  disabled={appearances.length === 0}
                  onChange={(event) => {
                    const nextAppearanceId =
                      event.target.value === "" ? null : event.target.value;
                    setValue(
                      `scenes.${sceneIndex}.standingAppearanceId`,
                      nextAppearanceId,
                      { shouldDirty: true },
                    );
                    if (nextAppearanceId === null) {
                      setValue(`scenes.${sceneIndex}.standingCharacterId`, null, {
                        shouldDirty: true,
                      });
                    }
                  }}
                >
                  <option value="">未指定</option>
                  {appearances.map((appearance) => {
                    const expression =
                      appearance.expression.trim() || DEFAULT_APPEARANCE_EXPRESSION;
                    const pose = appearance.pose.trim() || DEFAULT_APPEARANCE_POSE;
                    const file = fileName(appearance.assetId);
                    return (
                      <option key={appearance.id} value={appearance.id}>
                        {expression} / {pose}
                        {file !== null ? `（${file}）` : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
          </div>

          {character !== undefined && appearances.length === 0 && (
            <p className={metaTextClass}>
              このキャラクターには外観がありません。
              <Link
                to={charactersRoute(workId)}
                className="text-brand-700 hover:underline dark:text-brand-400"
              >
                キャラクター管理
              </Link>
              で追加してください。
            </p>
          )}

          {selected && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5">
                  x
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    className={`w-24 ${textFieldClass}`}
                    {...register(`scenes.${sceneIndex}.standingX`, { valueAsNumber: true })}
                  />
                </label>
                <label className="inline-flex items-center gap-1.5">
                  y
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    className={`w-24 ${textFieldClass}`}
                    {...register(`scenes.${sceneIndex}.standingY`, { valueAsNumber: true })}
                  />
                </label>
                <label className="inline-flex items-center gap-1.5">
                  倍率
                  <input
                    type="number"
                    min={MIN_STANDING_SCALE}
                    max={MAX_STANDING_SCALE}
                    step={STANDING_SCALE_STEP}
                    className={`w-24 ${textFieldClass}`}
                    {...register(`scenes.${sceneIndex}.standingScale`, {
                      valueAsNumber: true,
                    })}
                  />
                </label>
              </div>
              <p className={metaTextClass}>
                位置は画面内の正規化座標（0〜1、画像の中心）、倍率は幅480px基準です。
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
