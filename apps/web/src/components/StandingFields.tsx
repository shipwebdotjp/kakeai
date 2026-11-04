import { ArrowRightLeft, CopyPlus, Plus, Repeat, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  DEFAULT_STANDING_EDGE,
  DEFAULT_STANDING_SCALE,
  DEFAULT_STANDING_VERTICAL,
  STANDING_EDGE_OPTIONS,
  STANDING_SIDES,
  STANDING_TRANSITION_POLICY,
  STANDING_VERTICAL_OPTIONS,
  appearanceDisplayName,
  emptyStandingSlots,
  lineOptionLabel,
  resolveStandingStateFormAtLine,
  sortStandingStateFormValues,
  type CharacterFormValue,
  type DocumentFormValues,
  type LineFormValue,
  type SpeakerFormValue,
  type StandingFormValue,
  type StandingSide,
} from "../content/form";
import {
  resolveStandingLayout,
  type ContentDocument,
  type Warning,
} from "@kakeai/contracts";
import { commitStandingStateStructural } from "../content/structural";
import {
  PRESET_LABELS,
  buttonDangerClass,
  buttonNeutralClass,
  editAreaClass,
  formLabelClass,
  itemCardClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { IconMenu, iconMenuItemClass } from "./IconMenu";
import { Collapsible } from "./Collapsible";

interface StandingFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  sceneId: string;
  lines: readonly LineFormValue[];
  characters: CharacterFormValue[];
  speakers: readonly SpeakerFormValue[];
  base: ContentDocument;
  onWarnings: (warnings: Warning[]) => void;
  onError: (message: string) => void;
  onCommitStanding: (side: StandingSide) => void;
  onMoveStandings: (() => void) | null;
  onCopyStandings: (() => void) | null;
  onSwapStandings: (() => void) | null;
}

const SIDE_LABELS: Record<StandingSide, string> = { left: "左", right: "右" };

function lineLabel(
  lines: readonly LineFormValue[],
  speakers: readonly SpeakerFormValue[],
  lineId: string,
): string {
  const index = lines.findIndex((line) => line.id === lineId);
  if (index === -1) {
    return lineId;
  }
  return lineOptionLabel(lines, index, speakers);
}

export function StandingFields({
  control,
  register,
  getValues,
  setValue,
  sceneIndex,
  sceneId,
  lines,
  characters,
  speakers,
  base,
  onWarnings,
  onError,
  onCommitStanding,
  onMoveStandings,
  onCopyStandings,
  onSwapStandings,
}: StandingFieldsProps) {
  const watched = useWatch({ control, name: `scenes.${sceneIndex}.standings` });
  const watchedStates =
    useWatch({ control, name: `scenes.${sceneIndex}.standingStates` }) ?? [];
  const [addLineId, setAddLineId] = useState(lines[0]?.id ?? "");
  const [addSide, setAddSide] = useState<StandingSide>("left");
  const snapshotRef = useRef(new Map<StandingSide, string>());
  const readSlot = (side: StandingSide): StandingFormValue | undefined =>
    (getValues(`scenes.${sceneIndex}.standings`) ?? []).find(
      (entry) => entry.side === side,
    );
  const commitState = (side: StandingSide, fromLineId: string): void => {
    try {
      const next = commitStandingStateStructural(
        base,
        getValues(),
        sceneId,
        side,
        fromLineId,
        [],
      );
      if (next === null) {
        return;
      }
      const nextScene = next.values.scenes.find((entry) => entry.id === sceneId);
      if (nextScene !== undefined) {
        setValue(
          `scenes.${sceneIndex}.standingStates`,
          nextScene.standingStates,
          { shouldDirty: true },
        );
      }
      onWarnings(next.result.warnings);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "立ち絵状態の更新に失敗しました。",
      );
    }
  };
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

  useEffect(() => {
    if (lines.length === 0) {
      setAddLineId("");
      return;
    }
    if (lines.some((line) => line.id === addLineId)) {
      return;
    }
    const used = new Set(
      watchedStates
        .filter((state) => state.side === addSide)
        .map((state) => state.fromLineId),
    );
    const free = lines.find((line) => !used.has(line.id));
    const fallback = free ?? lines[0];
    if (fallback !== undefined) {
      setAddLineId(fallback.id);
    }
  }, [addLineId, addSide, lines, watchedStates]);

  const slots = isOrdered
    ? watched ?? emptyStandingSlots()
    : emptyStandingSlots().map((slot) => {
        const found = (watched ?? []).find((entry) => entry?.side === slot.side);
        return { ...(found ?? slot), side: slot.side };
      });

  const seenStateKeys = new Set<string>();
  const sortedStates = sortStandingStateFormValues({
    lines,
    standings: slots,
    standingStates: watchedStates,
  })
    .filter((state) => {
      const key = `${state.side}|${state.fromLineId}`;
      if (seenStateKeys.has(key)) {
        return false;
      }
      seenStateKeys.add(key);
      return true;
    })
    .map((state) => ({
      state,
      index: watchedStates.findIndex(
        (entry) => entry.side === state.side && entry.fromLineId === state.fromLineId,
      ),
    }));
  const addDuplicate = watchedStates.some(
    (state) => state.side === addSide && state.fromLineId === addLineId,
  );

  const applyAppearanceLayout = (
    index: number,
    appearance: CharacterFormValue["appearances"][number] | undefined,
  ): void => {
    const layout = resolveStandingLayout(appearance);
    setValue(
      `scenes.${sceneIndex}.standings.${index}.appearanceId`,
      appearance?.id ?? null,
      { shouldDirty: true },
    );
    setValue(
      `scenes.${sceneIndex}.standings.${index}.scale`,
      layout.scale,
      { shouldDirty: true },
    );
    setValue(
      `scenes.${sceneIndex}.standings.${index}.edge`,
      layout.edge,
      { shouldDirty: true },
    );
    setValue(
      `scenes.${sceneIndex}.standings.${index}.vertical`,
      layout.vertical,
      { shouldDirty: true },
    );
    setValue(
      `scenes.${sceneIndex}.standings.${index}.layoutOverridden`,
      false,
      { shouldDirty: true },
    );
  };

  const addState = () => {
    if (lines.length === 0 || addDuplicate || addLineId.length === 0) {
      return;
    }
    setValue(
      `scenes.${sceneIndex}.standingStates`,
      [
        ...watchedStates,
        {
          side: addSide,
          fromLineId: addLineId,
          characterId: null,
          appearanceId: null,
        },
      ],
      { shouldDirty: true },
    );
    commitState(addSide, addLineId);
  };

  const removeState = (side: StandingSide, fromLineId: string) => {
    setValue(
      `scenes.${sceneIndex}.standingStates`,
      watchedStates.filter(
        (state) => !(state.side === side && state.fromLineId === fromLineId),
      ),
      { shouldDirty: true },
    );
    commitState(side, fromLineId);
  };

  return (
    <div className={editAreaClass}>
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold text-foreground">立ち絵</h4>
        {(onMoveStandings !== null || onCopyStandings !== null || onSwapStandings !== null) && (
          <span className="ml-auto">
            <IconMenu label="立ち絵の操作">
              {(close) => (
                <>
                  {onMoveStandings !== null && (
                    <button
                      type="button"
                      role="menuitem"
                      className={iconMenuItemClass}
                      onClick={() => {
                        close();
                        onMoveStandings();
                      }}
                    >
                      <ArrowRightLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
                      別のシーンへ移動
                    </button>
                  )}
                  {onCopyStandings !== null && (
                    <button
                      type="button"
                      role="menuitem"
                      className={iconMenuItemClass}
                      onClick={() => {
                        close();
                        onCopyStandings();
                      }}
                    >
                      <CopyPlus aria-hidden="true" className="h-4 w-4 shrink-0" />
                      別のシーンへ複製
                    </button>
                  )}
                  {onSwapStandings !== null && (
                    <button
                      type="button"
                      role="menuitem"
                      className={iconMenuItemClass}
                      onClick={() => {
                        close();
                        onSwapStandings();
                      }}
                    >
                      <Repeat aria-hidden="true" className="h-4 w-4 shrink-0" />
                      別のシーンと入れ替え
                    </button>
                  )}
                </>
              )}
            </IconMenu>
          </span>
        )}
      </div>
      <p className={metaTextClass}>シーン開始時</p>
      {characters.length === 0 && (
        <p className={metaTextClass}>
          この作品にキャラクターがありません。上の「キャラクター」から追加してください。
        </p>
      )}
      {STANDING_SIDES.map((side, index) => {
        const standing = slots[index];
        const characterId = standing?.characterId ?? null;
        const scale = standing?.scale ?? DEFAULT_STANDING_SCALE;
        const edge = standing?.edge ?? DEFAULT_STANDING_EDGE;
        const vertical = standing?.vertical ?? DEFAULT_STANDING_VERTICAL;
        const edgeLabel = STANDING_EDGE_OPTIONS.find((entry) => entry.value === edge)?.label ?? edge;
        const verticalLabel = STANDING_VERTICAL_OPTIONS.find((entry) => entry.value === vertical)?.label ?? vertical;
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
                      applyAppearanceLayout(index, next?.appearances[0]);
                      onCommitStanding(side);
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
                      onChange: (event) => {
                        const nextAppearance = appearances.find(
                          (entry) => entry.id === event.target.value,
                        );
                        applyAppearanceLayout(index, nextAppearance);
                        onCommitStanding(side);
                      },
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
                summary={`倍率 ${scale} / 端 ${edgeLabel} / 高さ ${verticalLabel} / 入場 ${PRESET_LABELS[enterPreset] ?? enterPreset} / 退場 ${PRESET_LABELS[exitPreset] ?? exitPreset}`}
                storageKey={`standing-${sceneId}-${side}`}
              >
                {standing?.layoutOverridden === true && (
                  <p className={metaTextClass}>
                    このシーンには旧形式の明示値があります。
                  </p>
                )}
                {standing?.layoutOverridden === true && (
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    onClick={() => {
                      setValue(
                        `scenes.${sceneIndex}.standings.${index}.layoutOverridden`,
                        false,
                        { shouldDirty: true },
                      );
                      onCommitStanding(side);
                    }}
                  >
                    外観の標準に戻す
                  </button>
                )}
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

      {lines.length > 0 && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">セリフごとの変更</p>
          </div>
          <div className={`${itemCardClass} flex flex-wrap items-end gap-2`}>
            <label className={formLabelClass}>
              対象セリフ
              <select
                className={textFieldClass}
                value={addLineId}
                onChange={(event) => setAddLineId(event.target.value)}
              >
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {lineLabel(lines, speakers, line.id)}
                  </option>
                ))}
              </select>
            </label>
            <label className={formLabelClass}>
              側
              <select
                className={textFieldClass}
                value={addSide}
                onChange={(event) =>
                  setAddSide(event.target.value as StandingSide)
                }
              >
                {STANDING_SIDES.map((side) => (
                  <option key={side} value={side}>
                    {SIDE_LABELS[side]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={buttonNeutralClass}
              disabled={addDuplicate || addLineId.length === 0}
              onClick={addState}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              変更を追加
            </button>
            {addDuplicate && (
              <span className={metaTextClass}>
                このセリフと側には既に変更があります。
              </span>
            )}
          </div>
          {sortedStates.map(({ state, index }) => {
            const character = characters.find(
              (entry) => entry.id === state.characterId,
            );
            const appearances = character?.appearances ?? [];
            const effective = resolveStandingStateFormAtLine(
              {
                lines,
                standings: slots,
                standingStates: watchedStates,
              },
              state.side,
              state.fromLineId,
            );
            const hidden =
              state.characterId === null || state.appearanceId === null;
            return (
              <div key={`${state.side}-${state.fromLineId}`} className={itemCardClass}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {SIDE_LABELS[state.side]} / {lineLabel(lines, speakers, state.fromLineId)}
                  </span>
                  {effective?.isChange === true && (
                    <span className={metaTextClass}>この行から</span>
                  )}
                  <button
                    type="button"
                    className={`ml-auto ${buttonDangerClass}`}
                    onClick={() => removeState(state.side, state.fromLineId)}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                    変更を削除
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <label className={formLabelClass}>
                    キャラクター
                    <select
                      className={textFieldClass}
                      value={state.characterId ?? ""}
                      onChange={(event) => {
                        const nextId =
                          event.target.value === "" ? null : event.target.value;
                        const next = characters.find(
                          (entry) => entry.id === nextId,
                        );
                        const nextAppearance = next?.appearances[0]?.id ?? null;
                        setValue(
                          `scenes.${sceneIndex}.standingStates.${index}.characterId`,
                          nextId,
                          { shouldDirty: true },
                        );
                        setValue(
                          `scenes.${sceneIndex}.standingStates.${index}.appearanceId`,
                          nextAppearance,
                          { shouldDirty: true },
                        );
                        commitState(state.side, state.fromLineId);
                      }}
                    >
                      <option value="">非表示</option>
                      {characters.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name.length > 0 ? entry.name : entry.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!hidden && (
                    <label className={formLabelClass}>
                      外観
                      <select
                        className={textFieldClass}
                        value={state.appearanceId ?? ""}
                        onChange={(event) => {
                          setValue(
                            `scenes.${sceneIndex}.standingStates.${index}.appearanceId`,
                            event.target.value === ""
                              ? null
                              : event.target.value,
                            { shouldDirty: true },
                          );
                          commitState(state.side, state.fromLineId);
                        }}
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
                  {!hidden && appearances.length === 0 && (
                    <span className={metaTextClass}>
                      このキャラクターには外観がありません。
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
