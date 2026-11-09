import { useEffect, useState } from "react";
import type {
  LiveCommentPolicy,
  LiveFormatDocumentV1,
  LiveFormatSegmentTemplate,
} from "@kakeai/contracts";
import {
  addFormatCommentSegment,
  addFormatCueSegment,
  addFormatCutInSegment,
  moveFormatSegment,
  patchFormatSegment,
  removeFormatSegment,
  setFormatCutInDuration,
} from "../../model/format";
import { createLiveLocalId } from "../../model/ids";
import { formatDuration } from "../../duration";
import {
  badgeInfoClass,
  badgeNeutralClass,
  badgeWarningClass,
  buttonNeutralClass,
  iconButtonClass,
  metaTextClass,
  sectionTitleClass,
} from "../../../ui";
import { DurationField, OptionalDurationField, OptionalNumberField } from "../DurationField";
import { FormatVisualSelect } from "./FormatVisualSelect";

interface FormatSpineEditorProps {
  document: LiveFormatDocumentV1;
  onChangeDocument: (updater: (document: LiveFormatDocumentV1) => LiveFormatDocumentV1) => void;
}

function segmentKindLabel(segment: LiveFormatSegmentTemplate): string {
  switch (segment.kind) {
    case "opening":
      return "オープニング";
    case "script":
      return "台本";
    case "closing":
      return "クロージング";
    case "comment":
      return "コメント";
    case "cut_in":
      return "CutIn";
  }
}

function segmentKindShortLabel(segment: LiveFormatSegmentTemplate): string {
  switch (segment.kind) {
    case "opening":
      return "開始";
    case "script":
      return "台本";
    case "closing":
      return "終了";
    case "comment":
      return "コメント";
    case "cut_in":
      return "CutIn";
  }
}

export function FormatSpineEditor({
  document,
  onChangeDocument,
}: FormatSpineEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    document.segments[0]?.id ?? null,
  );
  useEffect(() => {
    if (selectedId !== null && !document.segments.some((segment) => segment.id === selectedId)) {
      setSelectedId(document.segments[0]?.id ?? null);
    }
  }, [document.segments, selectedId]);

  const selected =
    document.segments.find((segment) => segment.id === selectedId) ??
    document.segments[0] ??
    null;
  const selectedIndex = selected === null ? -1 : document.segments.indexOf(selected);
  const lastIndex = document.segments.length - 1;
  const scriptCount = document.segments.filter((segment) => segment.kind === "script").length;

  // Read the live segment inside the updater so successive field edits do not
  // spread a stale commentPolicy object from the previous render.
  const updateCommentPolicy = (patch: Partial<LiveCommentPolicy>) =>
    onChangeDocument((current) => {
      if (selected === null) {
        return current;
      }
      const target = current.segments.find((entry) => entry.id === selected.id);
      const currentPolicy =
        target !== undefined && target.kind === "comment" ? target.commentPolicy : undefined;
      return patchFormatSegment(current, selected.id, {
        commentPolicy: { ...currentPolicy, ...patch },
      });
    });

  const addScript = () => {
    const id = createLiveLocalId("format-seg");
    onChangeDocument((current) => addFormatCueSegment(current, { id, kind: "script" }));
    setSelectedId(id);
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h2 className={sectionTitleClass}>スパイン（フォーマット雛形）</h2>
      <p className={metaTextClass}>
        Cue 本文は汎用の opening / closing / fallback だけを持ちます。エピソード本文はプログラム側で編集します。
      </p>

      <ol className="m-0 mt-2 list-none space-y-1 p-0">
        {document.segments.map((segment, index) => {
          const canMoveUp =
            index > 1 && segment.kind !== "opening" && segment.kind !== "closing";
          const canMoveDown =
            index < lastIndex - 1 &&
            segment.kind !== "opening" &&
            segment.kind !== "closing";
          const removable =
            segment.kind !== "opening" &&
            segment.kind !== "closing" &&
            !(segment.kind === "script" && scriptCount <= 1);
          return (
            <li
              key={segment.id}
              className={`rounded border p-2 ${
                selected?.id === segment.id
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                  : "border-border bg-surface-muted"
              }`}
            >
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 text-left"
                onClick={() => setSelectedId(segment.id)}
              >
                <span className="w-4 shrink-0 text-right text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <span
                  className={
                    segment.kind === "cut_in" ? badgeWarningClass : badgeInfoClass
                  }
                >
                  {segmentKindShortLabel(segment)}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm font-medium">
                  {segment.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {segment.kind === "cut_in"
                    ? segment.targetDurationMs === undefined
                      ? "尺はCutIn由来"
                      : formatDuration(segment.targetDurationMs)
                    : formatDuration(segment.targetDurationMs)}
                </span>
              </button>
              <div className="mt-1 flex justify-end gap-1">
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`${segment.label} を上へ`}
                  disabled={!canMoveUp}
                  onClick={() =>
                    onChangeDocument((current) =>
                      moveFormatSegment(current, segment.id, -1),
                    )
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`${segment.label} を下へ`}
                  disabled={!canMoveDown}
                  onClick={() =>
                    onChangeDocument((current) =>
                      moveFormatSegment(current, segment.id, 1),
                    )
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`${segment.label} を削除`}
                  disabled={!removable}
                  onClick={() =>
                    onChangeDocument((current) => removeFormatSegment(current, segment.id))
                  }
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={buttonNeutralClass} onClick={addScript}>
          台本セグメントを追加
        </button>
        <button
          type="button"
          className={buttonNeutralClass}
          onClick={() => {
            const id = createLiveLocalId("format-seg");
            onChangeDocument((current) => addFormatCommentSegment(current, { id }));
            setSelectedId(id);
          }}
        >
          コメントを追加
        </button>
        <button
          type="button"
          className={buttonNeutralClass}
          onClick={() => {
            const id = createLiveLocalId("format-seg");
            onChangeDocument((current) => addFormatCutInSegment(current, { id }));
            setSelectedId(id);
          }}
        >
          CutIn プレースホルダーを追加
        </button>
      </div>

      {selected !== null && selectedIndex >= 0 && (
        <div className="mt-3 rounded-md border border-border bg-surface p-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-sm font-semibold">
              {segmentKindLabel(selected)} の設定
            </h3>
            <span className={badgeNeutralClass}>{selected.kind}</span>
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              ラベル
              <input
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                value={selected.label}
                onChange={(event) =>
                  onChangeDocument((current) =>
                    patchFormatSegment(current, selected.id, {
                      label: event.target.value,
                    }),
                  )
                }
              />
            </label>
            {selected.kind === "cut_in" ? (
              <OptionalDurationField
                label="目標尺（任意）"
                valueMs={selected.targetDurationMs}
                onCommit={(valueMs) =>
                  onChangeDocument((current) =>
                    setFormatCutInDuration(current, selected.id, valueMs),
                  )
                }
              />
            ) : (
              <DurationField
                label="目標尺"
                valueMs={selected.targetDurationMs}
                onCommit={(valueMs) =>
                  onChangeDocument((current) =>
                    patchFormatSegment(current, selected.id, { targetDurationMs: valueMs }),
                  )
                }
              />
            )}
            {selected.kind !== "cut_in" && (
              <div className="sm:col-span-2">
                <p className="m-0 mb-1 text-sm">既定の中央ビジュアル</p>
                <FormatVisualSelect
                  value={selected.visual}
                  cards={document.cards}
                  onChange={(visual) =>
                    onChangeDocument((current) =>
                      patchFormatSegment(current, selected.id, {
                        visual,
                      }),
                    )
                  }
                />
              </div>
            )}
            {selected.kind === "comment" && (
              <div className="sm:col-span-2">
                <p className={`m-0 mb-1 ${metaTextClass}`}>
                  コメント設定の上書き（空欄は番組全体の既定を継承）
                </p>
                <div className="flex flex-wrap gap-3">
                  <OptionalNumberField
                    label="最大コメント数"
                    value={selected.commentPolicy?.maxCommentsPerCorner}
                    min={1}
                    onCommit={(value) =>
                      updateCommentPolicy({ maxCommentsPerCorner: value })
                    }
                  />
                  <OptionalNumberField
                    label="最大固定数"
                    value={selected.commentPolicy?.maxHumanPinsPerCorner}
                    min={0}
                    onCommit={(value) =>
                      updateCommentPolicy({ maxHumanPinsPerCorner: value })
                    }
                  />
                  <OptionalNumberField
                    label="追加スロット"
                    value={selected.commentPolicy?.maxExtraSlots}
                    min={0}
                    onCommit={(value) =>
                      updateCommentPolicy({ maxExtraSlots: value })
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
