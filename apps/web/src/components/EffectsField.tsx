import {
  APPEAR_PRESETS,
  CHART_APPEAR_PRESETS,
  EMPHASIZE_STYLES,
  TABLE_TONES,
} from "@kakeai/contracts";
import { lineOptionLabel, type LineFormValue, type SpeakerFormValue } from "../content/form";
import {
  buttonNeutralClass,
  errorTextClass,
  formLabelClass,
  formLabelTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { OnsetField } from "./OnsetField";

type Json = Record<string, unknown>;

type EffectVariant = "table" | "chart" | "flow" | "stat" | "quote" | "chat";

const EFFECT_HINTS: Record<EffectVariant, string> = {
  stat: "セリフ区間を契機に、開始値から「数値（カウント後の値）」までカウントします。",
  table: "セリフ区間を契機に、対象の行・セルを登場・強調・数値カウントします。",
  chart: "セリフ区間を契機に、対象の棒を登場・強調・数値カウントします。",
  flow: "セリフ区間を契機に、対象のノードを登場・強調します。",
  quote: "セリフ区間を契機に、引用を登場・強調します。",
  chat: "セリフ区間を契機に、対象のメッセージを登場・強調します。",
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
};

const TRIGGER_OPTIONS = [
  { value: "cue", label: "映像演出全体" },
  { value: "lines", label: "セリフ区間" },
] as const;

const EFFECT_OPTIONS: Record<EffectVariant, readonly { value: string; label: string }[]> = {
  table: [
    { value: "appear", label: "登場" },
    { value: "emphasize", label: "強調" },
    { value: "value", label: "数値カウント" },
  ],
  chart: [
    { value: "appear", label: "登場" },
    { value: "emphasize", label: "強調" },
    { value: "value", label: "数値カウント" },
  ],
  flow: [
    { value: "appear", label: "登場" },
    { value: "emphasize", label: "強調" },
  ],
  stat: [
    { value: "value", label: "数値カウント" },
    { value: "emphasize", label: "強調" },
    { value: "appear", label: "登場" },
  ],
  quote: [
    { value: "emphasize", label: "強調" },
    { value: "appear", label: "登場" },
  ],
  chat: [
    { value: "appear", label: "登場" },
    { value: "emphasize", label: "強調" },
  ],
};

const APPEAR_PRESET_LABELS: Record<string, string> = {
  fade: "フェード",
  "slide-up": "下から",
  "slide-down": "上から",
  "slide-left": "右から",
  "slide-right": "左から",
  "scale-in": "拡大",
  grow: "伸ばす",
  bounce: "弾ませる",
};

const EMPHASIZE_STYLE_LABELS: Record<string, string> = {
  frame: "枠",
  background: "背景",
  spotlight: "スポットライト",
};

const TONE_LABELS: Record<string, string> = {
  primary: "プライマリ",
  secondary: "セカンダリ",
  tertiary: "ターシャリ",
  success: "成功",
  warning: "警告",
  error: "エラー",
  info: "情報",
};

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

function normalizeTarget(kind: string, previous: Json): Json {
  if (kind === "cell") {
    return { kind, row: Number(previous.row) || 0, key: String(previous.key ?? "") };
  }
  if (
    kind === "row" ||
    kind === "category" ||
    kind === "series" ||
    kind === "node" ||
    kind === "message"
  ) {
    return { kind, index: Number(previous.index) || 0 };
  }
  return { kind };
}

function makeEffect(kind: string): Json {
  if (kind === "emphasize") {
    return { kind: "emphasize", style: "frame", tone: "primary" };
  }
  if (kind === "value") {
    return { kind: "value" };
  }
  return { kind: "appear", preset: "fade", durationMs: 400 };
}

function defaultEntry(variant: EffectVariant): Json {
  if (variant === "stat") {
    return { trigger: { kind: "cue" }, effect: { kind: "value" } };
  }
  if (variant === "quote") {
    return { trigger: { kind: "cue" }, effect: { kind: "emphasize", style: "frame", tone: "primary" } };
  }
  return {
    target: normalizeTarget(TARGET_OPTIONS[variant][0]!.value, {}),
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
}: EffectsFieldProps) {
  const entries = parseEntries(value);
  const targetless = variant === "stat" || variant === "quote";
  const emphasizeStyles =
    variant === "chart"
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
          targetKind === "category" ||
          targetKind === "series" ||
          targetKind === "node" ||
          targetKind === "message";
        const isCell = targetKind === "cell";
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
                        update(index, { target: normalizeTarget(kind, target) });
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
                      {targetKind === "message" ? "メッセージ" : "番号"}
                      {targetKind === "message" &&
                      messageLabels !== undefined &&
                      messageLabels.length > 0 ? (
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
                          {Number(target.index ?? 0) >= messageLabels.length && (
                            <option value={String(target.index ?? 0)}>
                              {`範囲外（${Number(target.index ?? 0) + 1}）`}
                            </option>
                          )}
                          {messageLabels.map((messageLabel, messageIndex) => (
                            <option key={messageIndex} value={messageIndex}>
                              {`${messageIndex + 1}. ${messageLabel}`}
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
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className={formLabelClass}>
                効果
                <select
                  className={textFieldClass}
                  value={String(effect.kind ?? "appear")}
                  onChange={(event) => update(index, { effect: makeEffect(event.target.value) })}
                >
                  {EFFECT_OPTIONS[variant].map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {effect.kind === "emphasize" ? (
                <>
                  <label className={formLabelClass}>
                    見た目
                    <select
                      className={textFieldClass}
                      value={String(effect.style ?? "frame")}
                      onChange={(event) =>
                        update(index, { effect: { ...effect, style: event.target.value } })
                      }
                    >
                      {emphasizeStyles.map((style) => (
                        <option key={style} value={style}>
                          {EMPHASIZE_STYLE_LABELS[style] ?? style}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={formLabelClass}>
                    色
                    <select
                      className={textFieldClass}
                      value={String(effect.tone ?? "primary")}
                      onChange={(event) =>
                        update(index, { effect: { ...effect, tone: event.target.value } })
                      }
                    >
                      {TABLE_TONES.map((tone) => (
                        <option key={tone} value={tone}>
                          {TONE_LABELS[tone] ?? tone}
                        </option>
                      ))}
                    </select>
                  </label>
                  <OnsetField
                    effect={effect}
                    onChange={(next) => update(index, { effect: next })}
                  />
                </>
              ) : effect.kind === "value" ? (
                <>
                  <label className={formLabelClass}>
                    {variant === "stat" ? "開始値（数値まで）" : "開始値"}
                    <input
                      type="number"
                      className={`w-24 ${textFieldClass}`}
                      value={effect.from === undefined ? "" : String(effect.from)}
                      onChange={(event) => {
                        const next = { ...effect };
                        if (event.target.value === "") {
                          delete next.from;
                        } else {
                          next.from = Number(event.target.value) || 0;
                        }
                        update(index, { effect: next });
                      }}
                    />
                  </label>
                  <label className={formLabelClass}>
                    尺(ms)
                    <input
                      type="number"
                      min={0}
                      className={`w-20 ${textFieldClass}`}
                      value={effect.durationMs === undefined ? "" : String(effect.durationMs)}
                      onChange={(event) => {
                        const next = { ...effect };
                        if (event.target.value === "") {
                          delete next.durationMs;
                        } else {
                          next.durationMs = Math.max(0, Math.floor(Number(event.target.value) || 0));
                        }
                        update(index, { effect: next });
                      }}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className={formLabelClass}>
                    動き
                    <select
                      className={textFieldClass}
                      value={String(effect.preset ?? "fade")}
                      onChange={(event) =>
                        update(index, { effect: { ...effect, preset: event.target.value } })
                      }
                    >
                      {(variant === "chart" ? CHART_APPEAR_PRESETS : APPEAR_PRESETS).map((preset) => (
                        <option key={preset} value={preset}>
                          {APPEAR_PRESET_LABELS[preset] ?? preset}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={formLabelClass}>
                    尺(ms)
                    <input
                      type="number"
                      min={0}
                      className={`w-20 ${textFieldClass}`}
                      value={String(effect.durationMs ?? 400)}
                      onChange={(event) =>
                        update(index, {
                          effect: { ...effect, durationMs: Number(event.target.value) || 0 },
                        })
                      }
                    />
                  </label>
                  <label className={formLabelClass}>
                    ずれ(ms)
                    <input
                      type="number"
                      min={0}
                      className={`w-20 ${textFieldClass}`}
                      value={effect.staggerMs === undefined ? "" : String(effect.staggerMs)}
                      onChange={(event) => {
                        const next = { ...effect };
                        if (event.target.value === "") {
                          delete next.staggerMs;
                        } else {
                          next.staggerMs = Number(event.target.value) || 0;
                        }
                        update(index, { effect: next });
                      }}
                    />
                  </label>
                </>
              )}
            </div>
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
