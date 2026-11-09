import type {
  LiveProgramCueSegment,
  LiveProgramDocument,
  LiveProgramSegment,
} from "@kakeai/contracts";
import { addCueToSegment, createCue, moveCue, removeCue } from "../model/cues";
import { createLiveLocalId } from "../model/ids";
import { cuesOfSegment } from "../model/segments";
import { describeVisual, resolveEffectiveVisual } from "../model/visual";
import {
  buttonNeutralClass,
  iconButtonClass,
  metaTextClass,
  sectionTitleClass,
} from "../../ui";

interface CueListProps {
  document: LiveProgramDocument;
  segment: LiveProgramSegment;
  selectedCueId: string | null;
  onSelectCue: (cueId: string) => void;
  onChangeDocument: (updater: (document: LiveProgramDocument) => LiveProgramDocument) => void;
}

export function CueList({
  document,
  segment,
  selectedCueId,
  onSelectCue,
  onChangeDocument,
}: CueListProps) {
  if (segment.kind === "cut_in") {
    return (
      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>CutIn セグメント</h2>
        <p className={metaTextClass}>
          CutIn は Cue を持ちません。尺は書き出し時の CutIn Asset から決まります。
        </p>
      </section>
    );
  }

  if (segment.kind === "comment") {
    return (
      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>コメントコーナー</h2>
        <p className={metaTextClass}>
          コメントコーナーは Cue を持ちません。Segment 既定の中央ビジュアルとコメント設定だけを使います。
        </p>
      </section>
    );
  }

  const cues = cuesOfSegment(document, segment as LiveProgramCueSegment);

  const addCue = () => {
    const id = createLiveLocalId("cue");
    onChangeDocument((current) =>
      addCueToSegment(current, segment.id, createCue({ id })),
    );
    onSelectCue(id);
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={sectionTitleClass}>Cue 一覧</h2>
        <button type="button" className={buttonNeutralClass} onClick={addCue}>
          Cue を追加
        </button>
      </div>
      {cues.length === 0 ? (
        <p className={metaTextClass}>
          このセグメントにはCueがありません。版を確定するには1つ以上のCueが必要です。
        </p>
      ) : (
        <ol className="m-0 mt-2 list-none space-y-1 p-0">
          {cues.map((cue, index) => {
            const selected = cue.id === selectedCueId;
            const effective = resolveEffectiveVisual(segment, cue);
            return (
              <li
                key={cue.id}
                className={`rounded-md border p-2 ${
                  selected
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                    : "border-border bg-surface-muted"
                }`}
              >
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 text-left"
                  onClick={() => onSelectCue(cue.id)}
                >
                  <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <span className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted-foreground">
                    {cue.speaker === "left" ? "左" : "右"}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-sm font-medium">
                    {cue.caption}
                  </span>
                </button>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="min-w-0 text-xs text-muted-foreground">
                    {effective.source === "cue"
                      ? "Cue指定"
                      : effective.source === "segment"
                        ? "Segment既定"
                        : "表示なし"}
                    {" / "}
                    {effective.source === "none"
                      ? "中央ビジュアルなし"
                      : describeVisual(document.cards, document.materials, effective.visual)}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label={`${cue.caption} を上へ`}
                      disabled={index === 0}
                      onClick={() =>
                        onChangeDocument((current) =>
                          moveCue(current, segment.id, cue.id, -1),
                        )
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label={`${cue.caption} を下へ`}
                      disabled={index === cues.length - 1}
                      onClick={() =>
                        onChangeDocument((current) =>
                          moveCue(current, segment.id, cue.id, 1),
                        )
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label={`${cue.caption} を削除`}
                      onClick={() => {
                        if (window.confirm(`Cue「${cue.caption}」を削除しますか？`)) {
                          onChangeDocument((current) => removeCue(current, cue.id));
                        }
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
