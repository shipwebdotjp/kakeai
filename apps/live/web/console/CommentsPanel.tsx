import type { ConsoleSnapshot, LiveCommentEntry } from "@kakeai/contracts";
import { formatTimestamp } from "./format";

interface CommentsPanelProps {
  snapshot: ConsoleSnapshot;
  onPin: (commentId: string, note?: string) => void;
  onUnpin: (commentId: string) => void;
  onSkip: (commentId: string) => void;
}

function formatFreshness(ms: number): string {
  if (ms < 60_000) {
    return `${Math.floor(ms / 1_000)}秒`;
  }
  return `${Math.floor(ms / 60_000)}分`;
}

function decisionLabel(entry: LiveCommentEntry): string {
  switch (entry.decision) {
    case "accepted":
      return "通過";
    case "review":
      return "要確認";
    case "blocked":
      return "ブロック";
    default:
      return entry.decision;
  }
}

function stateLabel(entry: LiveCommentEntry): string {
  switch (entry.state) {
    case "received":
      return "受信";
    case "blocked":
      return "ブロック";
    case "candidate":
      return "候補";
    case "selected":
      return "選択中";
    case "done":
      return "完了";
    case "skipped":
      return "スキップ";
    case "deferred":
      return "次コーナー";
    default:
      return entry.state;
  }
}

function requestPin(entry: LiveCommentEntry, onPin: CommentsPanelProps["onPin"]): void {
  const note = window.prompt("ピンのメモ（任意）", entry.pinNote ?? "");
  if (note === null) {
    return;
  }
  const trimmed = note.trim();
  onPin(entry.comment.id, trimmed === "" ? undefined : trimmed);
}

/**
 * Operator comment list. Every untrusted string is rendered as a React text
 * node; no HTML path exists. The raw body is visible only in this local
 * console, while the stage receives the safe summary.
 */
export function CommentsPanel({ snapshot, onPin, onUnpin, onSkip }: CommentsPanelProps) {
  const comments = [...snapshot.comments].slice(-100).reverse();

  return (
    <section className="block">
      <div className="block-head">
        <h2>コメント</h2>
        <span className="queue-position">{snapshot.comments.length} 件</span>
      </div>
      {comments.length === 0 ? (
        <p className="muted">まだコメントはありません。</p>
      ) : (
        <div className="comments-scroll">
          <ul className="comments">
            {comments.map((entry) => {
              const candidate = entry.candidate;
              const blocked = entry.decision === "blocked" || entry.state === "blocked";
              return (
                <li
                  key={entry.comment.id}
                  className={`comment-row${entry.selected ? " selected" : ""}`}
                >
                  <div className="comment-meta">
                    <span className="mono">{formatTimestamp(entry.comment.publishedAt)}</span>
                    <span className="comment-freshness">鮮度 {formatFreshness(entry.freshnessMs)}</span>
                    <span className="comment-author">{entry.comment.authorName}</span>
                    <span className={`comment-badge comment-badge-${entry.decision}`}>
                      {decisionLabel(entry)}
                    </span>
                    <span className="comment-state">{stateLabel(entry)}</span>
                    {entry.pinned ? <span className="comment-pin">ピン</span> : null}
                  </div>

                  <p className="comment-text">{entry.comment.text}</p>
                  {entry.redactedText !== entry.comment.text ? (
                    <p className="muted">伏せ字: {entry.redactedText}</p>
                  ) : null}
                  {entry.reasons.length > 0 ? (
                    <p className="comment-reasons">理由: {entry.reasons.join(", ")}</p>
                  ) : null}

                  {candidate !== null ? (
                    <p className="comment-analysis">
                      AI: score {candidate.score.toFixed(2)} / {candidate.relevance}
                      {candidate.isQuestion ? " / 質問" : ""} / safety {candidate.safety} /{" "}
                      {candidate.reason}
                    </p>
                  ) : null}
                  {entry.pinNote !== null ? (
                    <p className="comment-note">ピンのメモ: {entry.pinNote}</p>
                  ) : null}

                  <div className="comment-actions">
                    {entry.pinned ? (
                      <button type="button" onClick={() => onUnpin(entry.comment.id)}>
                        ピン解除
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={blocked}
                        title={blocked ? "安全ブロックされたコメントはピンできません" : undefined}
                        onClick={() => requestPin(entry, onPin)}
                      >
                        ピン
                      </button>
                    )}
                    <button
                      type="button"
                      className="warning"
                      disabled={blocked}
                      onClick={() => onSkip(entry.comment.id)}
                    >
                      スキップ
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
