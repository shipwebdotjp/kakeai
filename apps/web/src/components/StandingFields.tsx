import { useEffect } from "react";
import {
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
  emptyStandingSlots,
  type CharacterFormValue,
  type DocumentFormValues,
  type StandingFormValue,
  type StandingSide,
} from "../content/form";
import { metaTextClass, textFieldClass } from "../ui";

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
  const watched = useWatch({ control, name: `scenes.${sceneIndex}.standings` });
  const isOrdered =
    watched !== undefined &&
    watched.length === STANDING_SIDES.length &&
    watched.every((entry, index) => entry?.side === STANDING_SIDES[index]);

  useEffect(() => {
    if (isOrdered) {
      return;
    }
    const bySide = new Map<StandingSide, StandingFormValue>();
    for (const entry of watched ?? []) {
      if (entry !== undefined && !bySide.has(entry.side)) {
        bySide.set(entry.side, entry);
      }
    }
    setValue(
      `scenes.${sceneIndex}.standings`,
      emptyStandingSlots().map((slot) => ({ ...(bySide.get(slot.side) ?? slot), side: slot.side })),
      { shouldDirty: false },
    );
  }, [isOrdered, watched, sceneIndex, setValue]);

  const slots = isOrdered
    ? watched ?? emptyStandingSlots()
    : emptyStandingSlots().map((slot) => {
        const found = (watched ?? []).find((entry) => entry?.side === slot.side);
        return { ...(found ?? slot), side: slot.side };
      });

  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <span className="text-sm font-medium">立ち絵</span>
      {characters.length === 0 && (
        <p className={metaTextClass}>
          この作品にキャラクターがありません。上の「キャラクター」から追加してください。
        </p>
      )}
      {STANDING_SIDES.map((side, index) => {
        const standing = slots[index];
        const characterId = standing?.characterId ?? null;
        const character = characters.find((entry) => entry.id === characterId);
        const appearances = character?.appearances ?? [];
        return (
          <div key={side} className="mt-2 rounded border border-border p-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{SIDE_LABELS[side]}</span>
              <label className="inline-flex items-center gap-1.5">
                キャラクター
                <select
                  className={textFieldClass}
                  {...register(`scenes.${sceneIndex}.standings.${index}.characterId`, {
                    setValueAs: (value) => (value === "" ? null : value),
                    onChange: (event) => {
                      const next = characters.find((entry) => entry.id === event.target.value);
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
                <>
                  <label className="inline-flex items-center gap-1.5">
                    外観
                    <select
                      className={textFieldClass}
                      disabled={appearances.length === 0}
                      {...register(`scenes.${sceneIndex}.standings.${index}.appearanceId`, {
                        setValueAs: (value) => (value === "" ? null : value),
                      })}
                    >
                      <option value="">未指定</option>
                      {appearances.map((appearance) => (
                        <option key={appearance.id} value={appearance.id}>
                          {appearanceDisplayName(appearance)}
                        </option>
                      ))}
                    </select>
                  </label>
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
                </>
              )}
            </div>
            {character !== undefined && appearances.length === 0 && (
              <p className={metaTextClass}>
                このキャラクターには外観がありません。ライブラリまたは「キャラクター」欄で外観を追加してください。
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
