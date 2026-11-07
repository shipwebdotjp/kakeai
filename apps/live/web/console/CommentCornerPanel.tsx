import type { ConsoleSnapshot } from "@kakeai/contracts";

const CORNER_STATE_LABELS: Record<ConsoleSnapshot["commentCorner"]["state"], string> = {
  idle: "待機",
  collecting: "候補を収集中",
  running: "進行中",
  finished: "終了",
};

interface CommentCornerPanelProps {
  snapshot: ConsoleSnapshot;
}

export function CommentCornerPanel({ snapshot }: CommentCornerPanelProps) {
  const corner = snapshot.commentCorner;
  return (
    <section className="panel">
      <h2>コメントコーナー</h2>
      <div className="source-grid">
        <span className="source-label">状態</span>
        <span>{CORNER_STATE_LABELS[corner.state]}</span>
        <span className="source-label">セグメント</span>
        <span className="mono">{corner.segmentId ?? "—"}</span>
        <span className="source-label">現在</span>
        <span className="mono">{corner.currentCommentId ?? "—"}</span>
        <span className="source-label">残り枠</span>
        <span>{corner.remainingSlots}</span>
        <span className="source-label">選択中</span>
        <span className="mono">
          {corner.selectedCommentIds.length === 0
            ? "—"
            : corner.selectedCommentIds.join(", ")}
        </span>
        <span className="source-label">次コーナーへ</span>
        <span className="mono">
          {corner.deferredPinIds.length === 0 ? "—" : corner.deferredPinIds.join(", ")}
        </span>
      </div>
    </section>
  );
}
