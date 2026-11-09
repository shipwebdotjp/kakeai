import type { LiveFormatCueRole, LiveFormatDocumentV1 } from "@kakeai/contracts";
import {
  addFormatCue,
  createFormatCue,
  updateFormatCue,
} from "../../model/format";
import { createLiveLocalId } from "../../model/ids";
import {
  badgeDangerClass,
  metaTextClass,
  sectionTitleClass,
  textFieldClass,
} from "../../../ui";

interface FormatCueFieldsProps {
  document: LiveFormatDocumentV1;
  onChangeDocument: (updater: (document: LiveFormatDocumentV1) => LiveFormatDocumentV1) => void;
}

const ROLES: { role: LiveFormatCueRole; label: string; description: string }[] = [
  {
    role: "opening",
    label: "オープニング汎用Cue",
    description: "プログラム作成時にオープニングのCueとしてコピーされます。",
  },
  {
    role: "closing",
    label: "クロージング汎用Cue",
    description: "プログラム作成時にクロージングのCueとしてコピーされます。",
  },
  {
    role: "fallback",
    label: "退避Cue",
    description: "安全設定の退避キューとして使われます。通常のスパインには属しません。",
  },
];

const MISSING_CUE_DEFAULTS: Record<
  LiveFormatCueRole,
  { caption: string; speech: string }
> = {
  opening: { caption: "番組が始まりました。", speech: "ばんぐみが はじまりました。" },
  closing: { caption: "本日はここまでです。", speech: "ほんじつは ここまでです。" },
  fallback: { caption: "少し補足します。", speech: "すこし ほそくします。" },
};

export function FormatCueFields({
  document,
  onChangeDocument,
}: FormatCueFieldsProps) {
  const addMissingCue = (role: LiveFormatCueRole) => {
    const id = createLiveLocalId("format-cue");
    const defaults = MISSING_CUE_DEFAULTS[role];
    onChangeDocument((current) => {
      // A double click must not add a second opening/closing/fallback cue;
      // the contract allows one per role.
      if (current.cues.some((entry) => entry.role === role)) {
        return current;
      }
      const next = addFormatCue(
        current,
        createFormatCue({
          id,
          role,
          caption: defaults.caption,
          speech: defaults.speech,
        }),
      );
      return role === "fallback"
        ? {
            ...next,
            safety: { ...next.safety, fallbackCueId: id },
          }
        : next;
    });
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h2 className={sectionTitleClass}>汎用Cue</h2>
      <p className={metaTextClass}>
        エピソード本文は持ちません。プログラム作成時にコピーされ、プログラム側で自由に書き換えられます。
      </p>
      <div className="space-y-3">
        {ROLES.map(({ role, label, description }) => {
          const cue = document.cues.find((entry) => entry.role === role);
          return (
            <div key={role} className="rounded-md border border-border bg-surface-muted p-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-sm font-semibold">{label}</h3>
                {cue === undefined && (
                  <>
                    <span className={badgeDangerClass}>未設定</span>
                    <button
                      type="button"
                      className="text-sm text-brand-700 hover:underline"
                      onClick={() => addMissingCue(role)}
                    >
                      汎用Cueを追加
                    </button>
                  </>
                )}
              </div>
              <p className={`m-0 ${metaTextClass}`}>{description}</p>
              {cue !== undefined && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block text-sm">
                    話者
                    <select
                      className={`mt-1 w-full ${textFieldClass}`}
                      value={cue.speaker}
                      onChange={(event) =>
                        onChangeDocument((current) =>
                          updateFormatCue(current, cue.id, {
                            speaker: event.target.value === "right" ? "right" : "left",
                          }),
                        )
                      }
                    >
                      <option value="left">左</option>
                      <option value="right">右</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    表情
                    <input
                      className={`mt-1 w-full ${textFieldClass}`}
                      value={cue.expression}
                      onChange={(event) =>
                        onChangeDocument((current) =>
                          updateFormatCue(current, cue.id, {
                            expression: event.target.value,
                          }),
                        )
                      }
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    字幕
                    <input
                      className={`mt-1 w-full ${textFieldClass}`}
                      value={cue.caption}
                      onChange={(event) =>
                        onChangeDocument((current) =>
                          updateFormatCue(current, cue.id, { caption: event.target.value }),
                        )
                      }
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    読み上げ
                    <input
                      className={`mt-1 w-full ${textFieldClass}`}
                      value={cue.speech}
                      onChange={(event) =>
                        onChangeDocument((current) =>
                          updateFormatCue(current, cue.id, { speech: event.target.value }),
                        )
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
