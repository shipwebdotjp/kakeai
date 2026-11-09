import type { LiveFormatDocumentV1 } from "@kakeai/contracts";
import {
  metaTextClass,
  sectionTitleClass,
  textFieldClass,
} from "../../../ui";
import {
  NonNegativeSecondsField,
  RequiredNumberField,
} from "../DurationField";

interface FormatPolicyFieldsProps {
  document: LiveFormatDocumentV1;
  onChangeDocument: (updater: (document: LiveFormatDocumentV1) => LiveFormatDocumentV1) => void;
}

export function FormatPolicyFields({
  document,
  onChangeDocument,
}: FormatPolicyFieldsProps) {
  const fallbackCues = document.cues.filter((cue) => cue.role === "fallback");
  const fallbackCueExists = fallbackCues.some(
    (cue) => cue.id === document.safety.fallbackCueId,
  );
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>コメント設定の既定値</h2>
        <div className="flex flex-wrap gap-3">
          <RequiredNumberField
            label="鮮度（分）"
            value={document.commentPolicy.freshnessMin}
            min={0}
            onCommit={(value) =>
              onChangeDocument((current) => ({
                ...current,
                commentPolicy: { ...current.commentPolicy, freshnessMin: value },
              }))
            }
          />
          <RequiredNumberField
            label="最大コメント数"
            value={document.commentPolicy.maxCommentsPerCorner}
            onCommit={(value) =>
              onChangeDocument((current) => ({
                ...current,
                commentPolicy: { ...current.commentPolicy, maxCommentsPerCorner: value },
              }))
            }
          />
          <RequiredNumberField
            label="最大固定数"
            value={document.commentPolicy.maxHumanPinsPerCorner}
            min={0}
            onCommit={(value) =>
              onChangeDocument((current) => ({
                ...current,
                commentPolicy: { ...current.commentPolicy, maxHumanPinsPerCorner: value },
              }))
            }
          />
          <RequiredNumberField
            label="追加スロット"
            value={document.commentPolicy.maxExtraSlots}
            min={0}
            onCommit={(value) =>
              onChangeDocument((current) => ({
                ...current,
                commentPolicy: { ...current.commentPolicy, maxExtraSlots: value },
              }))
            }
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={document.commentPolicy.skipWhenEmpty}
            onChange={(event) =>
              onChangeDocument((current) => ({
                ...current,
                commentPolicy: {
                  ...current.commentPolicy,
                  skipWhenEmpty: event.target.checked,
                },
              }))
            }
          />
          コメントがない場合はコーナーをスキップ
        </label>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>安全設定</h2>
        <div className="space-y-3">
          <label className="block text-sm">
            ペルソナ
            <textarea
              className={`mt-1 min-h-16 w-full ${textFieldClass}`}
              value={document.safety.persona}
              onChange={(event) =>
                onChangeDocument((current) => ({
                  ...current,
                  safety: { ...current.safety, persona: event.target.value },
                }))
              }
            />
          </label>
          <label className="block text-sm">
            禁止トピック（改行またはカンマ区切り）
            <textarea
              className={`mt-1 min-h-16 w-full ${textFieldClass}`}
              value={document.safety.blockedTopics.join("\n")}
              onChange={(event) =>
                onChangeDocument((current) => ({
                  ...current,
                  safety: {
                    ...current.safety,
                    blockedTopics: event.target.value
                      .split(/[\n,]/)
                      .map((entry) => entry.trim())
                      .filter((entry) => entry.length > 0),
                  },
                }))
              }
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <RequiredNumberField
              label="最大応答文字数"
              value={document.safety.maxResponseChars}
              onCommit={(value) =>
                onChangeDocument((current) => ({
                  ...current,
                  safety: { ...current.safety, maxResponseChars: value },
                }))
              }
            />
            <RequiredNumberField
              label="最大応答Cue数"
              value={document.safety.maxResponseCues}
              onCommit={(value) =>
                onChangeDocument((current) => ({
                  ...current,
                  safety: { ...current.safety, maxResponseCues: value },
                }))
              }
            />
            {fallbackCues.length === 0 ? (
              <p className="text-sm text-red-600">
                退避Cueが未設定です。上の「汎用Cue」で fallback を追加してください。
              </p>
            ) : (
              <label className="block text-sm">
                退避Cue
                <select
                  className={`mt-1 ${textFieldClass}`}
                  value={document.safety.fallbackCueId}
                  onChange={(event) =>
                    onChangeDocument((current) => ({
                      ...current,
                      safety: { ...current.safety, fallbackCueId: event.target.value },
                    }))
                  }
                >
                  {!fallbackCueExists && (
                    <option value={document.safety.fallbackCueId} disabled>
                      {document.safety.fallbackCueId}（見つかりません）
                    </option>
                  )}
                  {fallbackCues.map((cue) => (
                    <option key={cue.id} value={cue.id}>
                      {cue.caption}（{cue.id}）
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>プレイアウトの既定値</h2>
        <div className="flex flex-wrap gap-3">
          <NonNegativeSecondsField
            label="最小バッファ"
            valueMs={document.playout.minBufferMs}
            onCommit={(value) =>
              onChangeDocument((current) => ({
                ...current,
                playout: { ...current.playout, minBufferMs: value },
              }))
            }
          />
          <NonNegativeSecondsField
            label="最大思考時間"
            valueMs={document.playout.maxThinkingMs}
            onCommit={(value) =>
              onChangeDocument((current) => ({
                ...current,
                playout: { ...current.playout, maxThinkingMs: value },
              }))
            }
          />
          <NonNegativeSecondsField
            label="クロージング確保"
            valueMs={document.playout.closingReserveMs}
            onCommit={(value) =>
              onChangeDocument((current) => ({
                ...current,
                playout: { ...current.playout, closingReserveMs: value },
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
