import { useEffect, useMemo, useState } from "react";
import {
  buildImportedScenes,
  parseScript,
  unresolvedSpeakerNames,
  type ScriptImportMode,
  type SpeakerAssignmentMap,
} from "../content/scriptImport";
import type { SceneFormValue, SpeakerFormValue } from "../content/form";
import { errorMessage } from "../lib/errorMessage";
import { buttonNeutralClass, buttonPrimaryClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";
import { Modal } from "./Modal";

interface ScriptImportModalProps {
  open: boolean;
  onClose: () => void;
  scenes: SceneFormValue[];
  speakers: SpeakerFormValue[];
  disabled?: boolean;
  onApply: (scenes: SceneFormValue[]) => void;
}

const NO_SPEAKER_VALUE = "__none__";

function speakerOptionLabel(speaker: SpeakerFormValue): string {
  const name = speaker.name.trim().length > 0 ? speaker.name : speaker.id;
  return speaker.characterId === null
    ? `声だけの話者「${name}」`
    : `作品内の話者「${name}」`;
}

export function ScriptImportModal({
  open,
  onClose,
  scenes,
  speakers,
  disabled = false,
  onApply,
}: ScriptImportModalProps) {
  const [text, setText] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string | null | undefined>>(
    () => Object.create(null),
  );
  const [mode, setMode] = useState<ScriptImportMode>("replace");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText("");
      setAssignments(Object.create(null));
      setMode("replace");
      setError(null);
    }
  }, [open]);

  const script = useMemo(() => parseScript(text), [text]);

  const effectiveAssignments = useMemo(() => {
    const map: SpeakerAssignmentMap = Object.create(null);
    for (const name of script.speakerNames) {
      if (Object.prototype.hasOwnProperty.call(assignments, name)) {
        const value = assignments[name];
        if (value !== undefined) {
          map[name] = value;
        }
        continue;
      }
      const matches = speakers.filter((speaker) => speaker.name.trim() === name);
      if (matches.length === 1) {
        map[name] = matches[0]!.id;
      }
    }
    return map;
  }, [script, assignments, speakers]);

  const unresolved = unresolvedSpeakerNames(script, effectiveAssignments);
  const lineCount = script.chapters.reduce((total, chapter) => total + chapter.lines.length, 0);
  const ready =
    script.diagnostics.length === 0 && unresolved.length === 0 && script.chapters.length > 0;

  const assignmentValue = (name: string): string => {
    if (Object.prototype.hasOwnProperty.call(assignments, name)) {
      const value = assignments[name];
      if (value === undefined) {
        return "";
      }
      return value === null ? NO_SPEAKER_VALUE : value;
    }
    if (!Object.prototype.hasOwnProperty.call(effectiveAssignments, name)) {
      return "";
    }
    const value = effectiveAssignments[name];
    if (value === undefined) {
      return "";
    }
    return value === null ? NO_SPEAKER_VALUE : value;
  };

  const changeAssignment = (name: string, value: string) => {
    setError(null);
    setAssignments((previous) => {
      const next: Record<string, string | null | undefined> = Object.create(null);
      for (const key of Object.keys(previous)) {
        next[key] = previous[key];
      }
      if (value === "") {
        next[name] = undefined;
      } else if (value === NO_SPEAKER_VALUE) {
        next[name] = null;
      } else {
        next[name] = value;
      }
      return next;
    });
  };

  const onConfirm = () => {
    setError(null);
    try {
      const validIds = new Set(speakers.map((speaker) => speaker.id));
      const validated: SpeakerAssignmentMap = Object.create(null);
      for (const name of script.speakerNames) {
        if (!Object.prototype.hasOwnProperty.call(effectiveAssignments, name)) {
          continue;
        }
        const value = effectiveAssignments[name] ?? null;
        if (value !== null && !validIds.has(value)) {
          throw new Error(`話者「${name}」の割り当てが無効です。選び直してください。`);
        }
        validated[name] = value;
      }
      const next = buildImportedScenes({
        script,
        assignments: validated,
        mode,
        existingScenes: scenes,
      });
      onApply(next);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="台本をインポート">
      <div className="grid gap-4">
        <div>
          <p className={metaTextClass}>
            章見出し（<code>## 見出し</code>）と <code>話者名: セリフ</code> の行を貼り付けます。1行が1セリフになります。
          </p>
          <textarea
            rows={10}
            className={`mt-2 block w-full font-mono ${textFieldClass}`}
            placeholder={"## 第一章\nリン:こんにちは\nレン:やっほー"}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <span>章: {script.chapters.length}</span>
          <span>セリフ: {lineCount}</span>
          <span>話者: {script.speakerNames.length}</span>
        </div>

        {script.diagnostics.length > 0 && (
          <div className="rounded border border-red-400 bg-red-50 p-3 text-sm dark:bg-red-950/40">
            <strong>エラー</strong>
            <ul>
              {script.diagnostics.map((diagnostic, index) => (
                <li key={index}>
                  {diagnostic.lineNumber}行目: {diagnostic.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {script.speakerNames.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">話者の割り当て</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-1 pr-2 font-medium">台本の話者名</th>
                  <th className="py-1 font-medium">割り当て先</th>
                </tr>
              </thead>
              <tbody>
                {script.speakerNames.map((name) => (
                  <tr key={name}>
                    <td className="py-1 pr-2">{name}</td>
                    <td className="py-1">
                      <select
                        className={textFieldClass}
                        value={assignmentValue(name)}
                        onChange={(event) => changeAssignment(name, event.target.value)}
                      >
                        <option value="">未選択</option>
                        <option value={NO_SPEAKER_VALUE}>話者なし</option>
                        {speakers.map((speaker) => (
                          <option key={speaker.id} value={speaker.id}>
                            {speakerOptionLabel(speaker)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unresolved.length > 0 && (
              <p className={errorTextClass}>
                未選択の話者があります: {unresolved.join("、")}
              </p>
            )}
          </div>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold">反映先</h3>
          <label className="mr-4 inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="script-import-mode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            既存の要点シーンを置き換える
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="script-import-mode"
              checked={mode === "append"}
              onChange={() => setMode("append")}
            />
            既存の要点シーンの末尾へ追加する
          </label>
          <p className={`mt-1 ${metaTextClass}`}>
            置き換えでも、導入・結び・キャラクター・BGM・素材・話者設定は維持します。置き換わるのは未保存フォーム上の要点シーンだけで、保存済みの版は「保存」を押すまで変わりません。
          </p>
        </div>

        {error !== null && <p className={errorTextClass}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className={buttonNeutralClass} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={disabled || !ready}
            onClick={onConfirm}
          >
            反映
          </button>
        </div>
      </div>
    </Modal>
  );
}
