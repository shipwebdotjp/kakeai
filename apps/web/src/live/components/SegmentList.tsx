import type { LiveProgramDocument, LiveProgramSegment } from "@kakeai/contracts";
import {
  addCommentSegment,
  addScriptSegment,
  moveSegment,
  removeSegment,
} from "../model/segments";
import { createLiveLocalId } from "../model/ids";
import { formatDuration } from "../duration";
import {
  badgeDangerClass,
  badgeInfoClass,
  badgeNeutralClass,
  badgeWarningClass,
  buttonNeutralClass,
  iconButtonClass,
  metaTextClass,
  sectionTitleClass,
} from "../../ui";

interface SegmentListProps {
  document: LiveProgramDocument;
  selectedSegmentId: string | null;
  onSelect: (segmentId: string) => void;
  onChangeDocument: (updater: (document: LiveProgramDocument) => LiveProgramDocument) => void;
  onRequestAddCutIn: () => void;
}

function kindLabel(segment: LiveProgramSegment): string {
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

function kindClass(segment: LiveProgramSegment): string {
  switch (segment.kind) {
    case "opening":
      return badgeInfoClass;
    case "closing":
      return badgeInfoClass;
    case "cut_in":
      return badgeWarningClass;
    default:
      return badgeNeutralClass;
  }
}

export function SegmentList({
  document,
  selectedSegmentId,
  onSelect,
  onChangeDocument,
  onRequestAddCutIn,
}: SegmentListProps) {
  const lastIndex = document.segments.length - 1;
  const scriptCount = document.segments.filter((segment) => segment.kind === "script").length;

  const addScript = () => {
    const id = createLiveLocalId("seg");
    onChangeDocument((current) =>
      addScriptSegment(current, { id, label: "新しいセグメント" }),
    );
    onSelect(id);
  };

  const addComment = () => {
    const id = createLiveLocalId("seg");
    onChangeDocument((current) => addCommentSegment(current, { id }));
    onSelect(id);
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={sectionTitleClass}>セグメント（スパイン）</h2>
        <span className={metaTextClass}>上から順に進行</span>
      </div>

      <ol className="m-0 mt-2 list-none space-y-1 p-0">
        {document.segments.map((segment, index) => {
          const selected = segment.id === selectedSegmentId;
          const cueCount =
            segment.kind === "opening" || segment.kind === "script" || segment.kind === "closing"
              ? segment.cues.length
              : null;
          const isFixed = segment.kind === "opening" || segment.kind === "closing";
          // Guard by the adjacent kinds instead of fixed indices so an invalid
          // draft (opening/closing out of place) can still be repaired.
          const previous = document.segments[index - 1];
          const next = document.segments[index + 1];
          const canMoveUp =
            !isFixed && previous !== undefined && previous.kind !== "opening";
          const canMoveDown =
            !isFixed && next !== undefined && next.kind !== "closing";
          const removable =
            segment.kind !== "opening" &&
            segment.kind !== "closing" &&
            !(segment.kind === "script" && scriptCount <= 1);
          return (
            <li
              key={segment.id}
              className={`rounded-md border p-2 ${
                selected
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                  : "border-border bg-surface-muted"
              }`}
            >
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 text-left"
                onClick={() => onSelect(segment.id)}
              >
                <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className={kindClass(segment)}>{kindLabel(segment)}</span>
                <span className="min-w-0 flex-1 break-words text-sm font-medium">
                  {segment.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {segment.kind === "cut_in"
                    ? "尺はCutIn由来"
                    : formatDuration(segment.targetDurationMs)}
                  {cueCount === null ? "" : ` / Cue ${cueCount}`}
                </span>
              </button>
              <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
                {segment.kind === "cut_in" && (
                  <span className={metaTextClass}>CutIn: {segment.cutInId}</span>
                )}
                {index === 0 && segment.kind !== "opening" && (
                  <span className={badgeDangerClass}>先頭は opening 必須</span>
                )}
                {index === lastIndex && segment.kind !== "closing" && (
                  <span className={badgeDangerClass}>末尾は closing 必須</span>
                )}
                {cueCount === 0 && (
                  <span className={badgeWarningClass}>Cue 未設定</span>
                )}
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`${segment.label} を上へ`}
                  disabled={!canMoveUp}
                  onClick={() =>
                    onChangeDocument((current) => moveSegment(current, segment.id, -1))
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
                    onChangeDocument((current) => moveSegment(current, segment.id, 1))
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`${segment.label} を削除`}
                  disabled={!removable}
                  title={removable ? undefined : "opening / closing と最後の台本は削除できません"}
                  onClick={() => {
                    if (
                      window.confirm(
                        `セグメント「${segment.label}」を削除しますか？所属するCueも削除されます。`,
                      )
                    ) {
                      onChangeDocument((current) => removeSegment(current, segment.id));
                    }
                  }}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonNeutralClass} onClick={addScript}>
          台本セグメントを追加
        </button>
        <button type="button" className={buttonNeutralClass} onClick={addComment}>
          コメントを追加
        </button>
        <button type="button" className={buttonNeutralClass} onClick={onRequestAddCutIn}>
          CutIn を追加
        </button>
      </div>

      <div className="mt-3 rounded-md border border-border bg-surface-muted p-2 text-xs">
        <p className="m-0 font-semibold">版確定時のスパイン制約</p>
        <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-muted-foreground">
          <li>{document.segments[0]?.kind === "opening" ? "✓" : "✗"} 先頭は opening</li>
          <li>
            {document.segments[document.segments.length - 1]?.kind === "closing" ? "✓" : "✗"}{" "}
            末尾は closing
          </li>
          <li>{scriptCount > 0 ? "✓" : "✗"} script が1つ以上</li>
          <li>CutIn は opening と closing の間だけ</li>
          <li>opening / script / closing には1つ以上のCueが必要</li>
        </ul>
      </div>
    </section>
  );
}
