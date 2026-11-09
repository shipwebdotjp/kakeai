import type {
  LiveCommentPolicy,
  LiveProgramDocument,
  LiveProgramSegment,
} from "@kakeai/contracts";
import { patchSegment } from "../model/segments";
import { setSegmentVisual } from "../model/visual";
import { formatDuration } from "../duration";
import {
  badgeInfoClass,
  badgeWarningClass,
  metaTextClass,
  sectionTitleClass,
} from "../../ui";
import { DurationField, OptionalNumberField } from "./DurationField";
import { VisualSelect } from "./VisualSelect";
import type { LiveProgramValidationIssue } from "../model/validation";
import { ValidationIssues } from "./ValidationIssues";

interface SegmentEditorProps {
  document: LiveProgramDocument;
  segment: LiveProgramSegment;
  issues: readonly LiveProgramValidationIssue[];
  onChangeDocument: (updater: (document: LiveProgramDocument) => LiveProgramDocument) => void;
}

export function SegmentEditor({
  document,
  segment,
  issues,
  onChangeDocument,
}: SegmentEditorProps) {
  const isComment = segment.kind === "comment";
  const cutIn = segment.kind === "cut_in";
  const labelHelp = cutIn
    ? "CutIn の尺は Asset から決まります。"
    : `目標尺 ${"targetDurationMs" in segment ? formatDuration(segment.targetDurationMs) : "-"}`;

  // Read the live segment inside the updater: a previous field edit may have
  // already replaced its commentPolicy object.
  const updateCommentPolicy = (patch: Partial<LiveCommentPolicy>) =>
    onChangeDocument((current) => {
      const target = current.segments.find((entry) => entry.id === segment.id);
      const currentPolicy =
        target !== undefined && target.kind === "comment" ? target.commentPolicy : undefined;
      return patchSegment(current, segment.id, {
        commentPolicy: { ...currentPolicy, ...patch },
      });
    });

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={sectionTitleClass}>セグメント設定</h2>
        <span className={cutIn ? badgeWarningClass : badgeInfoClass}>
          {segment.kind === "opening"
            ? "オープニング"
            : segment.kind === "script"
              ? "台本"
              : segment.kind === "closing"
                ? "クロージング"
                : segment.kind === "comment"
                  ? "コメント"
                  : "CutIn"}
        </span>
        <span className={metaTextClass}>{labelHelp}</span>
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          ラベル
          <input
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            value={segment.label}
            onChange={(event) =>
              onChangeDocument((current) =>
                patchSegment(current, segment.id, { label: event.target.value }),
              )
            }
          />
        </label>

        {"targetDurationMs" in segment && (
          <DurationField
            label="目標尺"
            valueMs={segment.targetDurationMs}
            onCommit={(valueMs) =>
              onChangeDocument((current) =>
                patchSegment(current, segment.id, { targetDurationMs: valueMs }),
              )
            }
          />
        )}

        {cutIn && (
          <label className="block text-sm">
            CutIn
            <select
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              value={segment.cutInId}
              onChange={(event) =>
                onChangeDocument((current) =>
                  patchSegment(current, segment.id, { cutInId: event.target.value }),
                )
              }
            >
              {document.cutIns.length === 0 && <option value="">CutInがありません</option>}
              {!document.cutIns.some((entry) => entry.id === segment.cutInId) &&
                segment.cutInId !== "" && (
                  <option value={segment.cutInId} disabled>
                    {segment.cutInId}（見つかりません）
                  </option>
                )}
              {document.cutIns.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}（{entry.assetId}）
                </option>
              ))}
            </select>
            <span className={metaTextClass}>
              CutIn は「素材・CutIn」タブで追加できます。
            </span>
          </label>
        )}

        {!cutIn && (
          <div className="sm:col-span-2">
            <p className="m-0 mb-1 text-sm">セグメント既定の中央ビジュアル</p>
            <VisualSelect
              mode="segment"
              value={segment.visual}
              cards={document.cards}
              materials={document.materials}
              onChange={(value) =>
                onChangeDocument((current) =>
                  setSegmentVisual(
                    current,
                    segment.id,
                    value === null ? undefined : value,
                  ),
                )
              }
            />
            {isComment && (
              <p className={`mt-1 ${metaTextClass}`}>
                コメントコーナーは既定ビジュアルだけを持ちます。Cue は作成できません。
              </p>
            )}
          </div>
        )}
      </div>

      {isComment && (
        <div className="mt-3 border-t border-border pt-3">
          <h3 className="m-0 mb-2 text-sm font-semibold">コメント設定の上書き</h3>
          <p className={`m-0 mb-2 ${metaTextClass}`}>
            空欄はプログラム全体の設定を継承します。
          </p>
          <div className="flex flex-wrap gap-3">
            <OptionalNumberField
              label="最大コメント数"
              value={segment.commentPolicy?.maxCommentsPerCorner}
              min={1}
              onCommit={(value) =>
                updateCommentPolicy({ maxCommentsPerCorner: value })
              }
            />
            <OptionalNumberField
              label="最大固定数"
              value={segment.commentPolicy?.maxHumanPinsPerCorner}
              min={0}
              onCommit={(value) =>
                updateCommentPolicy({ maxHumanPinsPerCorner: value })
              }
            />
            <OptionalNumberField
              label="追加スロット"
              value={segment.commentPolicy?.maxExtraSlots}
              min={0}
              onCommit={(value) => updateCommentPolicy({ maxExtraSlots: value })}
            />
            <OptionalNumberField
              label="鮮度（分）"
              value={segment.commentPolicy?.freshnessMin}
              min={0}
              onCommit={(value) => updateCommentPolicy({ freshnessMin: value })}
            />
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <ValidationIssues issues={issues} />
        </div>
      )}
    </section>
  );
}
