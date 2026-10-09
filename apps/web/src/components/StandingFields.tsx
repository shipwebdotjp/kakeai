import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  DEFAULT_STANDING_SCALE,
  MAX_STANDING_SCALE,
  MIN_STANDING_SCALE,
  STANDING_SCALE_STEP,
  STANDING_SIDES,
  appearanceDisplayName,
  type CharacterFormValue,
  type DocumentFormValues,
  type StandingSide,
} from "../content/form";
import { buttonNeutralClass, metaTextClass, textFieldClass } from "../ui";

interface StandingFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  characters: CharacterFormValue[];
}

const SIDE_LABELS: Record<StandingSide, string> = { left: "左", right: "右" };

export function StandingFields({
  control,
  register,
  setValue,
  sceneIndex,
  characters,
}: StandingFieldsProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `scenes.${sceneIndex}.standings`,
  });
  const standings = useWatch({ control, name: `scenes.${sceneIndex}.standings` }) ?? [];
  const usedSides = new Set(standings.map((standing) => standing?.side));
  const canAdd = fields.length < STANDING_SIDES.length;

  const onAdd = () => {
    const side = STANDING_SIDES.find((candidate) => !usedSides.has(candidate));
    if (side === undefined) {
      return;
    }
    append({
      cueId: null,
      characterId: null,
      appearanceId: null,
      side,
      scale: DEFAULT_STANDING_SCALE,
    });
  };

  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <span className="text-sm font-medium">立ち絵</span>
      {characters.length === 0 ? (
        <p className={metaTextClass}>
          この作品にキャラクターがありません。上の「キャラクター」から追加してください。
        </p>
      ) : (
        <>
          {fields.map((field, index) => {
            const standing = standings[index];
            const characterId = standing?.characterId ?? null;
            const character = characters.find((entry) => entry.id === characterId);
            const appearances = character?.appearances ?? [];
            const sideValue = standing?.side ?? "left";
            return (
              <div key={field.id} className="mt-2 rounded border border-border p-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">{SIDE_LABELS[sideValue]}</span>
                  <label className="inline-flex items-center gap-1.5">
                    位置
                    <select
                      className={textFieldClass}
                      {...register(`scenes.${sceneIndex}.standings.${index}.side`)}
                    >
                      {STANDING_SIDES.map((candidate) => (
                        <option
                          key={candidate}
                          value={candidate}
                          disabled={candidate !== sideValue && usedSides.has(candidate)}
                        >
                          {SIDE_LABELS[candidate]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    キャラクター
                    <select
                      className={textFieldClass}
                      {...register(`scenes.${sceneIndex}.standings.${index}.characterId`, {
                        setValueAs: (value) => (value === "" ? null : value),
                        onChange: (event) => {
                          const next = characters.find(
                            (entry) => entry.id === event.target.value,
                          );
                          setValue(
                            `scenes.${sceneIndex}.standings.${index}.appearanceId`,
                            next?.appearances[0]?.id ?? null,
                            { shouldDirty: true },
                          );
                        },
                      })}
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
                        disabled={appearances.length === 0}
                        {...register(
                          `scenes.${sceneIndex}.standings.${index}.appearanceId`,
                          { setValueAs: (value) => (value === "" ? null : value) },
                        )}
                      >
                        <option value="">未指定</option>
                        {appearances.map((appearance) => (
                          <option key={appearance.id} value={appearance.id}>
                            {appearanceDisplayName(appearance)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="inline-flex items-center gap-1.5">
                    倍率
                    <input
                      type="number"
                      min={MIN_STANDING_SCALE}
                      max={MAX_STANDING_SCALE}
                      step={STANDING_SCALE_STEP}
                      className={`w-24 ${textFieldClass}`}
                      {...register(`scenes.${sceneIndex}.standings.${index}.scale`, {
                        setValueAs: (value) =>
                          value === "" || Number.isNaN(Number(value))
                            ? DEFAULT_STANDING_SCALE
                            : Number(value),
                      })}
                    />
                  </label>
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    onClick={() => remove(index)}
                  >
                    解除
                  </button>
                </div>
                {character !== undefined && appearances.length === 0 && (
                  <p className={metaTextClass}>
                    このキャラクターには外観がありません。ライブラリまたは「キャラクター」欄で外観を追加してください。
                  </p>
                )}
              </div>
            );
          })}

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={buttonNeutralClass}
              disabled={!canAdd}
              onClick={onAdd}
            >
              立ち絵を追加
            </button>
            {!canAdd && (
              <span className={metaTextClass}>
                1シーンに左右1体ずつ、最大2体までです。話している立ち絵が発話中に上下します。
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
