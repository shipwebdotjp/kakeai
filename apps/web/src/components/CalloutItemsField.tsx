import {
  APPEAR_PRESETS,
  EMPHASIZE_STYLES,
  LIST_CALLOUT_MAX_ITEMS,
  TABLE_TONES,
} from "@kakeai/contracts";
import { lineOptionLabel, type LineFormValue, type SpeakerFormValue } from "../content/form";
import { buttonNeutralClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";
import { OnsetField } from "./OnsetField";

type Json = Record<string, unknown>;

interface CalloutItemsFieldProps {
  label: string;
  fieldKey: string;
  value: string;
  setField: (key: string, value: string) => void;
  lines: LineFormValue[];
  speakers: SpeakerFormValue[];
}

const TRIGGER_OPTIONS = [
  { value: "cue", label: "Cue全体" },
  { value: "lines", label: "セリフ区間" },
] as const;

const EFFECT_OPTIONS = [
  { value: "emphasize", label: "強調" },
  { value: "appear", label: "登場" },
] as const;

const APPEAR_PRESET_LABELS: Record<string, string> = {
  fade: "フェード",
  "slide-up": "下から",
  "slide-down": "上から",
  "slide-left": "右から",
  "slide-right": "左から",
  "scale-in": "拡大",
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

function parseItems(value: string): Json[] | null {
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

export function CalloutItemsField({
  label,
  fieldKey,
  value,
  setField,
  lines,
  speakers,
}: CalloutItemsFieldProps) {
  const items = parseItems(value);

  if (items === null) {
    return (
      <div className="my-2">
        <span>{label}</span>
        <p className={errorTextClass}>ポイントを読み取れませんでした。JSONで修正してください。</p>
        <textarea
          className={`mt-1 block w-full ${textFieldClass}`}
          rows={4}
          value={value}
          onChange={(event) => setField(fieldKey, event.target.value)}
        />
      </div>
    );
  }

  const commit = (next: Json[]) => setField(fieldKey, JSON.stringify(next));
  const update = (index: number, patch: Json) => {
    commit(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };
  const triggerOf = (item: Json): Json =>
    typeof item.trigger === "object" && item.trigger !== null ? (item.trigger as Json) : { kind: "cue" };
  const effectOf = (item: Json): Json =>
    typeof item.effect === "object" && item.effect !== null
      ? (item.effect as Json)
      : { kind: "emphasize", style: "frame", tone: "primary" };

  return (
    <div className="my-2">
      <span>{label}</span>
      <p className={metaTextClass}>
        ポイントごとに、特定のセリフ区間で強調（または登場）できます。
      </p>
      {items.map((item, index) => {
        const hasEffect = item.effect !== undefined && item.trigger !== undefined;
        const trigger = triggerOf(item);
        const effect = effectOf(item);
        return (
          <div key={index} className="mt-2 rounded border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`flex-1 ${textFieldClass}`}
                value={String(item.text ?? "")}
                placeholder="ポイントの文言"
                onChange={(event) => update(index, { text: event.target.value })}
              />
              <button
                type="button"
                className={buttonNeutralClass}
                disabled={items.length <= 1}
                onClick={() =>
                  commit(items.filter((_item, itemIndex) => itemIndex !== index))
                }
              >
                削除
              </button>
            </div>
            <label className="mt-1 inline-flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={hasEffect}
                onChange={(event) => {
                  const next: Json = { ...item };
                  if (event.target.checked) {
                    next.trigger = { kind: "cue" };
                    next.effect = { kind: "emphasize", style: "frame", tone: "primary" };
                  } else {
                    delete next.trigger;
                    delete next.effect;
                  }
                  commit(items.map((entry, itemIndex) => (itemIndex === index ? next : entry)));
                }}
              />
              セリフ同期の効果
            </label>
            {hasEffect && (
              <>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5">
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
                      <label className="inline-flex items-center gap-1.5">
                        開始
                        <select
                          className={textFieldClass}
                          value={String(trigger.startLineId ?? "")}
                          onChange={(event) =>
                            update(index, { trigger: { ...trigger, startLineId: event.target.value } })
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
                            update(index, { trigger: { ...trigger, endLineId: event.target.value } })
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
                      value={String(effect.kind ?? "emphasize")}
                      onChange={(event) =>
                        update(index, {
                          effect:
                            event.target.value === "appear"
                              ? { kind: "appear", preset: "fade", durationMs: 400 }
                              : { kind: "emphasize", style: "frame", tone: "primary" },
                        })
                      }
                    >
                      {EFFECT_OPTIONS.map((option) => (
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
                      <OnsetField
                        effect={effect}
                        onChange={(next) => update(index, { effect: next })}
                      />
                    </>
                  ) : (
                    <label className="inline-flex items-center gap-1.5">
                      動き
                      <select
                        className={textFieldClass}
                        value={String(effect.preset ?? "fade")}
                        onChange={(event) =>
                          update(index, { effect: { ...effect, preset: event.target.value } })
                        }
                      >
                        {APPEAR_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>
                            {APPEAR_PRESET_LABELS[preset] ?? preset}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className={`mt-2 ${buttonNeutralClass}`}
        disabled={items.length >= LIST_CALLOUT_MAX_ITEMS}
        onClick={() => {
          if (items.length >= LIST_CALLOUT_MAX_ITEMS) {
            return;
          }
          commit([...items, { text: "ポイント" }]);
        }}
      >
        ポイントを追加
      </button>
    </div>
  );
}
