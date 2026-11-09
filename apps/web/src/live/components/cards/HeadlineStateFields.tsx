import type { LiveHeadlineState, TableTone } from "@kakeai/contracts";
import { TABLE_TONES } from "@kakeai/contracts";
import { textFieldClass } from "../../../ui";
import { setOptionalText } from "./optional-field";
import {
  isBlankText,
  requiredFieldClass,
  requiredMessageClass,
} from "./required-field";

interface HeadlineStateFieldsProps {
  state: LiveHeadlineState;
  onChange: (state: LiveHeadlineState) => void;
}

export function HeadlineStateFields({ state, onChange }: HeadlineStateFieldsProps) {
  const titleMissing = isBlankText(state.title);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        見出し
        <input
          className={`mt-1 w-full ${textFieldClass} ${titleMissing ? requiredFieldClass : ""}`}
          value={state.title}
          aria-invalid={titleMissing}
          onChange={(event) => onChange({ ...state, title: event.target.value })}
        />
        {titleMissing && (
          <span className={`block ${requiredMessageClass}`}>見出しは必須です。</span>
        )}
      </label>
      <label className="block text-sm">
        サブタイトル
        <input
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.subtitle ?? ""}
          onChange={(event) =>
            onChange(setOptionalText(state, "subtitle", event.target.value))
          }
        />
      </label>
      <label className="block text-sm">
        キッカー
        <input
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.kicker ?? ""}
          onChange={(event) =>
            onChange(setOptionalText(state, "kicker", event.target.value))
          }
        />
      </label>
      <label className="block text-sm">
        トーン
        <select
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.tone}
          onChange={(event) => onChange({ ...state, tone: event.target.value as TableTone })}
        >
          {TABLE_TONES.map((tone) => (
            <option key={tone} value={tone}>
              {tone}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        揃え
        <select
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.align}
          onChange={(event) =>
            onChange({
              ...state,
              align: event.target.value === "left" ? "left" : "center",
            })
          }
        >
          <option value="center">中央</option>
          <option value="left">左</option>
        </select>
      </label>
    </div>
  );
}
