import {
  APPEAR_PRESETS,
  CHART_APPEAR_PRESETS,
  EMPHASIZE_STYLES,
  TABLE_TONES,
} from "@kakeai/contracts";
import { lineOptionLabel, type LineFormValue, type SpeakerFormValue } from "../content/form";
import { buttonNeutralClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";

type Json = Record<string, unknown>;

interface EffectsFieldProps {
  label: string;
  fieldKey: string;
  variant: "table" | "chart";
  value: string;
  setField: (key: string, value: string) => void;
  lines: LineFormValue[];
  speakers: SpeakerFormValue[];
}

const TARGET_OPTIONS: Record<"table" | "chart", readonly { value: string; label: string }[]> = {
  table: [
    { value: "row", label: "行" },
    { value: "cell", label: "セル" },
    { value: "rows", label: "全行" },
    { value: "columns", label: "全列" },
  ],
  chart: [
    { value: "category", label: "カテゴリ" },
    { value: "series", label: "系列" },
    { value: "bars", label: "全棒" },
  ],
};

const TRIGGER_OPTIONS = [
  { value: "cue", label: "Cue全体" },
  { value: "lines", label: "セリフ区間" },
] as const;

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
  if (kind === "row" || kind === "category" || kind === "series") {
    return { kind, index: Number(previous.index) || 0 };
  }
  return { kind };
}

function defaultEntry(variant: "table" | "chart"): Json {
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
}: EffectsFieldProps) {
  const entries = parseEntries(value);
  const effectOptions =
    variant === "chart"
      ? [{ value: "appear", label: "登場" }]
      : [
          { value: "appear", label: "登場" },
          { value: "emphasize", label: "強調" },
        ];

  if (entries === null) {
    return (
      <div className="my-2">
        <span>{label}</span>
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
    setField(fieldKey, JSON.stringify(next));
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
      <span>{label}</span>
      <p className={metaTextClass}>
        セリフ区間を契機に、対象を登場させたり強調したりします。
      </p>
      {entries.map((entry, index) => {
        const target = targetOf(entry);
        const trigger = triggerOf(entry);
        const effect = effectOf(entry);
        const targetKind = String(target.kind ?? "");
        const hasIndex = targetKind === "row" || targetKind === "category" || targetKind === "series";
        const isCell = targetKind === "cell";
        return (
          <div key={index} className="mt-2 rounded border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5">
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
                <label className="inline-flex items-center gap-1.5">
                  番号
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
                </label>
              )}
              {isCell && (
                <>
                  <label className="inline-flex items-center gap-1.5">
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
                  <label className="inline-flex items-center gap-1.5">
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
              <button
                type="button"
                className={`ml-auto ${buttonNeutralClass}`}
                onClick={() => commit(entries.filter((_entry, entryIndex) => entryIndex !== index))}
              >
                削除
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5">
                契機
                <select
                  className={textFieldClass}
                  value={String(trigger.kind ?? "cue")}
                  onChange={(event) =>
                    update(index, {
                      trigger:
                        event.target.value === "lines"
                          ? { kind: "lines", startLineId: lines[0]?.id ?? "", endLineId: lines[0]?.id ?? "" }
                          : { kind: "cue" },
                    })
                  }
                >
                  {TRIGGER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {trigger.kind === "lines" && (
                <>
                  <label className="inline-flex items-center gap-1.5">
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
                  <label className="inline-flex items-center gap-1.5">
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
              <label className="inline-flex items-center gap-1.5">
                効果
                <select
                  className={textFieldClass}
                  value={String(effect.kind ?? "appear")}
                  onChange={(event) =>
                    update(index, {
                      effect:
                        event.target.value === "emphasize"
                          ? { kind: "emphasize", style: "frame", tone: "primary" }
                          : { kind: "appear", preset: "fade", durationMs: 400 },
                    })
                  }
                >
                  {effectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {effect.kind === "emphasize" ? (
                <>
                  <label className="inline-flex items-center gap-1.5">
                    見た目
                    <select
                      className={textFieldClass}
                      value={String(effect.style ?? "frame")}
                      onChange={(event) =>
                        update(index, { effect: { ...effect, style: event.target.value } })
                      }
                    >
                      {EMPHASIZE_STYLES.map((style) => (
                        <option key={style} value={style}>
                          {EMPHASIZE_STYLE_LABELS[style] ?? style}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
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
                </>
              ) : (
                <>
                  <label className="inline-flex items-center gap-1.5">
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
                  <label className="inline-flex items-center gap-1.5">
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
                  <label className="inline-flex items-center gap-1.5">
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
