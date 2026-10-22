import { ONSET_PRESETS } from "@kakeai/contracts";
import { buttonNeutralClass, formLabelClass, textFieldClass } from "../ui";

type Json = Record<string, unknown>;

interface OnsetFieldProps {
  effect: Json;
  onChange: (effect: Json) => void;
}

const ONSET_PRESET_LABELS: Record<string, string> = {
  sweep: "枠を一周",
  flash: "フラッシュ",
  pop: "ポップ",
  marker: "蛍光ペン",
  underline: "下線",
};

const DEFAULT_ONSET = { preset: "sweep", durationMs: 600 };

export function OnsetField({ effect, onChange }: OnsetFieldProps) {
  const onset =
    typeof effect.onset === "object" && effect.onset !== null ? (effect.onset as Json) : null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <label className={formLabelClass}>
        <input
          type="checkbox"
          checked={onset !== null}
          onChange={(event) => {
            const next = { ...effect };
            if (event.target.checked) {
              next.onset = { ...DEFAULT_ONSET };
            } else {
              delete next.onset;
            }
            onChange(next);
          }}
        />
        発火の演出
      </label>
      {onset !== null && (
        <>
          <label className={formLabelClass}>
            動き
            <select
              className={textFieldClass}
              value={String(onset.preset ?? "sweep")}
              onChange={(event) =>
                onChange({ ...effect, onset: { ...onset, preset: event.target.value } })
              }
            >
              {ONSET_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {ONSET_PRESET_LABELS[preset] ?? preset}
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
              value={String(onset.durationMs ?? 0)}
              onChange={(event) =>
                onChange({
                  ...effect,
                  onset: { ...onset, durationMs: Number(event.target.value) || 0 },
                })
              }
            />
          </label>
          <button
            type="button"
            className={`ml-auto ${buttonNeutralClass}`}
            onClick={() => {
              const next = { ...effect };
              delete next.onset;
              onChange(next);
            }}
          >
            発火を解除
          </button>
        </>
      )}
    </div>
  );
}
