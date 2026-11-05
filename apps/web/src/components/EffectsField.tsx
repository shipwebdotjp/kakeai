import { EMPHASIZE_STYLES } from "@kakeai/contracts";
import { lineOptionLabel, type LineFormValue, type SpeakerFormValue } from "../content/form";
import type { ChartLineChoice } from "../content/chart-line";
import {
  buttonNeutralClass,
  errorTextClass,
  formLabelClass,
  formLabelTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { EffectConfigField, type EffectVariant } from "./EffectConfigField";

type Json = Record<string, unknown>;

const EFFECT_HINTS: Record<EffectVariant, string> = {
  stat: "セリフ区間を契機に、開始値から「数値（カウント後の値）」までカウントします。",
  table: "セリフ区間を契機に、対象の行・セルを登場・強調・数値カウントします。",
  chart: "セリフ区間を契機に、対象の棒を登場・強調・数値カウントします。",
  line: "セリフ区間を契機に、折れ線・点を描画・強調・数値カウントします。",
  flow: "セリフ区間を契機に、対象のノードを登場・強調します。",
  quote: "セリフ区間を契機に、引用を登場・強調します。",
  chat: "セリフ区間を契機に、対象のメッセージを登場・強調します。",
  terminal: "セリフ区間を契機に、入力のタイプ表示と出力の表示を始めます。",
};

interface EffectsFieldProps {
  label: string;
  fieldKey: string;
  variant: EffectVariant;
  value: string;
  setField: (key: string, value: string) => void;
  lines: LineFormValue[];
  speakers: SpeakerFormValue[];
  messageLabels?: string[];
  turnLabels?: string[];
  lineSeries?: ChartLineChoice[];
  lineCategories?: ChartLineChoice[];
  lineValueLabels?: boolean;
}

const TARGET_OPTIONS: Record<EffectVariant, readonly { value: string; label: string }[]> = {
  table: [
    { value: "cell", label: "セル" },
    { value: "row", label: "行" },
    { value: "rows", label: "全行" },
    { value: "columns", label: "全列" },
  ],
  chart: [
    { value: "category", label: "カテゴリ" },
    { value: "series", label: "系列" },
    { value: "bars", label: "全棒" },
  ],
  line: [
    { value: "allSeries", label: "全系列" },
    { value: "series", label: "系列" },
    { value: "category", label: "カテゴリ" },
    { value: "point", label: "個別点" },
  ],
  flow: [
    { value: "node", label: "ノード" },
    { value: "nodes", label: "全ノード" },
  ],
  stat: [],
  quote: [],
  chat: [
    { value: "message", label: "メッセージ" },
    { value: "messages", label: "全メッセージ" },
  ],
  terminal: [{ value: "turn", label: "ターン" }],
};

const TRIGGER_OPTIONS = [
  { value: "cue", label: "映像演出全体" },
  { value: "lines", label: "セリフ区間" },
] as const;

function parseEntries(value: string): Json[] | null {
  if (value.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as Json[]) : null;
  } catch {
    return null;
  }
}

function normalizeTarget(
  kind: string,
  previous: Json,
  variant: EffectVariant,
): Json {
  if (kind === "cell") {
    return { kind, row: Number(previous.row) || 0, key: String(previous.key ?? "") };
  }
  if (kind === "point") {
    return {
      kind,
      categoryKey: String(previous.categoryKey ?? ""),
      seriesKey: String(previous.seriesKey ?? ""),
    };
  }
  if (kind === "series" || kind === "category") {
    return variant === "line"
      ? { kind, [`${kind}Key`]: String(previous[`${kind}Key`] ?? "") }
      : { kind, index: Number(previous.index) || 0 };
  }
  if (
    kind === "row" ||
    kind === "node" ||
    kind === "message" ||
    kind === "turn"
  ) {
    return { kind, index: Number(previous.index) || 0 };
  }
  return { kind };
}

function fillLineTargetKeys(
  target: Json,
  series: readonly ChartLineChoice[],
  categories: readonly ChartLineChoice[],
): Json {
  if (target.kind === "series" && String(target.seriesKey ?? "").length === 0) {
    return { ...target, seriesKey: series[0]?.key ?? "" };
  }
  if (target.kind === "category" && String(target.categoryKey ?? "").length === 0) {
    return { ...target, categoryKey: categories[0]?.key ?? "" };
  }
  if (target.kind === "point") {
    return {
      ...target,
      categoryKey: String(target.categoryKey ?? "").length > 0
        ? target.categoryKey
        : (categories[0]?.key ?? ""),
      seriesKey: String(target.seriesKey ?? "").length > 0
        ? target.seriesKey
        : (series[0]?.key ?? ""),
    };
  }
  return target;
}

function allowedLineEffectKinds(targetKind: string): readonly string[] {
  if (targetKind === "allSeries") {
    return ["appear", "value"];
  }
  if (targetKind === "series") {
    return ["appear", "emphasize", "value"];
  }
  return ["emphasize", "value"];
}

function fallbackLineEffect(targetKind: string): Json {
  if (targetKind === "allSeries" || targetKind === "series") {
    return { kind: "appear", preset: "draw", durationMs: 600 };
  }
  return { kind: "emphasize", style: "frame", tone: "primary" };
}

function defaultEntry(variant: EffectVariant): Json {
  if (variant === "stat") {
    return { trigger: { kind: "cue" }, effect: { kind: "value" } };
  }
  if (variant === "quote") {
    return { trigger: { kind: "cue" }, effect: { kind: "emphasize", style: "frame", tone: "primary" } };
  }
  if (variant === "terminal") {
    return {
      target: { kind: "turn", index: 0 },
      trigger: { kind: "cue" },
      effect: { kind: "reveal", mode: "type" },
    };
  }
  if (variant === "line") {
    return {
      target: { kind: "allSeries" },
      trigger: { kind: "cue" },
      effect: { kind: "appear", preset: "draw", durationMs: 600 },
    };
  }
  return {
    target: normalizeTarget(TARGET_OPTIONS[variant][0]!.value, {}, variant),
    trigger: { kind: "cue" },
    effect:
      variant === "chart"
        ? { kind: "appear", preset: "grow", durationMs: 600 }
        : { kind: "appear", preset: "fade", durationMs: 400 },
  };
}

export function EffectsField({
  label,
  fieldKey,
  variant,
  value,
  setField,
  lines,
  speakers,
  messageLabels,
  turnLabels,
  lineSeries = [],
  lineCategories = [],
  lineValueLabels = false,
}: EffectsFieldProps) {
  const entries = parseEntries(value);
  const targetless = variant === "stat" || variant === "quote";
  const emphasizeStyles =
    variant === "chart" || variant === "line"
      ? EMPHASIZE_STYLES.filter((style) => style !== "background")
      : [...EMPHASIZE_STYLES];

  if (entries === null) {
    return (
      <div className="my-2">
        <span className={formLabelTextClass}>{label}</span>
        <p className={errorTextClass}>セリフ同期の効果を読み取れませんでした。JSONで修正してください。</p>
        <textarea
          className={`mt-1 block w-full ${textFieldClass}`}
          rows={4}
          value={value}
          onChange={(event) => setField(fieldKey, event.target.value)}
        />
      </div>
    );
  }

  const commit = (next: Json[]) => {
    const cleaned = targetless
      ? next.map((entry) => {
          const { target: _target, ...rest } = entry;
          return rest;
        })
      : next;
    setField(fieldKey, JSON.stringify(cleaned));
  };
  const update = (index: number, patch: Json) => {
    commit(entries.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)));
  };
  const targetOf = (entry: Json): Json =>
    typeof entry.target === "object" && entry.target !== null ? (entry.target as Json) : { kind: "" };
  const triggerOf = (entry: Json): Json =>
    typeof entry.trigger === "object" && entry.trigger !== null ? (entry.trigger as Json) : { kind: "cue" };
  const effectOf = (entry: Json): Json =>
    typeof entry.effect === "object" && entry.effect !== null ? (entry.effect as Json) : { kind: "appear" };

  return (
    <div className="my-2">
      <span className={formLabelTextClass}>{label}</span>
      <p className={metaTextClass}>{EFFECT_HINTS[variant]}</p>
      {entries.map((entry, index) => {
        const target = targetOf(entry);
        const trigger = triggerOf(entry);
        const effect = effectOf(entry);
        const targetKind = String(target.kind ?? "");
        const hasIndex =
          targetKind === "row" ||
          targetKind === "node" ||
          targetKind === "message" ||
          targetKind === "turn" ||
          (variant !== "line" &&
            (targetKind === "category" || targetKind === "series"));
        let indexLabels: string[] | undefined;
        let indexLabel = "番号";
        if (targetKind === "message") {
          indexLabels = messageLabels;
          indexLabel = "メッセージ";
        } else if (targetKind === "turn") {
          indexLabels = turnLabels;
          indexLabel = "ターン";
        }
        const configEffect =
          variant === "terminal" && effect.kind !== "reveal"
            ? { kind: "reveal", mode: "type" }
            : effect;
        const isCell = targetKind === "cell";
        const isLineTarget = variant === "line";
        const lineSeriesKey = String(target.seriesKey ?? "");
        const lineCategoryKey = String(target.categoryKey ?? "");
        const showSeriesKey =
          isLineTarget && (targetKind === "series" || targetKind === "point");
        const showCategoryKey =
          isLineTarget && (targetKind === "category" || targetKind === "point");
        const showOnset =
          effect.kind === "emphasize" &&
          (!isLineTarget || targetKind === "category" || targetKind === "point");
        const lineAllowedEffects = isLineTarget
          ? allowedLineEffectKinds(targetKind)
          : null;
        return (
          <div key={index} className="mt-2 rounded border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              {!targetless && (
                <>
                  <label className={formLabelClass}>
                    対象
                    <select
                      className={textFieldClass}
                      value={targetKind}
                      onChange={(event) => {
                        const kind = event.target.value;
                        const nextTarget =
                          variant === "line"
                            ? fillLineTargetKeys(
                                normalizeTarget(kind, target, variant),
                                lineSeries,
                                lineCategories,
                              )
                            : normalizeTarget(kind, target, variant);
                        const patch: Json = { target: nextTarget };
                        if (
                          variant === "line" &&
                          !allowedLineEffectKinds(kind).includes(String(effect.kind ?? "appear"))
                        ) {
                          patch.effect = fallbackLineEffect(kind);
                        }
                        update(index, patch);
                      }}
                    >
                      {TARGET_OPTIONS[variant].map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {hasIndex && (
                    <label className={formLabelClass}>
                      {indexLabel}
                      {indexLabels !== undefined && indexLabels.length > 0 ? (
                        <select
                          className={textFieldClass}
                          value={String(target.index ?? 0)}
                          onChange={(event) =>
                            update(index, {
                              target: {
                                ...target,
                                index: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                              },
                            })
                          }
                        >
                          {Number(target.index ?? 0) >= indexLabels.length && (
                            <option value={String(target.index ?? 0)}>
                              {`範囲外（${Number(target.index ?? 0) + 1}）`}
                            </option>
                          )}
                          {indexLabels.map((optionLabel, optionIndex) => (
                            <option key={optionIndex} value={optionIndex}>
                              {`${optionIndex + 1}. ${optionLabel}`}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          className={`w-16 ${textFieldClass}`}
                          value={String(target.index ?? 0)}
                          onChange={(event) =>
                            update(index, {
                              target: {
                                ...target,
                                index: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                              },
                            })
                          }
                        />
                      )}
                    </label>
                  )}
                  {isCell && (
                    <>
                      <label className={formLabelClass}>
                        行
                        <input
                          type="number"
                          min={0}
                          className={`w-16 ${textFieldClass}`}
                          value={String(target.row ?? 0)}
                          onChange={(event) =>
                            update(index, {
                              target: {
                                ...target,
                                row: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                              },
                            })
                          }
                        />
                      </label>
                      <label className={formLabelClass}>
                        列キー
                        <input
                          className={`w-24 ${textFieldClass}`}
                          value={String(target.key ?? "")}
                          onChange={(event) =>
                            update(index, { target: { ...target, key: event.target.value } })
                          }
                        />
                      </label>
                    </>
                  )}
                  {showCategoryKey && (
                    <label className={formLabelClass}>
                      カテゴリ
                      <select
                        className={textFieldClass}
                        value={lineCategoryKey}
                        onChange={(event) =>
                          update(index, {
                            target: { ...target, categoryKey: event.target.value },
                          })
                        }
                      >
                        {lineCategoryKey.length === 0 && <option value="">未選択</option>}
                        {lineCategoryKey.length > 0 &&
                          !lineCategories.some((choice) => choice.key === lineCategoryKey) && (
                            <option value={lineCategoryKey}>
                              {`未定義: ${lineCategoryKey}`}
                            </option>
                          )}
                        {lineCategories.map((choice) => (
                          <option key={choice.key} value={choice.key}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {showSeriesKey && (
                    <label className={formLabelClass}>
                      系列
                      <select
                        className={textFieldClass}
                        value={lineSeriesKey}
                        onChange={(event) =>
                          update(index, {
                            target: { ...target, seriesKey: event.target.value },
                          })
                        }
                      >
                        {lineSeriesKey.length === 0 && <option value="">未選択</option>}
                        {lineSeriesKey.length > 0 &&
                          !lineSeries.some((choice) => choice.key === lineSeriesKey) && (
                            <option value={lineSeriesKey}>
                              {`未定義: ${lineSeriesKey}`}
                            </option>
                          )}
                        {lineSeries.map((choice) => (
                          <option key={choice.key} value={choice.key}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              <button
                type="button"
                className={`ml-auto ${buttonNeutralClass}`}
                onClick={() => commit(entries.filter((_entry, entryIndex) => entryIndex !== index))}
              >
                削除
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className={formLabelClass}>
                契機
                <select
                  className={textFieldClass}
                  value={String(trigger.kind ?? "cue")}
                  onChange={(event) => {
                    if (event.target.value === "lines") {
                      if (lines.length === 0) {
                        return;
                      }
                      update(index, {
                        trigger: {
                          kind: "lines",
                          startLineId: lines[0]!.id,
                          endLineId: lines[0]!.id,
                        },
                      });
                      return;
                    }
                    update(index, { trigger: { kind: "cue" } });
                  }}
                >
                  {TRIGGER_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.value === "lines" && lines.length === 0}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {trigger.kind === "lines" && (
                variant === "terminal" ? (
                  <label className={formLabelClass}>
                    セリフ
                    <select
                      className={textFieldClass}
                      value={String(trigger.startLineId ?? "")}
                      onChange={(event) =>
                        update(index, {
                          trigger: {
                            kind: "lines",
                            startLineId: event.target.value,
                            endLineId: event.target.value,
                          },
                        })
                      }
                    >
                      <option value="">未選択</option>
                      {lines.map((line, lineIndexValue) => (
                        <option key={line.id} value={line.id}>
                          {lineOptionLabel(lines, lineIndexValue, speakers)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className={formLabelClass}>
                      開始
                      <select
                        className={textFieldClass}
                        value={String(trigger.startLineId ?? "")}
                        onChange={(event) =>
                          update(index, {
                            trigger: { ...trigger, startLineId: event.target.value },
                          })
                        }
                      >
                        <option value="">未選択</option>
                        {lines.map((line, lineIndexValue) => (
                          <option key={line.id} value={line.id}>
                            {lineOptionLabel(lines, lineIndexValue, speakers)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={formLabelClass}>
                      終了
                      <select
                        className={textFieldClass}
                        value={String(trigger.endLineId ?? "")}
                        onChange={(event) =>
                          update(index, {
                            trigger: { ...trigger, endLineId: event.target.value },
                          })
                        }
                      >
                        <option value="">未選択</option>
                        {lines.map((line, lineIndexValue) => (
                          <option key={line.id} value={line.id}>
                            {lineOptionLabel(lines, lineIndexValue, speakers)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )
              )}
            </div>
            <EffectConfigField
              effect={configEffect}
              variant={variant}
              lineAllowedEffects={lineAllowedEffects}
              lineValueLabels={lineValueLabels}
              emphasizeStyles={emphasizeStyles}
              showOnset={showOnset}
              onChange={(next) => update(index, { effect: next })}
            />
          </div>
        );
      })}
      <button
        type="button"
        className={`mt-2 ${buttonNeutralClass}`}
        onClick={() => commit([...entries, defaultEntry(variant)])}
      >
        効果を追加
      </button>
    </div>
  );
}
