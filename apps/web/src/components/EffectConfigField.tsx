import {
  APPEAR_PRESETS,
  CHART_APPEAR_PRESETS,
  CHART_LINE_APPEAR_PRESETS,
  TABLE_TONES,
} from "@kakeai/contracts";
import { errorTextClass, formLabelClass, textFieldClass } from "../ui";
import { OnsetField } from "./OnsetField";

type Json = Record<string, unknown>;

export type EffectVariant =
  | "table"
  | "chart"
  | "line"
  | "flow"
  | "stat"
  | "quote"
  | "chat"
  | "terminal";

export const EFFECT_OPTIONS: Record<
  EffectVariant,
  readonly { value: string; label: string }[]
> = {
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
  line: [
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
  terminal: [{ value: "reveal", label: "表示" }],
};

const APPEAR_PRESETS_BY_VARIANT: Record<EffectVariant, readonly string[]> = {
  table: APPEAR_PRESETS,
  chart: CHART_APPEAR_PRESETS,
  line: CHART_LINE_APPEAR_PRESETS,
  flow: APPEAR_PRESETS,
  stat: APPEAR_PRESETS,
  quote: APPEAR_PRESETS,
  chat: APPEAR_PRESETS,
  terminal: APPEAR_PRESETS,
};

const APPEAR_PRESET_LABELS: Record<string, string> = {
  draw: "描画",
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

const REVEAL_MODE_LABELS: Record<string, string> = {
  type: "1文字ずつタイプ",
  instant: "すぐに表示",
};

export function makeEffect(kind: string, variant?: EffectVariant): Json {
  if (kind === "emphasize") {
    return { kind: "emphasize", style: "frame", tone: "primary" };
  }
  if (kind === "value") {
    return { kind: "value" };
  }
  if (kind === "reveal") {
    return { kind: "reveal", mode: "type" };
  }
  if (variant === "line") {
    return { kind: "appear", preset: "draw", durationMs: 600 };
  }
  return { kind: "appear", preset: "fade", durationMs: 400 };
}

export function EffectConfigField({
  effect,
  variant,
  lineAllowedEffects,
  lineValueLabels,
  emphasizeStyles,
  showOnset,
  onChange,
}: {
  effect: Json;
  variant: EffectVariant;
  lineAllowedEffects: readonly string[] | null;
  lineValueLabels: boolean;
  emphasizeStyles: readonly string[];
  showOnset: boolean;
  onChange: (next: Json) => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <label className={formLabelClass}>
        効果
        <select
          className={textFieldClass}
          value={variant === "terminal" ? "reveal" : String(effect.kind ?? "appear")}
          onChange={(event) => onChange(makeEffect(event.target.value, variant))}
        >
          {EFFECT_OPTIONS[variant].map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={
                (lineAllowedEffects !== null &&
                  !lineAllowedEffects.includes(option.value)) ||
                (option.value === "value" &&
                  variant === "line" &&
                  !lineValueLabels)
              }
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {variant === "line" &&
        lineAllowedEffects !== null &&
        !lineAllowedEffects.includes(String(effect.kind ?? "appear")) && (
          <p className={errorTextClass}>
            この対象には選べない効果です。対象か効果を変更してください。
          </p>
        )}
      {variant === "line" && effect.kind === "value" && !lineValueLabels && (
        <p className={errorTextClass}>
          数値カウントを使うには「値ラベル」をオンにしてください。
        </p>
      )}
      {effect.kind === "emphasize" ? (
        <>
          <label className={formLabelClass}>
            見た目
            <select
              className={textFieldClass}
              value={String(effect.style ?? "frame")}
              onChange={(event) => onChange({ ...effect, style: event.target.value })}
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
              onChange={(event) => onChange({ ...effect, tone: event.target.value })}
            >
              {TABLE_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {TONE_LABELS[tone] ?? tone}
                </option>
              ))}
            </select>
          </label>
          {showOnset && <OnsetField effect={effect} onChange={onChange} />}
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
                onChange(next);
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
                onChange(next);
              }}
            />
          </label>
        </>
      ) : variant === "terminal" || effect.kind === "reveal" ? (
        <label className={formLabelClass}>
          表示
          <select
            className={textFieldClass}
            value={String(effect.mode ?? "type")}
            onChange={(event) => onChange({ ...effect, mode: event.target.value })}
          >
            {Object.entries(REVEAL_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className={formLabelClass}>
            動き
            <select
              className={textFieldClass}
              value={String(effect.preset ?? "fade")}
              onChange={(event) => onChange({ ...effect, preset: event.target.value })}
            >
              {APPEAR_PRESETS_BY_VARIANT[variant].map((preset) => (
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
                onChange({
                  ...effect,
                  durationMs: Number(event.target.value) || 0,
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
                onChange(next);
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}
