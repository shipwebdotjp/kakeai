import type { LineFormValue } from "../content/form";
import {
  appendTerminalRevealEffect,
  firstUnusedTerminalLineId,
  parseTerminalTurns,
  remapTerminalEffectTargets,
} from "../content/terminal";
import {
  buttonNeutralClass,
  errorTextClass,
  formLabelTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

type Json = Record<string, unknown>;

interface TerminalTurnsFieldProps {
  label: string;
  fieldKey: string;
  value: string;
  setField: (key: string, value: string) => void;
  setFields: (patch: Record<string, string>) => void;
  maxTurns: number;
  lines: LineFormValue[];
  effectsKey?: string;
  effectsValue?: string;
}

function outputText(item: Json): string {
  if (!Array.isArray(item.output)) {
    return "";
  }
  return item.output.map((line) => String(line)).join("\n");
}

export function TerminalTurnsField({
  label,
  fieldKey,
  value,
  setField,
  setFields,
  maxTurns,
  lines,
  effectsKey,
  effectsValue,
}: TerminalTurnsFieldProps) {
  const turns = parseTerminalTurns(value);

  if (turns === null) {
    return (
      <div className="my-2">
        <span className={formLabelTextClass}>{label}</span>
        <p className={errorTextClass}>入力と出力を読み取れませんでした。JSONで修正してください。</p>
        <textarea
          className={`mt-1 block w-full ${textFieldClass}`}
          rows={4}
          value={value}
          onChange={(event) => setField(fieldKey, event.target.value)}
        />
      </div>
    );
  }

  const commitTurns = (next: Json[]) => setField(fieldKey, JSON.stringify(next));
  const update = (index: number, patch: Json) => {
    commitTurns(
      turns.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };
  const commitWithEffects = (nextTurns: Json[], nextEffects: string | null) => {
    if (effectsKey !== undefined && nextEffects !== null) {
      setFields({ [fieldKey]: JSON.stringify(nextTurns), [effectsKey]: nextEffects });
      return;
    }
    commitTurns(nextTurns);
  };

  return (
    <div className="my-2">
      <span className={formLabelTextClass}>{label}</span>
      <p className={metaTextClass}>
        1ターンが入力と出力のまとまりです。新しいターンには、未使用の次のセリフを自動で割り当てます。
      </p>
      {turns.map((item, index) => (
        <div key={index} className="mt-2 rounded border border-border p-2">
          <div className="flex items-center gap-2">
            <span className={metaTextClass}>{`ターン ${index + 1}`}</span>
            <button
              type="button"
              className={`ml-auto ${buttonNeutralClass}`}
              disabled={turns.length <= 1}
              onClick={() => {
                const nextTurns = turns.filter(
                  (_entry, itemIndex) => itemIndex !== index,
                );
                const nextEffects =
                  effectsKey === undefined
                    ? null
                    : remapTerminalEffectTargets(
                        effectsValue ?? "",
                        (targetIndex) =>
                          targetIndex === index
                            ? null
                            : targetIndex > index
                              ? targetIndex - 1
                              : targetIndex,
                      );
                commitWithEffects(nextTurns, nextEffects);
              }}
            >
              削除
            </button>
          </div>
          <label className="mt-1 block">
            <span className={metaTextClass}>入力</span>
            <input
              className={`mt-0.5 block w-full font-mono ${textFieldClass}`}
              value={String(item.input ?? "")}
              placeholder="コマンド"
              onChange={(event) => update(index, { input: event.target.value })}
            />
          </label>
          <label className="mt-1 block">
            <span className={metaTextClass}>出力</span>
            <textarea
              className={`mt-0.5 block w-full font-mono ${textFieldClass}`}
              rows={2}
              value={outputText(item)}
              placeholder="出力（1行ずつ改行）"
              onChange={(event) => {
                const next: Json = { ...item };
                if (event.target.value.length === 0) {
                  delete next.output;
                } else {
                  next.output = event.target.value
                    .replace(/\r\n?/g, "\n")
                    .split("\n");
                }
                commitTurns(
                  turns.map((entry, itemIndex) => (itemIndex === index ? next : entry)),
                );
              }}
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className={`mt-2 ${buttonNeutralClass}`}
        disabled={turns.length >= maxTurns}
        onClick={() => {
          if (turns.length >= maxTurns) {
            return;
          }
          const nextTurns = [...turns, { input: "", output: [] }];
          if (effectsKey === undefined) {
            commitTurns(nextTurns);
            return;
          }
          const lineId = firstUnusedTerminalLineId(effectsValue ?? "", lines);
          if (lineId === null) {
            commitTurns(nextTurns);
            return;
          }
          commitWithEffects(
            nextTurns,
            appendTerminalRevealEffect(
              effectsValue ?? "",
              nextTurns.length - 1,
              lineId,
            ),
          );
        }}
      >
        入出力を追加
      </button>
    </div>
  );
}
