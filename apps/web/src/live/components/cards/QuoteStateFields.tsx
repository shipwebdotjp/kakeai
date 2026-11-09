import type { LiveQuoteState, TableTone } from "@kakeai/contracts";
import { TABLE_TONES } from "@kakeai/contracts";
import { textFieldClass } from "../../../ui";
import { setOptionalText } from "./optional-field";
import {
  isBlankText,
  requiredFieldClass,
  requiredMessageClass,
} from "./required-field";

interface QuoteStateFieldsProps {
  state: LiveQuoteState;
  onChange: (state: LiveQuoteState) => void;
}

export function QuoteStateFields({ state, onChange }: QuoteStateFieldsProps) {
  const quoteMissing = isBlankText(state.quote);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        引用文
        <textarea
          className={`mt-1 min-h-24 w-full ${textFieldClass} ${quoteMissing ? requiredFieldClass : ""}`}
          value={state.quote}
          aria-invalid={quoteMissing}
          onChange={(event) => onChange({ ...state, quote: event.target.value })}
        />
        {quoteMissing && (
          <span className={`block ${requiredMessageClass}`}>引用文は必須です。</span>
        )}
      </label>
      <label className="block text-sm">
        著者
        <input
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.author ?? ""}
          onChange={(event) =>
            onChange(setOptionalText(state, "author", event.target.value))
          }
        />
      </label>
      <label className="block text-sm">
        出典
        <input
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.source ?? ""}
          onChange={(event) =>
            onChange(setOptionalText(state, "source", event.target.value))
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
              align: event.target.value === "center" ? "center" : "left",
            })
          }
        >
          <option value="left">左</option>
          <option value="center">中央</option>
        </select>
      </label>
    </div>
  );
}
