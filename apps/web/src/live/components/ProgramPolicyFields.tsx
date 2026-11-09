import type { LiveProgramDocument, LiveSafety } from "@kakeai/contracts";
import { createCue, updateCue } from "../model/cues";
import { createLiveLocalId } from "../model/ids";
import { defaultLiveSafety, withSafetyPatch } from "../model/safety";
import { isCueSegment } from "../model/visual";
import {
  badgeWarningClass,
  metaTextClass,
  sectionTitleClass,
  textFieldClass,
} from "../../ui";
import {
  NonNegativeSecondsField,
  RequiredNumberField,
} from "./DurationField";

interface ProgramPolicyFieldsProps {
  document: LiveProgramDocument;
  onChangeDocument: (updater: (document: LiveProgramDocument) => LiveProgramDocument) => void;
}

export function ProgramPolicyFields({
  document,
  onChangeDocument,
}: ProgramPolicyFieldsProps) {
  const safety = document.safety;
  const ownedCueIds = new Set<string>();
  for (const segment of document.segments) {
    if (isCueSegment(segment)) {
      for (const cueId of segment.cues) {
        ownedCueIds.add(cueId);
      }
    }
  }
  const fallbackOptions = document.cues.filter(
    (cue) => !ownedCueIds.has(cue.id) || cue.id === safety?.fallbackCueId,
  );

  const updateSafety = (patch: Partial<LiveSafety>) => {
    const fallbackCueId = fallbackOptions[0]?.id ?? "";
    onChangeDocument((doc) => withSafetyPatch(doc, patch, fallbackCueId));
  };

  const createSafety = () => {
    const existing = fallbackOptions[0];
    if (existing !== undefined) {
      onChangeDocument((doc) => ({ ...doc, safety: defaultLiveSafety(existing.id) }));
      return;
    }
    const id = createLiveLocalId("cue");
    onChangeDocument((doc) => ({
      ...doc,
      cues: [
        ...doc.cues,
        createCue({
          id,
          caption: "少し補足します。",
          speech: "すこし ほそくします。",
        }),
      ],
      safety: defaultLiveSafety(id),
    }));
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>プログラム全体のコメント設定</h2>
        <div className="flex flex-wrap gap-3">
          <RequiredNumberField
            label="鮮度（分）"
            value={document.commentPolicy.freshnessMin}
            min={0}
            onCommit={(value) =>
              onChangeDocument((doc) => ({
                ...doc,
                commentPolicy: { ...doc.commentPolicy, freshnessMin: value },
              }))
            }
          />
          <RequiredNumberField
            label="最大コメント数"
            value={document.commentPolicy.maxCommentsPerCorner}
            onCommit={(value) =>
              onChangeDocument((doc) => ({
                ...doc,
                commentPolicy: { ...doc.commentPolicy, maxCommentsPerCorner: value },
              }))
            }
          />
          <RequiredNumberField
            label="最大固定数"
            value={document.commentPolicy.maxHumanPinsPerCorner}
            min={0}
            onCommit={(value) =>
              onChangeDocument((doc) => ({
                ...doc,
                commentPolicy: { ...doc.commentPolicy, maxHumanPinsPerCorner: value },
              }))
            }
          />
          <RequiredNumberField
            label="追加スロット"
            value={document.commentPolicy.maxExtraSlots}
            min={0}
            onCommit={(value) =>
              onChangeDocument((doc) => ({
                ...doc,
                commentPolicy: { ...doc.commentPolicy, maxExtraSlots: value },
              }))
            }
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={document.commentPolicy.skipWhenEmpty}
            onChange={(event) =>
              onChangeDocument((doc) => ({
                ...doc,
                commentPolicy: {
                  ...doc.commentPolicy,
                  skipWhenEmpty: event.target.checked,
                },
              }))
            }
          />
          コメントがない場合はコーナーをスキップ
        </label>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={sectionTitleClass}>安全設定・退避キュー</h2>
          {safety === undefined && <span className={badgeWarningClass}>未設定</span>}
        </div>
        {safety === undefined ? (
          <button
            type="button"
            className="text-sm text-brand-700 hover:underline"
            onClick={createSafety}
          >
            安全設定を作成
          </button>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              ペルソナ
              <textarea
                className={`mt-1 min-h-16 w-full ${textFieldClass}`}
                value={safety.persona}
                onChange={(event) => updateSafety({ persona: event.target.value })}
              />
            </label>
            <label className="block text-sm">
              禁止トピック（改行またはカンマ区切り）
              <textarea
                className={`mt-1 min-h-16 w-full ${textFieldClass}`}
                value={safety.blockedTopics.join("\n")}
                onChange={(event) =>
                  updateSafety({
                    blockedTopics: event.target.value
                      .split(/[\n,]/)
                      .map((entry) => entry.trim())
                      .filter((entry) => entry.length > 0),
                  })
                }
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <RequiredNumberField
                label="最大応答文字数"
                value={safety.maxResponseChars}
                onCommit={(value) => updateSafety({ maxResponseChars: value })}
              />
              <RequiredNumberField
                label="最大応答Cue数"
                value={safety.maxResponseCues}
                onCommit={(value) => updateSafety({ maxResponseCues: value })}
              />
              <label className="block text-sm">
                退避Cue
                <select
                  className={`mt-1 ${textFieldClass}`}
                  value={safety.fallbackCueId}
                  onChange={(event) => updateSafety({ fallbackCueId: event.target.value })}
                >
                  {fallbackOptions.map((cue) => (
                    <option key={cue.id} value={cue.id}>
                      {cue.caption}（{cue.id}）
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(() => {
              const fallback = document.cues.find(
                (cue) => cue.id === safety.fallbackCueId,
              );
              if (fallback === undefined) {
                return (
                  <p className="text-sm text-red-600">
                    退避Cueが見つかりません。存在するCueを選択してください。
                  </p>
                );
              }
              return (
                <div className="rounded-md border border-border bg-surface-muted p-2">
                  <p className="m-0 mb-2 text-sm font-medium">退避Cueの内容</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-sm">
                      話者
                      <select
                        className={`mt-1 w-full ${textFieldClass}`}
                        value={fallback.speaker}
                        onChange={(event) =>
                          onChangeDocument((doc) =>
                            updateCue(doc, fallback.id, {
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
                        value={fallback.expression}
                        onChange={(event) =>
                          onChangeDocument((doc) =>
                            updateCue(doc, fallback.id, { expression: event.target.value }),
                          )
                        }
                      />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                      字幕
                      <input
                        className={`mt-1 w-full ${textFieldClass}`}
                        value={fallback.caption}
                        onChange={(event) =>
                          onChangeDocument((doc) =>
                            updateCue(doc, fallback.id, { caption: event.target.value }),
                          )
                        }
                      />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                      読み上げ
                      <input
                        className={`mt-1 w-full ${textFieldClass}`}
                        value={fallback.speech}
                        onChange={(event) =>
                          onChangeDocument((doc) =>
                            updateCue(doc, fallback.id, { speech: event.target.value }),
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>プレイアウト</h2>
        <div className="flex flex-wrap gap-3">
          <NonNegativeSecondsField
            label="最小バッファ"
            valueMs={document.playout.minBufferMs}
            onCommit={(value) =>
              onChangeDocument((doc) => ({
                ...doc,
                playout: { ...doc.playout, minBufferMs: value },
              }))
            }
          />
          <NonNegativeSecondsField
            label="最大思考時間"
            valueMs={document.playout.maxThinkingMs}
            onCommit={(value) =>
              onChangeDocument((doc) => ({
                ...doc,
                playout: { ...doc.playout, maxThinkingMs: value },
              }))
            }
          />
          <NonNegativeSecondsField
            label="クロージング確保"
            valueMs={document.playout.closingReserveMs}
            onCommit={(value) =>
              onChangeDocument((doc) => ({
                ...doc,
                playout: { ...doc.playout, closingReserveMs: value },
              }))
            }
          />
        </div>
        <p className={`mt-2 ${metaTextClass}`}>
          クロージング確保は全体目標尺より短くしてください。
        </p>
      </section>
    </div>
  );
}
