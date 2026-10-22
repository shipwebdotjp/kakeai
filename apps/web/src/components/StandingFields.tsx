import { useEffect, useRef } from "react";
import {
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  DEFAULT_STANDING_SCALE,
  MAX_STANDING_SCALE,
  MIN_STANDING_SCALE,
  STANDING_SCALE_STEP,
  STANDING_SIDES,
  STANDING_TRANSITION_POLICY,
  appearanceDisplayName,
  emptyStandingSlots,
  type CharacterFormValue,
  type DocumentFormValues,
  type StandingFormValue,
  type StandingSide,
} from "../content/form";
import {
  PRESET_LABELS,
  editAreaClass,
  formLabelClass,
  itemCardClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { Collapsible } from "./Collapsible";

interface StandingFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  sceneId: string;
  characters: CharacterFormValue[];
  onCommitStanding: (side: StandingSide) => void;
}

const SIDE_LABELS: Record<StandingSide, string> = { left: "左", right: "右" };

export function StandingFields({
  control,
  register,
  getValues,
  setValue,
  sceneIndex,
  sceneId,
  characters,
  onCommitStanding,
}: StandingFieldsProps) {
  const watched = useWatch({ control, name: `scenes.${sceneIndex}.standings` });
  const snapshotRef = useRef(new Map<StandingSide, string>());
  const readSlot = (side: StandingSide): StandingFormValue | undefined =>
    (getValues(`scenes.${sceneIndex}.standings`) ?? []).find(
      (entry) => entry.side === side,
    );
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
    <div className={editAreaClass}>
      <h4 className="text-sm font-semibold text-foreground">立ち絵</h4>
      {characters.length === 0 && (
        <p className={metaTextClass}>
          この作品にキャラクターがありません。上の「キャラクター」から追加してください。
        </p>
      )}
      {STANDING_SIDES.map((side, index) => {
        const standing = slots[index];
        const characterId = standing?.characterId ?? null;
        const scale = standing?.scale ?? DEFAULT_STANDING_SCALE;
        const enterPreset = standing?.enterPreset ?? "none";
        const exitPreset = standing?.exitPreset ?? "none";
        const character = characters.find((entry) => entry.id === characterId);
        const appearances = character?.appearances ?? [];
        return (
          <div
            key={side}
            className={itemCardClass}
            onFocus={(event) => {
              const related = event.relatedTarget as Node | null;
              if (
                related !== null &&
                event.currentTarget.contains(related)
              ) {
                return;
              }
              const slot = readSlot(side);
              if (slot !== undefined) {
                snapshotRef.current.set(side, JSON.stringify(slot));
              }
            }}
            onBlur={(event) => {
              const related = event.relatedTarget as Node | null;
              if (
                related === null ||
                event.currentTarget.contains(related)
              ) {
                return;
              }
              if (
                related instanceof Element &&
                related.closest('[role="dialog"]') !== null
              ) {
                return;
              }
              const slot = readSlot(side);
              const current = slot === undefined ? "" : JSON.stringify(slot);
              if (current === (snapshotRef.current.get(side) ?? "")) {
                return;
              }
              snapshotRef.current.set(side, current);
              onCommitStanding(side);
            }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{SIDE_LABELS[side]}</span>
              <label className={formLabelClass}>
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
                <label className={formLabelClass}>
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
              )}
            </div>
            {character !== undefined && (
              <Collapsible
                title="表示の調整"
                summary={`倍率 ${scale} / 入場 ${PRESET_LABELS[enterPreset] ?? enterPreset} / 退場 ${PRESET_LABELS[exitPreset] ?? exitPreset}`}
                storageKey={`standing-${sceneId}-${side}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <label className={formLabelClass}>
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
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className={formLabelClass}>
                    入場
                    <select
                      className={textFieldClass}
                      {...register(`scenes.${sceneIndex}.standings.${index}.enterPreset`)}
                    >
                      {STANDING_TRANSITION_POLICY.presets.map((preset) => (
                        <option key={preset} value={preset}>
                          {PRESET_LABELS[preset] ?? preset}
                        </option>
                      ))}
                    </select>
                  </label>
                  {enterPreset !== "none" && (
                    <label className={formLabelClass}>
                      尺
                      <input
                        type="number"
                        min={0}
                        max={STANDING_TRANSITION_POLICY.maxDurationMs}
                        step={50}
                        className={`w-24 ${textFieldClass}`}
                        {...register(`scenes.${sceneIndex}.standings.${index}.enterDurationMs`, {
                          setValueAs: (value) =>
                            value === "" || Number.isNaN(Number(value)) ? 0 : Number(value),
                        })}
                      />
                      ms
                    </label>
                  )}
                  <label className={formLabelClass}>
                    退場
                    <select
                      className={textFieldClass}
                      {...register(`scenes.${sceneIndex}.standings.${index}.exitPreset`)}
                    >
                      {STANDING_TRANSITION_POLICY.presets.map((preset) => (
                        <option key={preset} value={preset}>
                          {PRESET_LABELS[preset] ?? preset}
                        </option>
                      ))}
                    </select>
                  </label>
                  {exitPreset !== "none" && (
                    <label className={formLabelClass}>
                      尺
                      <input
                        type="number"
                        min={0}
                        max={STANDING_TRANSITION_POLICY.maxDurationMs}
                        step={50}
                        className={`w-24 ${textFieldClass}`}
                        {...register(`scenes.${sceneIndex}.standings.${index}.exitDurationMs`, {
                          setValueAs: (value) =>
                            value === "" || Number.isNaN(Number(value)) ? 0 : Number(value),
                        })}
                      />
                      ms
                    </label>
                  )}
                </div>
              </Collapsible>
            )}
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
